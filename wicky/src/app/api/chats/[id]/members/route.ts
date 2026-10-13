import { z } from "zod";
import { ok, readJson, route, check, ApiError } from "@/lib/api";
import { requireMember, requireUser } from "@/lib/auth";

const body = z.object({ user_id: z.uuid() });

export const POST = route(async (req: Request, ctx: RouteContext<"/api/chats/[id]/members">) => {
  const { me, admin } = await requireUser();
  const { id } = await ctx.params;
  await requireMember(id, me, "owner", "manager");
  const { user_id } = await readJson(req, body);
  const chat = check(await admin.from("chats").select("kind").eq("id", id).single());
  if (chat.kind !== "group") throw new ApiError(400, "not_group", "You can only add people to group chats, make a new group instead");
  const member = check(await admin.from("chat_members").upsert({ chat_id: id, user_id }, { onConflict: "chat_id,user_id", ignoreDuplicates: true }).select("*"));
  return ok(member[0] ?? null, 201);
});
