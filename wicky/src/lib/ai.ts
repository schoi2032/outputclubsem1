export const TEXT_MODEL = process.env.AI_MODEL || "openai/gpt-5-mini";
export const VISION_MODEL = process.env.AI_VISION_MODEL || TEXT_MODEL;

export function aiEnabled() {
  return !!(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}
