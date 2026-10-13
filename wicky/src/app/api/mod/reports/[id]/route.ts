import { z } from "zod";
import { ok, readJson, route, check, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";

const body = z.object({
  status: z.enum(["resolved", "dismissed", "open"]),
  hide_message: z.boolean().optional(),
  note: z.string().max(500).optional(),
});

export const PATCH = route(async (req: Request, ctx: RouteContext<"/api/mod/reports/[id]">) => {
  const { me, admin } = await requireUser("moderator", "admin");
  const { id } = await ctx.params;
  const input = await readJson(req, body);
  const report = check(await admin.from("reports").select("*").eq("id", id).maybeSingle());
  if (!report) throw new ApiError(404, "report_not_found", "Couldnt find that report");

  if (input.hide_message && report.message_id) {
    const msg = check(
      await admin.from("messages").update({ status: "hidden" }).eq("id", report.message_id).select("kind, body, body_original, user_id").single(),
    );
    if (msg.kind === "text") {
      check(
        await admin.from("moderation_log").insert({
          kind: "text",
          user_id: msg.user_id,
          input: msg.body,
          verdict: "block",
          reason: input.note || report.reason,
          human_override: true,
        }),
      );
    }
  }

  const saved = check(
    await admin
      .from("reports")
      .update({
        status: input.status,
        resolved_by: input.status === "open" ? null : me.id,
        resolved_at: input.status === "open" ? null : new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single(),
  );
  return ok(saved);
});
