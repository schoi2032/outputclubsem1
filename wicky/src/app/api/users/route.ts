import { ok, route, check } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const GET = route(async (req: Request) => {
  const { admin } = await requireUser();
  const q = new URL(req.url).searchParams.get("q")?.trim().replace(/[%_,()]/g, "") ?? "";
  let query = admin.from("profiles").select("id, email, name, avatar_url, role").order("name").limit(30);
  if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%`);
  return ok(check(await query));
});
