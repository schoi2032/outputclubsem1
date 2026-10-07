import { GoogleGenAI } from "@google/genai";
import { buildFeed, userFromRequest } from "@/lib/feed";

export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return Response.json({ error: "You need to sign in to ask Sked." }, { status: 401 });
  if (!process.env.GEMINI_API_KEY) return Response.json({ error: "Gemini isn't set up yet (GEMINI_API_KEY is missing)." }, { status: 500 });
  const { question } = await req.json().catch(() => ({}));
  const feed = await buildFeed(user.id, user.user_metadata.full_name ?? user.email);
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const res = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: [
        "You are Sked, a friendly assistant for a high school student. Answer in 2 to 4 short sentences, plain text, no markdown.",
        `It is ${feed.day} ${feed.time}. Here is their data as JSON:`,
        JSON.stringify({ today: feed.today, week: feed.week, tests: feed.tests, assignments: feed.assignments, mail: feed.mail, chat: feed.chat }),
        `Question: ${String(question || "Give me a quick rundown of my day and what I should focus on.").slice(0, 500)}`,
      ].join("\n\n"),
    });
    return Response.json({ answer: res.text || "Sked didn't have an answer for that one." });
  } catch (e) {
    return Response.json({ error: `Gemini error: ${(e as Error).message}` }, { status: 502 });
  }
}
