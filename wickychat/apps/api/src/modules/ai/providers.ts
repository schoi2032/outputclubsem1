/**
 * AI provider abstraction. WickyChat AI features talk to `AIProvider`, never to a
 * vendor SDK directly, so providers can be added or swapped per organization.
 *
 * No organization data is sent to a provider unless an administrator has
 * explicitly authorized it (see `ai_providers.data_access_consent_at`).
 */
import Anthropic from '@anthropic-ai/sdk'

export interface AIMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AICompletion {
  text: string
  model: string
  stopReason: string | null
  /** True when the provider declined the request for policy reasons. */
  refused: boolean
}

export interface AIProvider {
  readonly id: 'anthropic' | 'openai'
  complete(opts: {
    system: string
    messages: AIMessage[]
    maxTokens?: number
  }): Promise<AICompletion>
  /** Cheap call that verifies the credentials. Sends no organization data. */
  testConnection(): Promise<{ ok: true; model: string } | { ok: false; error: string }>
}

export const DEFAULT_MODELS = {
  anthropic: 'claude-opus-5-5',
  openai: '',
} as const

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-fable-5-1',
  'claude-sonnet-5-5',
])

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const
  private readonly client: Anthropic

  constructor(
    apiKey: string,
    private readonly model: string = DEFAULT_MODELS.anthropic,
  ) {
    this.client = new Anthropic({ apiKey })
  }

  async complete(opts: {
    system: string
    messages: AIMessage[]
    maxTokens?: number
  }): Promise<AICompletion> {
    const useFallback = FALLBACK_MODELS.has(this.model)
    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: opts.maxTokens ?? 16_000,
      system: opts.system,
      messages: opts.messages,
      thinking: { type: 'adaptive' },
      // If the model declines on policy grounds, the API retries on a suitable fallback model.
      ...(useFallback && {
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default' as const,
      }),
    })
    const response = await stream.finalMessage()
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    return {
      text,
      model: response.model,
      stopReason: response.stop_reason,
      refused: response.stop_reason === 'refusal',
    }
  }

  async testConnection() {
    try {
      const m = await this.client.models.retrieve(this.model)
      return { ok: true as const, model: m.id }
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError)
        return { ok: false as const, error: 'The API key was rejected.' }
      if (err instanceof Anthropic.NotFoundError)
        return { ok: false as const, error: `Model "${this.model}" was not found.` }
      if (err instanceof Anthropic.RateLimitError)
        return { ok: false as const, error: 'Rate limited. Try again shortly.' }
      if (err instanceof Anthropic.APIError)
        return { ok: false as const, error: `Provider error (${err.status}).` }
      return { ok: false as const, error: 'Could not reach the provider.' }
    }
  }
}

export type AIFactory = (
  provider: 'anthropic' | 'openai',
  apiKey: string,
  model: string,
) => AIProvider

export function createProvider(
  provider: 'anthropic' | 'openai',
  apiKey: string,
  model: string,
): AIProvider {
  switch (provider) {
    case 'anthropic':
      return new AnthropicProvider(apiKey, model || DEFAULT_MODELS.anthropic)
    default:
      throw new Error(`The ${provider} provider is not available yet.`)
  }
}
