import { z } from "zod";
import { ok, readJson, route, check, ApiError } from "@/lib/api";
import { requireMember, requireUser } from "@/lib/auth";

const body = z.union([
  z.object({ message_id: z.number().int().positive(), reason: z.string().trim().min(1).max(1000) }),
  z.object({ user_id: z.uuid(), reason: z.string().trim().min(1).max(1000) }),
]);

export const GET = route(async () => {
  const { me, admin } = await requireUser();
  return ok(check(await admin.from("reports").select("*").eq("reporter_id", me.id).order("created_at", { ascending: false })));
});

export const POST = route(async (req: Request) => {
  const { me, admin } = await requireUser();
  const input = await readJson(req, body);
  const row: Record<string, unknown> = { reporter_id: me.id, reason: input.reason };
  if ("message_id" in input) {
    const msg = check(await admin.from("messages").select("chat_id, user_id").eq("id", input.message_id).maybeSingle());
    if (!msg) throw new ApiError(404, "message_not_found", "Couldnt find that message");
    await requireMember(msg.chat_id, me);
    Object.assign(row, { target_type: "message", message_id: input.message_id, user_id: msg.user_id });
  } else {
    if (input.user_id === me.id) throw new ApiError(400, "bad_input", "You cant report yourself");
    Object.assign(row, { target_type: "user", user_id: input.user_id });
  }
  const report = check(await admin.from("reports").insert(row).select("*").single());
  return ok(report, 201);
});
