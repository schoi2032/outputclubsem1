'use client'
/**
 * Only one live audio/video session per tab: a call, a voice room or a meeting.
 * Whoever starts a session claims it, and the previous owner is asked to leave.
 */
type Leave = () => Promise<void>

let current: { owner: string; leave: Leave } | null = null

export async function claimSession(owner: string, leave: Leave) {
  if (current && current.owner !== owner) {
    const prev = current
    current = null
    await prev.leave().catch(() => {})
  }
  current = { owner, leave }
}

export function releaseSession(owner: string) {
  if (current?.owner === owner) current = null
}
