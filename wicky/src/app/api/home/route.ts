import { ok, route, check } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import type { HomeChat, Person } from "@/lib/types";

export const GET = route(async () => {
  const { me, supabase, admin } = await requireUser();
  const chats = check(await supabase.rpc("home_feed")) as HomeChat[];
  const ids = [...new Set(chats.flatMap((c) => c.member_ids ?? []))];
  const people = ids.length
    ? (check(await admin.from("profiles").select("id, email, name, avatar_url, role").in("id", ids)) as Person[])
    : [];
  const total_unread = chats.reduce((sum, c) => sum + Number(c.unread_count), 0);
  return ok({ me, total_unread, chats, people });
});
