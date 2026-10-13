import { z } from "zod";
import { ok, readJson, route, check, ApiError } from "@/lib/api";
import { requireMember, requireUser } from "@/lib/auth";

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/chats/[id]">) => {
  const { me, admin } = await requireUser();
  const { id } = await ctx.params;
  const my_role = await requireMember(id, me);
  const chat = check(await admin.from("chats").select("*").eq("id", id).maybeSingle());
  if (!chat) throw new ApiError(404, "chat_not_found", "That chat doesnt exist");
  const rows = check(
    await admin.from("chat_members").select("member_role, last_read_at, profiles(id, email, name, avatar_url, role)").eq("chat_id", id),
  ) as unknown as { member_role: string; last_read_at: string; profiles: Record<string, unknown> }[];
  const members = rows.map((r) => ({ ...r.profiles, member_role: r.member_role, last_read_at: r.last_read_at }));
  return ok({ ...chat, my_role, members });
});

const body = z.object({ name: z.string().trim().max(80).nullable() });

export const PATCH = route(async (req: Request, ctx: RouteContext<"/api/chats/[id]">) => {
  const { me, admin } = await requireUser();
  const { id } = await ctx.params;
  await requireMember(id, me, "owner", "manager");
  const input = await readJson(req, body);
  const chat = check(await admin.from("chats").update({ name: input.name || null }).eq("id", id).select("*").single());
  return ok(chat);
});
