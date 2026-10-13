import { ok, route, check, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/users/[id]">) => {
  const { admin } = await requireUser();
  const { id } = await ctx.params;
  const person = check(await admin.from("profiles").select("id, email, name, avatar_url, role, created_at").eq("id", id).maybeSingle());
  if (!person) throw new ApiError(404, "user_not_found", "Couldnt find that person");
  return ok(person);
});
