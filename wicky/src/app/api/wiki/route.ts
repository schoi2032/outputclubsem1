import { ok, route, check } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const GET = route(async () => {
  const { admin } = await requireUser();
  return ok(check(await admin.from("wiki_pages").select("slug, title, updated_at").order("title")));
});
