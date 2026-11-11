/**
 * Standard interface for integrations. Messaging code never knows about any
 * specific integration: inbound integrations turn external payloads into
 * WickyChat messages through `toMessage`, and outbound ones subscribe to events.
 */
import type { FastifyRequest } from 'fastify'
import { hmacSha256, safeEqual } from '../../core/crypto'

export interface InboundResult {
  /** Plain text, converted to a message body. Null means "acknowledge but don't post". */
  text: string | null
  username?: string
}

export interface InboundIntegration {
  readonly kind: string
  readonly displayName: string
  /** Verifies authenticity beyond the secret URL, when the provider supports signatures. */
  verify?(req: FastifyRequest, rawBody: string, secret: string | null): boolean
  toMessage(req: FastifyRequest, body: unknown): InboundResult
}

const registry = new Map<string, InboundIntegration>()
export const registerIntegration = (i: InboundIntegration) => registry.set(i.kind, i)
export const getIntegration = (kind: string) => registry.get(kind)

registerIntegration({
  kind: 'incoming_webhook',
  displayName: 'Incoming webhook',
  toMessage(_req, body) {
    const b = body as { text?: unknown; username?: unknown }
    if (typeof b?.text !== 'string' || !b.text.trim())
      throw new Error('Expected JSON body with a "text" field')
    return {
      text: b.text.slice(0, 40_000),
      username: typeof b.username === 'string' ? b.username.slice(0, 80) : undefined,
    }
  },
})

/** GitHub repository webhooks: pushes, pull requests, issues and releases. */
registerIntegration({
  kind: 'github',
  displayName: 'GitHub',
  verify(req, rawBody, secret) {
    if (!secret) return false
    const sig = req.headers['x-hub-signature-256']
    return typeof sig === 'string' && safeEqual(sig, `sha256=${hmacSha256(secret, rawBody)}`)
  },
  toMessage(req, body) {
    const event = String(req.headers['x-github-event'] ?? '')
    const b = body as Record<string, any>
    const repo = b.repository?.full_name ?? 'a repository'
    const who = b.sender?.login ?? 'someone'
    switch (event) {
      case 'ping':
        return { text: `GitHub connected to ${repo}.` }
      case 'push': {
        const commits = (b.commits ?? []) as { id: string; message: string }[]
        if (!commits.length) return { text: null }
        const branch = String(b.ref ?? '').replace('refs/heads/', '')
        const lines = commits
          .slice(0, 5)
          .map((c) => `• ${c.id.slice(0, 7)} ${c.message.split('\n')[0]}`)
        const more = commits.length > 5 ? `\n…and ${commits.length - 5} more` : ''
        return {
          text: `${who} pushed ${commits.length} commit${commits.length > 1 ? 's' : ''} to ${repo}:${branch}\n${lines.join('\n')}${more}\n${b.compare ?? ''}`,
        }
      }
      case 'pull_request': {
        const pr = b.pull_request
        if (!['opened', 'closed', 'reopened', 'ready_for_review'].includes(b.action))
          return { text: null }
        const action =
          b.action === 'closed' ? (pr.merged ? 'merged' : 'closed') : b.action.replace(/_/g, ' ')
        return {
          text: `${who} ${action} pull request #${pr.number} in ${repo}: ${pr.title}\n${pr.html_url}`,
        }
      }
      case 'issues': {
        if (!['opened', 'closed', 'reopened'].includes(b.action)) return { text: null }
        return {
          text: `${who} ${b.action} issue #${b.issue.number} in ${repo}: ${b.issue.title}\n${b.issue.html_url}`,
        }
      }
      case 'release':
        if (b.action !== 'published') return { text: null }
        return {
          text: `${who} published ${b.release.name || b.release.tag_name} in ${repo}\n${b.release.html_url}`,
        }
      default:
        return { text: null }
    }
  },
})
