import { supabaseAdmin } from "./supabase/admin";
import { ApiError, check } from "./api";
import { censor } from "./censor";
import { moderateText } from "./moderation";
import type { AiTag, Message, Profile } from "./types";

const COLUMNS = "id, chat_id, user_id, kind, body, sticker_id, image_path, is_ai, ai_tag, status, created_at";

export function stickerUrl(path: string) {
  return supabaseAdmin().storage.from("stickers").getPublicUrl(path).data.publicUrl;
}

export async function hydrate(rows: Message[]): Promise<Message[]> {
  const admin = supabaseAdmin();
  const stickerIds = [...new Set(rows.map((m) => m.sticker_id).filter(Boolean))] as string[];
  const imagePaths = rows.map((m) => m.image_path).filter(Boolean) as string[];
  const stickers = stickerIds.length
    ? check(await admin.from("stickers").select("id, path").in("id", stickerIds))
    : [];
  const signed = imagePaths.length
    ? (await admin.storage.from("images").createSignedUrls(imagePaths, 60 * 60)).data ?? []
    : [];
  const stickerMap = new Map(stickers.map((s) => [s.id, stickerUrl(s.path)]));
  const imageMap = new Map(signed.map((s) => [s.path, s.signedUrl]));
  return rows.map((m) => ({
    ...m,
    sticker_url: m.sticker_id ? stickerMap.get(m.sticker_id) ?? null : null,
    image_url: m.image_path ? imageMap.get(m.image_path) ?? null : null,
  }));
}

export async function listMessages(chatId: string, opts: { before?: number; limit: number; includeHidden: boolean }) {
  let query = supabaseAdmin().from("messages").select(COLUMNS).eq("chat_id", chatId).order("id", { ascending: false }).limit(opts.limit);
  if (opts.before) query = query.lt("id", opts.before);
  if (!opts.includeHidden) query = query.eq("status", "visible");
  const rows = check(await query) as Message[];
  return hydrate(rows.reverse());
}

export async function getMessage(id: number) {
  const row = check(await supabaseAdmin().from("messages").select(COLUMNS).eq("id", id).maybeSingle()) as Message | null;
  if (!row) return null;
  return (await hydrate([row]))[0];
}

type Draft = {
  kind: Message["kind"];
  body?: string;
  sticker_id?: string;
  image_path?: string;
  ai_generated?: boolean;
};

export async function insertMessage(chatId: string, user: Profile | null, draft: Draft) {
  const row: Record<string, unknown> = { chat_id: chatId, kind: draft.kind, body: draft.body ?? "" };
  if (user) row.user_id = user.id;
  if (draft.sticker_id) row.sticker_id = draft.sticker_id;
  if (draft.image_path) row.image_path = draft.image_path;
  let tag: AiTag | null = null;
  let moderation = null;

  if (draft.kind === "ai") {
    row.is_ai = true;
    tag = "bot";
  } else if (draft.kind === "text" && user) {
    const clean = censor(draft.body ?? "");
    if (clean.censored) row.body_original = draft.body;
    row.body = clean.text;
    const verdict = await moderateText(clean.text, user.id);
    if (!verdict.allowed) {
      throw new ApiError(422, "blocked_by_moderation", `Message blocked: ${verdict.reason}`);
    }
    moderation = { censored: clean.censored, checked: verdict.checked };
    if (draft.ai_generated) tag = "self_tagged";
    else if (verdict.likelyAi) tag = "likely_ai";
  }
  row.ai_tag = tag;

  const saved = check(await supabaseAdmin().from("messages").insert(row).select(COLUMNS).single()) as Message;
  return { message: (await hydrate([saved]))[0], moderation };
}
