import { z } from "zod";
import { ok, readJson, route, check } from "@/lib/api";
import { requireUser } from "@/lib/auth";

const body = z.object({ status: z.enum(["visible", "hidden"]) });

export const PATCH = route(async (req: Request, ctx: RouteContext<"/api/mod/messages/[id]">) => {
  const { admin } = await requireUser("moderator", "admin");
  const { id } = await ctx.params;
  const { status } = await readJson(req, body);
  const msg = check(await admin.from("messages").update({ status }).eq("id", id).select("id, kind, body, user_id, status").single());
  if (msg.kind === "text") {
    check(
      await admin.from("moderation_log").insert({
        kind: "text",
        user_id: msg.user_id,
        input: msg.body,
        verdict: status === "hidden" ? "block" : "allow",
        reason: "moderator decision",
        human_override: true,
      }),
    );
  }
  return ok(msg);
});
