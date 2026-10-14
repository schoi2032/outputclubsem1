import { randomUUID } from "crypto";
import { ok, route, check, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { stickerUrl } from "@/lib/messages";
import { moderateImage } from "@/lib/moderation";
import { readImage } from "@/lib/uploads";
import type { Sticker } from "@/lib/types";

export const GET = route(async (req: Request) => {
  const { me, admin } = await requireUser();
  const mine = new URL(req.url).searchParams.get("mine") === "1";
  let query = admin.from("stickers").select("*").order("is_official", { ascending: false }).order("created_at", { ascending: false });
  query = mine ? query.eq("owner_id", me.id) : query.eq("status", "approved");
  const rows = check(await query) as Sticker[];
  return ok(rows.map((s) => ({ ...s, url: stickerUrl(s.path) })));
});

export const POST = route(async (req: Request) => {
  const { me, admin } = await requireUser();
  const { bytes, type, ext, form } = await readImage(req, 2 * 1024 * 1024);
  const name = String(form.get("name") ?? "").trim().slice(0, 40);
  if (!name) throw new ApiError(400, "bad_input", "Give the sticker a name");
  const official = form.get("official") === "true" && me.role === "admin";
  const verdict = await moderateImage(bytes, type, me.id, "sticker", name);

  let status: Sticker["status"] = "approved";
  let reject_reason: string | null = null;
  if (!verdict.checked) {
    status = "pending";
  } else if (!verdict.allowed) {
    status = "rejected";
    reject_reason = verdict.reason;
  } else if (verdict.aiSlop) {
    status = "rejected";
    reject_reason = "Looks like AI generated art, we only take stickers people actually made";
  }

  const path = `${me.id}/${randomUUID()}.${ext}`;
  if (status !== "rejected") {
    const { error } = await admin.storage.from("stickers").upload(path, bytes, { contentType: type });
    if (error) throw new Error(error.message);
  }
  const sticker = check(
    await admin
      .from("stickers")
      .insert({ owner_id: me.id, name, path, is_gif: type === "image/gif", is_official: official, status, reject_reason })
      .select("*")
      .single(),
  ) as Sticker;
  return ok({ ...sticker, url: status === "rejected" ? null : stickerUrl(path) }, 201);
});
