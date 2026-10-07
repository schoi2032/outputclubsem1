import { createHash } from "crypto";
import { googleData } from "./google";
import { demoGoogle } from "./sources/demo";
import { managebac, veracross, type Block } from "./sources/school";
import { supabaseAdmin, supabaseServer } from "./supabase/server";
import { DAYS, daysUntil, schoolNow, whenLabel } from "./time";

export type Row = Block & { status: "done" | "now" | "next" };

export async function userFromRequest(req?: Request) {
  const auth = req?.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const hash = createHash("sha256").update(auth.slice(7)).digest("hex");
    const { data } = await supabaseAdmin().from("cli_tokens").select("user_id").eq("token_hash", hash).maybeSingle();
    if (!data) return null;
    const { data: u } = await supabaseAdmin().auth.admin.getUserById(data.user_id);
    return u.user;
  }
  const { data } = await (await supabaseServer()).auth.getUser();
  return data.user;
}

export async function buildFeed(userId: string | null, name: string) {
  const now = schoolNow();
  const mb = managebac();
  const vc = veracross();
  const today: Row[] = (mb.week[now.day] ?? []).map((b) => ({
    ...b,
    status: b.end <= now.time ? "done" : b.start <= now.time ? "now" : "next",
  }));
  const google = userId ? await googleData(userId) : demoGoogle();
  const tests = vc.tests
    .map((t) => ({ ...t, inDays: daysUntil(t.day, now.day) }))
    .sort((a, b) => a.inDays - b.inDays)
    .map((t) => ({ ...t, soon: whenLabel(t.inDays) }));
  let upNext: (Block & { day: string }) | null = null;
  for (let i = 1; i <= 7 && !upNext; i++) {
    const d = (now.day + i) % 7;
    const first = mb.week[d]?.[0];
    if (first) upNext = { ...first, day: i === 1 ? "Tomorrow" : DAYS[d] };
  }
  return {
    name,
    upNext,
    demo: !userId,
    day: DAYS[now.day],
    time: now.time,
    today,
    week: Object.fromEntries(Object.entries(mb.week).map(([d, blocks]) => [DAYS[+d], blocks])),
    tests,
    clubs: [...new Set(Object.values(mb.week).flat().filter((b) => b.kind === "club").map((b) => b.what))],
    ...google,
    sources: [
      { name: "Google Classroom", ok: !!userId && google.connected, note: userId ? "" : "sample data" },
      { name: "Gmail", ok: !!userId && google.connected, note: userId ? "" : "sample data" },
      { name: "Google Chat", ok: !!userId && google.connected, note: userId ? "" : "sample data" },
      { name: "ManageBac", ok: mb.live, note: "sample data" },
      { name: "Veracross", ok: vc.live, note: "sample data" },
      { name: "Gemini", ok: !!process.env.GEMINI_API_KEY },
    ],
  };
}

export type Feed = Awaited<ReturnType<typeof buildFeed>>;
