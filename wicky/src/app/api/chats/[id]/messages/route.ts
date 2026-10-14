import { z } from "zod";
import { ok, readJson, route, check, ApiError } from "@/lib/api";
import { isMod, requireMember, requireUser } from "@/lib/auth";
import { insertMessage, listMessages } from "@/lib/messages";

export const GET = route(async (req: Request, ctx: RouteContext<"/api/chats/[id]/messages">) => {
  const { me } = await requireUser();
  const { id } = await ctx.params;
  await requireMember(id, me);
  const params = new URL(req.url).searchParams;
  const before = Number(params.get("before")) || undefined;
  const limit = Math.min(Math.max(Number(params.get("limit")) || 50, 1), 100);
  const messages = await listMessages(id, { before, limit, includeHidden: isMod(me) });
  return ok({ messages, has_more: messages.length === limit });
});

const body = z.union([
  z.object({ body: z.string().trim().min(1).max(4000), ai_generated: z.boolean().optional() }),
  z.object({ sticker_id: z.uuid() }),
]);

export const POST = route(async (req: Request, ctx: RouteContext<"/api/chats/[id]/messages">) => {
  const { me, admin } = await requireUser();
  const { id } = await ctx.params;
  const role = await requireMember(id, me);
  if (!role) throw new ApiError(403, "forbidden", "Moderators can read this chat but your not in it");
  const input = await readJson(req, body);
  if ("sticker_id" in input) {
    const sticker = check(await admin.from("stickers").select("id, status").eq("id", input.sticker_id).maybeSingle());
    if (!sticker || sticker.status !== "approved") throw new ApiError(404, "sticker_not_found", "That sticker isnt available");
    const { message } = await insertMessage(id, me, { kind: "sticker", sticker_id: sticker.id });
    return ok({ message, moderation: null }, 201);
  }
  const result = await insertMessage(id, me, { kind: "text", body: input.body, ai_generated: input.ai_generated });
  return ok(result, 201);
});
