/**
 * Media provider abstraction for WickyChat Voice and WickyChat Meet (Stages C and D).
 * LiveKit is the first implementation. Business logic only talks to this
 * interface, so the SFU can be replaced later.
 */
import type { Config } from '../core/config'

export interface MediaGrant {
  room: string
  identity: string
  name: string
  canPublish: boolean
  canSubscribe: boolean
  canPublishData: boolean
  roomAdmin: boolean
}

export interface MediaProvider {
  readonly name: string
  readonly configured: boolean
  /** Issues a short-lived join token for a client. */
  createJoinToken(grant: MediaGrant): Promise<{ url: string; token: string }>
  /** Disconnects someone from a room (host removing a participant). */
  removeParticipant(room: string, identity: string): Promise<void>
  /** Server-side mute of someone's microphone. They can unmute themselves. */
  muteMicrophone(room: string, identity: string): Promise<void>
  /** Disconnects everyone and closes the room. */
  endRoom(room: string): Promise<void>
  /** Grants or revokes the right to speak (publish audio) without reconnecting. */
  setCanPublish(room: string, identity: string, canPublish: boolean): Promise<void>
}

class LiveKitProvider implements MediaProvider {
  readonly name = 'livekit'
  readonly configured = true
  private rooms: Promise<import('livekit-server-sdk').RoomServiceClient> | null = null
  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly secret: string,
  ) {}

  /** The room service speaks HTTP(S) on the same host as the WebSocket URL. */
  private roomService() {
    this.rooms ??= import('livekit-server-sdk').then(
      (m) => new m.RoomServiceClient(this.url.replace(/^ws/, 'http'), this.key, this.secret),
    )
    return this.rooms
  }

  /** "Not found" means the person or room is already gone, which is what we wanted. */
  private async ignoreMissing(fn: () => Promise<unknown>) {
    try {
      await fn()
    } catch (e) {
      if (!/not.?found|does not exist/i.test(String((e as Error)?.message ?? e))) throw e
    }
  }

  async removeParticipant(room: string, identity: string) {
    const rs = await this.roomService()
    await this.ignoreMissing(() => rs.removeParticipant(room, identity))
  }

  async muteMicrophone(room: string, identity: string) {
    const rs = await this.roomService()
    const { TrackSource } = await import('livekit-server-sdk')
    await this.ignoreMissing(async () => {
      const p = await rs.getParticipant(room, identity)
      for (const t of p.tracks) {
        if (t.source === TrackSource.MICROPHONE && !t.muted)
          await rs.mutePublishedTrack(room, identity, t.sid, true)
      }
    })
  }

  async endRoom(room: string) {
    const rs = await this.roomService()
    await this.ignoreMissing(() => rs.deleteRoom(room))
  }

  async setCanPublish(room: string, identity: string, canPublish: boolean) {
    const rs = await this.roomService()
    await this.ignoreMissing(() =>
      rs.updateParticipant(room, identity, undefined, {
        canPublish,
        canSubscribe: true,
        canPublishData: true,
      }),
    )
  }

  async createJoinToken(g: MediaGrant) {
    const { AccessToken } = await import('livekit-server-sdk')
    const at = new AccessToken(this.key, this.secret, {
      identity: g.identity,
      name: g.name,
      ttl: '10m',
    })
    at.addGrant({
      room: g.room,
      roomJoin: true,
      canPublish: g.canPublish,
      canSubscribe: g.canSubscribe,
      canPublishData: g.canPublishData,
      roomAdmin: g.roomAdmin,
    })
    return { url: this.url, token: await at.toJwt() }
  }
}

class UnconfiguredProvider implements MediaProvider {
  readonly name = 'none'
  readonly configured = false
  async createJoinToken(): Promise<never> {
    throw new Error('No media provider configured')
  }
  async removeParticipant() {}
  async muteMicrophone() {}
  async endRoom() {}
  async setCanPublish() {}
}

export function createMediaProvider(config: Config): MediaProvider {
  if (config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET) {
    return new LiveKitProvider(
      config.LIVEKIT_URL,
      config.LIVEKIT_API_KEY,
      config.LIVEKIT_API_SECRET,
    )
  }
  return new UnconfiguredProvider()
}
