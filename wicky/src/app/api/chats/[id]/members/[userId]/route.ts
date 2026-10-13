import { z } from "zod";
import { ok, readJson, route, check, ApiError } from "@/lib/api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireMember, requireUser } from "@/lib/auth";

const body = z.object({ member_role: z.enum(["owner", "manager", "member"]) });

async function targetOf(chatId: string, userId: string, admin: SupabaseClient) {
  const row = check(
    await admin.from("chat_members").select("member_role, profiles(role)").eq("chat_id", chatId).eq("user_id", userId).maybeSingle(),
  ) as unknown as { member_role: string; profiles: { role: string } } | null;
  if (!row) throw new ApiError(404, "member_not_found", "That person isnt in this chat");
  return row;
}

export const PATCH = route(async (req: Request, ctx: RouteContext<"/api/chats/[id]/members/[userId]">) => {
  const { me, admin } = await requireUser();
  const { id, userId } = await ctx.params;
  const myRole = await requireMember(id, me, "owner", "manager");
  const { member_role } = await readJson(req, body);
  const target = await targetOf(id, userId, admin);
  if (target.profiles.role === "teacher" && me.role !== "teacher") {
    throw new ApiError(403, "teacher_locked", "Students cant change a teachers role in a chat");
  }
  if (member_role === "owner" && myRole !== "owner") {
    throw new ApiError(403, "forbidden", "Only the owner can hand over ownership");
  }
  if (member_role === "owner") {
    check(await admin.from("chat_members").update({ member_role: "manager" }).eq("chat_id", id).eq("user_id", me.id));
  }
  const saved = check(await admin.from("chat_members").update({ member_role }).eq("chat_id", id).eq("user_id", userId).select("*").single());
  return ok(saved);
});

export const DELETE = route(async (_req: Request, ctx: RouteContext<"/api/chats/[id]/members/[userId]">) => {
  const { me, admin } = await requireUser();
  const { id, userId } = await ctx.params;
  if (userId === me.id) {
    const myRole = await requireMember(id, me);
    if (myRole === "owner") {
      const next = check(
        await admin.from("chat_members").select("user_id").eq("chat_id", id).neq("user_id", me.id).order("member_role").order("joined_at").limit(1),
      );
      if (next[0]) check(await admin.from("chat_members").update({ member_role: "owner" }).eq("chat_id", id).eq("user_id", next[0].user_id));
    }
  } else {
    await requireMember(id, me, "owner", "manager");
    const target = await targetOf(id, userId, admin);
    if (target.profiles.role === "teacher" && me.role !== "teacher") {
      throw new ApiError(403, "teacher_locked", "Students cant remove a teacher from a chat");
    }
    if (target.member_role === "owner") throw new ApiError(403, "forbidden", "You cant remove the owner");
  }
  check(await admin.from("chat_members").delete().eq("chat_id", id).eq("user_id", userId));
  return ok({ removed: userId });
});
