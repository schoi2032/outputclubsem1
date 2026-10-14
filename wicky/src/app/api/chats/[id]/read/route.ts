import { ok, route, check } from "@/lib/api";
import { requireMember, requireUser } from "@/lib/auth";

export const POST = route(async (_req: Request, ctx: RouteContext<"/api/chats/[id]/read">) => {
  const { me, admin } = await requireUser();
  const { id } = await ctx.params;
  await requireMember(id, me);
  const last_read_at = new Date().toISOString();
  check(await admin.from("chat_members").update({ last_read_at }).eq("chat_id", id).eq("user_id", me.id));
  return ok({ last_read_at });
});
