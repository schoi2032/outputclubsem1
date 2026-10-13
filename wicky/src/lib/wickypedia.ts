import { generateText } from "ai";
import { supabaseAdmin } from "./supabase/admin";
import { aiEnabled, TEXT_MODEL } from "./ai";
import { ApiError } from "./api";

export const BOT_NAME = "WICKYpedia";

export async function askWicky(question: string) {
  if (!aiEnabled()) throw new ApiError(503, "ai_off", "WICKYpedia isnt set up yet (no AI key)");
  const { data: pages } = await supabaseAdmin().from("wiki_pages").select("slug, title, body").order("slug");
  const knowledge = (pages ?? []).map((p) => `## ${p.title} (${p.slug})\n${p.body}`).join("\n\n").slice(0, 40000);
  const { text } = await generateText({
    model: TEXT_MODEL,
    system: `You are ${BOT_NAME}, the friendly AI helper inside the Chadwick School chat app. Wicky is the school mascot.
Answer using the school wiki below when you can. If the wiki doesnt cover it, say so and give your best general answer, and be clear its not from the wiki.
Keep answers short (under 120 words), kind and school appropriate. Never help with cheating on tests or homework, explain the idea instead.

# School wiki
${knowledge || "(empty)"}`,
    prompt: question,
  });
  return { answer: text.trim(), model: TEXT_MODEL };
}
