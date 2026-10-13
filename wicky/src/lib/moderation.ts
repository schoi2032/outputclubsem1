import { generateText, Output, type ModelMessage } from "ai";
import { z } from "zod";
import { supabaseAdmin } from "./supabase/admin";
import { aiEnabled, TEXT_MODEL, VISION_MODEL } from "./ai";

const textVerdict = z.object({
  allowed: z.boolean(),
  categories: z.array(z.enum(["bullying", "harassment", "hate", "sexual", "violence", "self_harm", "personal_info", "spam", "cheating", "other"])),
  reason: z.string(),
  likely_ai_written: z.boolean(),
});

const imageVerdict = z.object({
  allowed: z.boolean(),
  categories: z.array(z.enum(["sexual", "violence", "gore", "hate", "drugs", "weapons", "personal_info", "bullying", "other"])),
  reason: z.string(),
  ai_slop: z.boolean(),
});

export type TextResult = { allowed: boolean; categories: string[]; reason: string; likelyAi: boolean; checked: boolean };
export type ImageResult = { allowed: boolean; categories: string[]; reason: string; aiSlop: boolean; checked: boolean };

const TEXT_RULES = `You moderate a school chat app for Chadwick School students (ages 11 to 18) and teachers.
Block messages with bullying, harassment, hate, sexual content, threats or violence, self harm encouragement, sharing someones private info (phone numbers, addresses, passwords), or obvious spam.
Normal teen talk, jokes between friends, mild slang and arguing about homework are fine. Swear words are already censored before you see them, so dont block just for **** stars.
Also guess if the message looks like it was written by an AI chatbot (long, polished, generic, "Certainly! Here is..." style). Short casual messages are never AI written.`;

const IMAGE_RULES = `You moderate images in a school chat app for students ages 11 to 18.
Block anything sexual or suggestive, gore, violence, hate symbols, drugs, weapons, pictures that show private info (like a screenshot of someones address or grades) or images made to bully a real person.
Memes, selfies, homework photos, drawings and school stuff are fine.
Set ai_slop to true if the image looks like low effort AI generated art: glossy plastic look, weird hands or text, overly smooth generic fantasy style.`;

async function examples(kind: "text" | "image" | "sticker") {
  const { data } = await supabaseAdmin()
    .from("moderation_log")
    .select("input, verdict, reason")
    .eq("kind", kind)
    .eq("human_override", true)
    .order("id", { ascending: false })
    .limit(20);
  if (!data?.length) return "";
  return (
    "\n\nModerators at this school corrected these past decisions, follow them:\n" +
    data.map((row) => `- ${JSON.stringify(row.input.slice(0, 300))} => ${row.verdict}${row.reason ? ` (${row.reason})` : ""}`).join("\n")
  );
}

async function log(kind: "text" | "image" | "sticker", userId: string | null, input: string, verdict: "allow" | "block" | "error", categories: string[], reason: string, model: string | null) {
  await supabaseAdmin().from("moderation_log").insert({ kind, user_id: userId, input, verdict, categories, reason, model });
}

export async function moderateText(text: string, userId: string | null): Promise<TextResult> {
  if (!aiEnabled() || process.env.MODERATION_TEXT === "off") {
    return { allowed: true, categories: [], reason: "ai moderation off", likelyAi: false, checked: false };
  }
  try {
    const { output } = await generateText({
      model: TEXT_MODEL,
      system: TEXT_RULES + (await examples("text")),
      prompt: `Message:\n"""${text}"""`,
      output: Output.object({ schema: textVerdict }),
    });
    await log("text", userId, text, output.allowed ? "allow" : "block", output.categories, output.reason, TEXT_MODEL);
    return { allowed: output.allowed, categories: output.categories, reason: output.reason, likelyAi: output.likely_ai_written, checked: true };
  } catch (err) {
    console.error("text moderation failed", err);
    await log("text", userId, text, "error", [], String(err).slice(0, 500), TEXT_MODEL);
    return { allowed: true, categories: [], reason: "moderation error", likelyAi: false, checked: false };
  }
}

export async function moderateImage(bytes: Uint8Array, mediaType: string, userId: string | null, kind: "image" | "sticker", label: string): Promise<ImageResult> {
  if (!aiEnabled()) {
    return { allowed: false, categories: [], reason: "ai moderation is not set up", aiSlop: false, checked: false };
  }
  try {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: kind === "sticker" ? `This is a sticker someone wants to add, called "${label}".` : "This image was sent in a chat." },
          { type: "image", image: bytes, mediaType },
        ],
      },
    ];
    const { output } = await generateText({
      model: VISION_MODEL,
      system: IMAGE_RULES + (await examples(kind)),
      messages,
      output: Output.object({ schema: imageVerdict }),
    });
    await log(kind, userId, label, output.allowed ? "allow" : "block", output.categories, output.reason, VISION_MODEL);
    return { allowed: output.allowed, categories: output.categories, reason: output.reason, aiSlop: output.ai_slop, checked: true };
  } catch (err) {
    console.error("image moderation failed", err);
    await log(kind, userId, label, "error", [], String(err).slice(0, 500), VISION_MODEL);
    return { allowed: false, categories: [], reason: "moderation error", aiSlop: false, checked: false };
  }
}
