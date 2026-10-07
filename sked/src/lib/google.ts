import { supabaseAdmin } from "./supabase/server";
import { schoolDate } from "./time";

export type Assignment = { title: string; course: string; due: string; link?: string };
export type Mail = { from: string; subject: string; link: string };
export type ChatMsg = { space: string; text: string; sender: string };

async function accessToken(userId: string) {
  const { data } = await supabaseAdmin()
    .from("google_tokens")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: data.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  return (await res.json()).access_token as string;
}

async function get(token: string, url: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${url.split("?")[0]}`);
  return res.json();
}

async function classroom(token: string): Promise<Assignment[]> {
  const base = "https://classroom.googleapis.com/v1/courses";
  const { courses = [] } = await get(token, `${base}?studentId=me&courseStates=ACTIVE&pageSize=20`);
  const today = schoolDate();
  const lists = await Promise.all(
    courses.map(async (c: { id: string; name: string }) => {
      const { courseWork = [] } = await get(token, `${base}/${c.id}/courseWork?orderBy=dueDate%20desc&pageSize=10`).catch(() => ({}));
      return courseWork
        .filter((w: { dueDate?: object }) => w.dueDate)
        .map((w: { title: string; alternateLink: string; dueDate: { year: number; month: number; day: number } }) => ({
          title: w.title,
          course: c.name,
          due: `${w.dueDate.year}-${String(w.dueDate.month).padStart(2, "0")}-${String(w.dueDate.day).padStart(2, "0")}`,
          link: w.alternateLink,
        }))
        .filter((a: Assignment) => a.due >= today);
    }),
  );
  return lists.flat().sort((a, b) => a.due.localeCompare(b.due)).slice(0, 10);
}

async function gmail(token: string): Promise<Mail[]> {
  const base = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
  const { messages = [] } = await get(token, `${base}?maxResults=6&q=${encodeURIComponent("is:unread newer_than:3d category:primary")}`);
  return Promise.all(
    messages.map(async (m: { id: string }) => {
      const msg = await get(token, `${base}/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`);
      const header = (n: string) =>
        msg.payload.headers.find((h: { name: string; value: string }) => h.name === n)?.value ?? "";
      return {
        from: header("From").replace(/<.*>/, "").replace(/"/g, "").trim(),
        subject: header("Subject") || "(no subject)",
        link: `https://mail.google.com/mail/u/0/#inbox/${m.id}`,
      };
    }),
  );
}

async function chat(token: string): Promise<ChatMsg[]> {
  const { spaces = [] } = await get(token, "https://chat.googleapis.com/v1/spaces?pageSize=5");
  const out = await Promise.all(
    spaces.map(async (s: { name: string; displayName?: string }) => {
      const { messages = [] } = await get(
        token,
        `https://chat.googleapis.com/v1/${s.name}/messages?pageSize=1&orderBy=${encodeURIComponent("createTime desc")}`,
      ).catch(() => ({}));
      return messages.map((m: { text?: string; sender?: { displayName?: string } }) => ({
        space: s.displayName || "Direct message",
        text: m.text ?? "",
        sender: m.sender?.displayName ?? "",
      }));
    }),
  );
  return out.flat().filter((m) => m.text);
}

export async function googleData(userId: string) {
  const token = await accessToken(userId);
  if (!token) {
    return { connected: false, assignments: [], mail: [], chat: [], errors: ["Google not connected, sign out and back in"] };
  }
  const errors: string[] = [];
  const safe = <T,>(name: string, p: Promise<T[]>) =>
    p.catch((e: Error) => {
      errors.push(`${name}: ${e.message}`);
      return [] as T[];
    });
  const [assignments, mail, chatMsgs] = await Promise.all([
    safe("Classroom", classroom(token)),
    safe("Gmail", gmail(token)),
    safe("Google Chat", chat(token)),
  ]);
  return { connected: true, assignments, mail, chat: chatMsgs, errors };
}
