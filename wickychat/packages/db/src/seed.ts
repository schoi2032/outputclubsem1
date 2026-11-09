/**
 * Development seed. Creates a clearly labelled demo organization so the app can
 * be explored locally. Refuses to run when NODE_ENV=production.
 */
import { hash } from '@node-rs/argon2'
import { docToText, textToDoc } from '@quid/shared'
import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { createDb } from './index'
import * as s from './schema'

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed a production database.')
  process.exit(1)
}

const PASSWORD = 'quid-dev-password'
const SLUG = 'dev-acme'

const people = [
  { name: 'Ada Park', email: 'ada@dev.quid.local', role: 'owner', title: 'CEO' },
  { name: 'Ben Ortiz', email: 'ben@dev.quid.local', role: 'admin', title: 'Head of Engineering' },
  { name: 'Chloe Nguyen', email: 'chloe@dev.quid.local', role: 'dept_admin', title: 'Design Lead' },
  {
    name: 'Dev Raman',
    email: 'dev@dev.quid.local',
    role: 'team_manager',
    title: 'Platform Manager',
  },
  { name: 'Eli Kim', email: 'eli@dev.quid.local', role: 'member', title: 'Software Engineer' },
  { name: 'Faye Laurent', email: 'faye@dev.quid.local', role: 'guest', title: 'Contractor' },
] as const

async function main() {
  const url = process.env.DATABASE_URL ?? 'postgres://quid:quid@localhost:5432/quid'
  const { db, client } = createDb(url, { max: 1 })

  const existing = await db.query.organizations.findFirst({ where: eq(s.organizations.slug, SLUG) })
  if (existing) {
    console.log(`Seed org "${SLUG}" already exists. Drop it or reset the database to reseed.`)
    await client.end()
    return
  }

  const passwordHash = await hash(PASSWORD)
  const now = new Date()

  await db.transaction(async (tx) => {
    const userIds: string[] = []
    for (const p of people) {
      const found = await tx.query.users.findFirst({ where: eq(s.users.email, p.email) })
      if (found) {
        userIds.push(found.id)
        continue
      }
      const [u] = await tx
        .insert(s.users)
        .values({ email: p.email, name: p.name, passwordHash, emailVerifiedAt: now })
        .returning({ id: s.users.id })
      userIds.push(u!.id)
    }
    const [ada, ben, chloe, dev, eli, faye] = userIds as [
      string,
      string,
      string,
      string,
      string,
      string,
    ]

    const [org] = await tx
      .insert(s.organizations)
      .values({
        slug: SLUG,
        name: '[DEV] Acme Demo',
        description: 'Development seed data. Not a real organization.',
        isDemo: true,
        createdBy: ada,
      })
      .returning()
    const orgId = org!.id

    const [eng] = await tx.insert(s.departments).values({ orgId, name: 'Engineering' }).returning()
    const [design] = await tx.insert(s.departments).values({ orgId, name: 'Design' }).returning()
    const [platform] = await tx
      .insert(s.teams)
      .values({
        orgId,
        name: 'Platform',
        departmentId: eng!.id,
        description: 'Infra and developer experience',
      })
      .returning()

    const deptFor = (i: number) => (i === 2 ? design!.id : i >= 1 && i <= 4 ? eng!.id : null)
    await tx.insert(s.orgMemberships).values(
      people.map((p, i) => ({
        orgId,
        userId: userIds[i]!,
        role: p.role,
        title: p.title,
        departmentId: deptFor(i),
      })),
    )
    await tx.insert(s.teamMembers).values([
      { teamId: platform!.id, userId: dev, orgId, isManager: true },
      { teamId: platform!.id, userId: eli, orgId },
    ])

    const mkChannel = async (
      name: string,
      opts: Partial<typeof s.channels.$inferInsert>,
      members: string[],
    ) => {
      const [c] = await tx
        .insert(s.channels)
        .values({ orgId, kind: 'public', name, createdBy: ada, ...opts })
        .returning()
      await tx.insert(s.channelMembers).values(
        members.map((userId) => ({
          channelId: c!.id,
          userId,
          orgId,
          role: userId === ada ? ('owner' as const) : ('member' as const),
        })),
      )
      return c!
    }

    const staff = [ada, ben, chloe, dev, eli]
    const general = await mkChannel(
      'general',
      { description: 'Company-wide conversation', isDefault: true },
      staff,
    )
    await mkChannel(
      'announcements',
      { description: 'Official updates', postingPolicy: 'admins', isDefault: true },
      staff,
    )
    const engineering = await mkChannel(
      'engineering',
      { departmentId: eng!.id, topic: 'Ship it carefully' },
      [ada, ben, dev, eli],
    )
    await mkChannel('design', { departmentId: design!.id }, [ada, chloe])
    await mkChannel('platform', { kind: 'private', teamId: platform!.id }, [ada, dev, eli])
    await mkChannel('vendor-faye', { kind: 'private', description: 'Shared with our contractor' }, [
      ada,
      ben,
      faye,
    ])

    const post = async (channelId: string, authorId: string, text: string, minutesAgo: number) => {
      const body = textToDoc(text)
      const createdAt = new Date(now.getTime() - minutesAgo * 60_000)
      await tx.insert(s.messages).values({
        id: uuidv7(),
        orgId,
        channelId,
        authorId,
        bodyJson: body,
        bodyText: docToText(body),
        createdAt,
      })
      await tx
        .update(s.channels)
        .set({ lastMessageAt: createdAt })
        .where(eq(s.channels.id, channelId))
    }

    await post(
      general.id,
      ada,
      'Welcome to the [DEV] Acme Demo workspace. Everything here is seed data.',
      120,
    )
    await post(general.id, ben, 'Morning all. Standup notes are in #engineering.', 90)
    await post(engineering.id, dev, 'Deploy window is 3pm today. Ping me if you have blockers.', 60)
    await post(engineering.id, eli, 'Migration PR is up for review.', 30)

    // A DM between Ada and Ben
    const dmKey = [ada, ben].sort().join(':')
    const [dm] = await tx
      .insert(s.channels)
      .values({ orgId, kind: 'dm', dmKey, createdBy: ada })
      .returning()
    await tx.insert(s.channelMembers).values([
      { channelId: dm!.id, userId: ada, orgId },
      { channelId: dm!.id, userId: ben, orgId },
    ])
    await post(dm!.id, ben, 'Got a minute to review the Q4 plan?', 15)
  })

  console.log(`Seeded "[DEV] Acme Demo" at /${SLUG}`)
  console.log(
    `Sign in as ada@dev.quid.local (or ben/chloe/dev/eli/faye) with password: ${PASSWORD}`,
  )
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
