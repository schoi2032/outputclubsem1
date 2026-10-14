import { ok, route, check } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { stickerUrl } from "@/lib/messages";
import type { Sticker } from "@/lib/types";

export const GET = route(async (req: Request) => {
  const { admin } = await requireUser("moderator", "admin");
  const status = new URL(req.url).searchParams.get("status") || "pending";
  const rows = check(await admin.from("stickers").select("*").eq("status", status).order("created_at", { ascending: false }).limit(100)) as Sticker[];
  return ok(rows.map((s) => ({ ...s, url: status === "rejected" ? null : stickerUrl(s.path) })));
});
