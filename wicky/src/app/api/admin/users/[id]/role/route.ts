import { z } from "zod";
import { ok, readJson, route, check } from "@/lib/api";
import { requireUser } from "@/lib/auth";

const body = z.object({ role: z.enum(["student", "teacher", "moderator", "admin"]) });

export const PATCH = route(async (req: Request, ctx: RouteContext<"/api/admin/users/[id]/role">) => {
  const { admin } = await requireUser("admin");
  const { id } = await ctx.params;
  const { role } = await readJson(req, body);
  const saved = check(await admin.from("profiles").update({ role }).eq("id", id).select("id, email, name, role").single());
  return ok(saved);
});
