/**
 * WickyChat: polls and quizzes posted in channels. Anyone can make a poll; teachers can make
 * quizzes and give coins for taking part (polls) or for the right answer (quizzes).
 */
import { messages, polls, pollVotes, users } from '@quid/db'
import { censorText, POLL_REWARD_MAX, type Poll, topics, type UserSummary } from '@quid/shared'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { type OrgScope, requireOrg } from '../../core/auth'
import type { AppContext } from '../../core/context'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors'
import { type App, orgIdParams } from '../../core/http'
import { requireChannel } from '../channels/service'
import { changeCoins } from '../coins/service'
import { createMessage, serializeMessage } from '../messages/service'
import { toUserSummary, userCols } from '../users/serialize'

type PollRow = typeof polls.$inferSelect

const isTeacher = (scope: OrgScope) => scope.role === 'owner' || scope.role === 'admin'
const isClosed = (p: PollRow) => !!p.closedAt || (!!p.closesAt && p.closesAt < new Date())

async function loadPoll(ctx: AppContext, scope: OrgScope, p: PollRow): Promise<Poll> {
  const votes = await ctx.db
    .select({ optionId: pollVotes.optionId, user: userCols })
    .from(pollVotes)
    .innerJoin(users, eq(users.id, pollVotes.userId))
    .where(eq(pollVotes.pollId, p.id))
  const closed = isClosed(p)
  const myVotes = votes.filter((v) => v.user.id === scope.userId).map((v) => v.optionId)
  const teacher = isTeacher(scope)
  const voters: Record<string, UserSummary[]> = {}
  if (!p.anonymous || teacher)
    for (const v of votes) {
      voters[v.optionId] = [...(voters[v.optionId] ?? []), toUserSummary(v.user)]
    }
  return {
    id: p.id,
    messageId: p.messageId,
    channelId: p.channelId,
    kind: p.kind as Poll['kind'],
    question: p.question,
    options: p.options.map((o) => ({
      ...o,
      votes: votes.filter((v) => v.optionId === o.id).length,
    })),
    totalVoters: new Set(votes.map((v) => v.user.id)).size,
    multiple: p.multiple,
    anonymous: p.anonymous,
    reward: p.reward,
    myVotes,
    correctOptionId:
      p.kind === 'quiz' && (myVotes.length || closed || teacher) ? p.correctOptionId : null,
    closesAt: p.closesAt?.toISOString() ?? null,
    closed,
    // Quiz answers stay hidden from students until it closes, so nobody copies.
    voters: p.kind === 'quiz' && !teacher && !closed ? {} : voters,
    canClose: !closed && (p.creatorId === scope.userId || teacher),
  }
}

async function getPoll(ctx: AppContext, scope: OrgScope, id: string) {
  const p = await ctx.db.query.polls.findFirst({
    where: and(eq(polls.id, id), eq(polls.orgId, scope.orgId)),
  })
  if (!p) throw notFound('Poll')
  await requireChannel(ctx, scope, p.channelId, 'read')
  return p
}

export async function pollRoutes(app: App, ctx: AppContext) {
  app.post(
    '/api/orgs/:orgId/channels/:id/polls',
    {
      schema: {
        params: orgIdParams,
        body: z.object({
          kind: z.enum(['poll', 'quiz']).default('poll'),
          question: z.string().trim().min(1).max(200),
          options: z.array(z.string().trim().min(1).max(80)).min(2).max(10),
          correctIndex: z.number().int().min(0).max(9).optional(),
          multiple: z.boolean().default(false),
          anonymous: z.boolean().default(false),
          reward: z.number().int().min(0).max(POLL_REWARD_MAX).default(0),
          closesInMinutes: z
            .number()
            .int()
            .min(1)
            .max(60 * 24 * 14)
            .optional(),
        }),
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const { channel } = await requireChannel(ctx, scope, req.params.id, 'post')
      const b = req.body
      const teacher = isTeacher(scope)
      if (b.kind === 'quiz' && !teacher) throw forbidden('Only teachers can make quizzes.')
      if (b.reward > 0 && !teacher) throw forbidden('Only teachers can give coins for polls.')
      if (b.kind === 'quiz' && (b.correctIndex === undefined || b.correctIndex >= b.options.length))
        throw badRequest('Pick the right answer for the quiz.')
      const question = censorText(b.question).text
      const options = b.options.map((t, i) => ({ id: `o${i}`, text: censorText(t).text }))

      const label = b.kind === 'quiz' ? '🧠 Quiz' : '📊 Poll'
      const message = await createMessage(ctx, scope, channel, {
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: `${label}: ${question}` }],
            },
          ],
        },
        fileIds: [],
      })
      const [poll] = await ctx.db
        .insert(polls)
        .values({
          orgId: scope.orgId,
          channelId: channel.id,
          messageId: message.id,
          creatorId: scope.userId,
          kind: b.kind,
          question,
          options,
          correctOptionId: b.kind === 'quiz' ? `o${b.correctIndex}` : null,
          multiple: b.kind === 'quiz' ? false : b.multiple,
          anonymous: b.anonymous,
          reward: b.reward,
          closesAt: b.closesInMinutes ? new Date(Date.now() + b.closesInMinutes * 60_000) : null,
        })
        .returning()
      // The message went out before the poll existed; send it again with the poll attached.
      const row = await ctx.db.query.messages.findFirst({ where: eq(messages.id, message.id) })
      const full = await serializeMessage(ctx, scope.userId, row!)
      await ctx.bus.publish(topics.channel(channel.id), {
        type: 'message.updated',
        orgId: scope.orgId,
        message: full,
      })
      return reply.code(201).send(await loadPoll(ctx, scope, poll!))
    },
  )

  app.get('/api/orgs/:orgId/polls/:id', { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    return loadPoll(ctx, scope, await getPoll(ctx, scope, req.params.id))
  })

  app.post(
    '/api/orgs/:orgId/polls/:id/vote',
    {
      schema: {
        params: orgIdParams,
        body: z.object({ optionIds: z.array(z.string().max(4)).max(10) }),
      },
    },
    async (req) => {
      const scope = await requireOrg(ctx, req, req.params.orgId)
      const p = await getPoll(ctx, scope, req.params.id)
      if (isClosed(p)) throw badRequest('This poll is closed.')
      const valid = new Set(p.options.map((o) => o.id))
      const picked = [...new Set(req.body.optionIds)].filter((o) => valid.has(o))
      if (!p.multiple && picked.length > 1) throw badRequest('Pick just one.')
      if (p.kind === 'quiz' && picked.length !== 1) throw badRequest('Pick an answer.')

      await ctx.db.transaction(async (tx) => {
        const before = await tx
          .select({ optionId: pollVotes.optionId })
          .from(pollVotes)
          .where(and(eq(pollVotes.pollId, p.id), eq(pollVotes.userId, scope.userId)))
          .for('update')
        if (p.kind === 'quiz' && before.length) throw conflict("You've already answered this quiz.")
        await tx
          .delete(pollVotes)
          .where(and(eq(pollVotes.pollId, p.id), eq(pollVotes.userId, scope.userId)))
        if (picked.length)
          await tx
            .insert(pollVotes)
            .values(picked.map((optionId) => ({ pollId: p.id, userId: scope.userId, optionId })))
        // Coins only for the first answer.
        if (!before.length && picked.length && p.reward > 0) {
          if (p.kind === 'poll') await changeCoins(tx, scope.userId, p.reward, 'poll', p.id)
          else if (picked[0] === p.correctOptionId)
            await changeCoins(tx, scope.userId, p.reward, 'quiz', p.id)
        }
      })
      return loadPoll(ctx, scope, p)
    },
  )

  app.post('/api/orgs/:orgId/polls/:id/close', { schema: { params: orgIdParams } }, async (req) => {
    const scope = await requireOrg(ctx, req, req.params.orgId)
    const p = await getPoll(ctx, scope, req.params.id)
    if (p.creatorId !== scope.userId && !isTeacher(scope)) throw forbidden()
    const [row] = await ctx.db
      .update(polls)
      .set({ closedAt: new Date() })
      .where(eq(polls.id, p.id))
      .returning()
    return loadPoll(ctx, scope, row!)
  })
}
