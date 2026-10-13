import { randomUUID } from "crypto";
import { ok, route, ApiError } from "@/lib/api";
import { requireMember, requireUser } from "@/lib/auth";
import { insertMessage } from "@/lib/messages";
import { moderateImage } from "@/lib/moderation";
import { readImage } from "@/lib/uploads";

export const POST = route(async (req: Request, ctx: RouteContext<"/api/chats/[id]/images">) => {
  const { me, admin } = await requireUser();
  const { id } = await ctx.params;
  const role = await requireMember(id, me);
  if (!role) throw new ApiError(403, "forbidden", "Your not in this chat");
  const { bytes, type, ext, form } = await readImage(req, 4 * 1024 * 1024);
  const caption = String(form.get("caption") ?? "").slice(0, 300);
  const verdict = await moderateImage(bytes, type, me.id, "image", caption || "chat image");
  if (!verdict.allowed) {
    const why = verdict.checked ? verdict.reason : "Image checking is down right now, try again later";
    throw new ApiError(422, "blocked_by_moderation", `Image blocked: ${why}`);
  }
  const path = `${id}/${randomUUID()}.${ext}`;
  const { error } = await admin.storage.from("images").upload(path, bytes, { contentType: type });
  if (error) throw new Error(error.message);
  const { message } = await insertMessage(id, me, { kind: "image", image_path: path, body: caption });
  return ok({ message, moderation: { ai_slop: verdict.aiSlop } }, 201);
});
