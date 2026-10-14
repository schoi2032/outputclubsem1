import { z } from "zod";
import { ok, readJson, route, check } from "@/lib/api";
import { requireUser } from "@/lib/auth";

const settingsSchema = z
  .object({
    theme: z.string().max(40),
    accent: z.string().regex(/^#[0-9a-fA-F]{3,8}$/),
    font: z.string().max(60),
    font_size: z.number().int().min(10).max(28),
    compact: z.boolean(),
    enter_to_send: z.boolean(),
    show_ai_tags: z.boolean(),
    sounds: z.boolean(),
    custom_css: z.string().max(20000),
  })
  .partial()
  .strict();

const body = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  settings: settingsSchema.optional(),
});

export const GET = route(async () => {
  const { me } = await requireUser();
  return ok(me);
});

export const PATCH = route(async (req: Request) => {
  const { me, admin } = await requireUser();
  const input = await readJson(req, body);
  const update: Record<string, unknown> = {};
  if (input.name) update.name = input.name;
  if (input.settings) update.settings = { ...me.settings, ...input.settings };
  if (!Object.keys(update).length) return ok(me);
  const saved = check(await admin.from("profiles").update(update).eq("id", me.id).select("*").single());
  return ok(saved);
});
