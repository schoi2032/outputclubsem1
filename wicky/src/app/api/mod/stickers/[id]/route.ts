import { z } from "zod";
import { ok, readJson, route, check, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";

const body = z.object({
  status: z.enum(["approved", "rejected"]),
  reason: z.string().max(300).optional(),
  official: z.boolean().optional(),
});

export const PATCH = route(async (req: Request, ctx: RouteContext<"/api/mod/stickers/[id]">) => {
  const { me, admin } = await requireUser("moderator", "admin");
  const { id } = await ctx.params;
  const input = await readJson(req, body);
  const sticker = check(await admin.from("stickers").select("*").eq("id", id).maybeSingle());
  if (!sticker) throw new ApiError(404, "sticker_not_found", "Couldnt find that sticker");
  if (input.status === "approved" && sticker.status === "rejected") {
    throw new ApiError(409, "file_gone", "Rejected sticker files get deleted, ask them to upload it again");
  }
  if (input.status === "rejected") {
    await admin.storage.from("stickers").remove([sticker.path]);
  }
  const update: Record<string, unknown> = { status: input.status, reject_reason: input.status === "rejected" ? input.reason ?? "Rejected by a moderator" : null };
  if (input.official !== undefined && me.role === "admin") update.is_official = input.official;
  const saved = check(await admin.from("stickers").update(update).eq("id", id).select("*").single());
  check(
    await admin.from("moderation_log").insert({
      kind: "sticker",
      user_id: sticker.owner_id,
      input: sticker.name,
      verdict: input.status === "approved" ? "allow" : "block",
      reason: input.reason ?? "moderator decision",
      human_override: true,
    }),
  );
  return ok(saved);
});
