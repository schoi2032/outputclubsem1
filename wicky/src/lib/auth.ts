import { supabaseServer } from "./supabase/server";
import { supabaseAdmin } from "./supabase/admin";
import { ApiError } from "./api";
import { isSchoolEmail } from "./school";
import type { MemberRole, Profile, Role } from "./types";

export async function requireUser(...roles: Role[]) {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user || !isSchoolEmail(data.user.email)) {
    throw new ApiError(401, "not_signed_in", "You need to sign in with your school account");
  }
  const admin = supabaseAdmin();
  const { data: profile } = await admin.from("profiles").select("*").eq("id", data.user.id).single();
  if (!profile) throw new ApiError(401, "no_profile", "Your profile is missing, try signing in again");
  if (roles.length && !roles.includes(profile.role)) {
    throw new ApiError(403, "forbidden", "You dont have permission to do that");
  }
  return { me: profile as Profile, supabase, admin };
}

export function isMod(me: Profile) {
  return me.role === "moderator" || me.role === "admin";
}

export async function requireMember(chatId: string, me: Profile, ...roles: MemberRole[]) {
  const { data } = await supabaseAdmin()
    .from("chat_members")
    .select("member_role")
    .eq("chat_id", chatId)
    .eq("user_id", me.id)
    .maybeSingle();
  if (!data) {
    if (isMod(me) && !roles.length) return null;
    throw new ApiError(404, "chat_not_found", "That chat doesnt exist or your not in it");
  }
  if (roles.length && !roles.includes(data.member_role)) {
    throw new ApiError(403, "forbidden", "Only the chat owner or a manager can do that");
  }
  return data.member_role as MemberRole;
}
