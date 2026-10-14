"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { HomeChat, Message, Person, Profile } from "@/lib/types";

type Home = { me: Profile; total_unread: number; chats: HomeChat[]; people: Person[] };

const supabase = supabaseBrowser();

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? "Something went wrong");
  return json.data;
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function Terminal() {
  const [home, setHome] = useState<Home | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  const loadHome = useCallback(() => api<Home>("/api/home").then(setHome).catch((e) => setError(e.message)), []);

  useEffect(() => {
    loadHome();
  }, [loadHome]);

  useEffect(() => {
    if (!activeId) return;
    api<{ messages: Message[] }>(`/api/chats/${activeId}/messages`).then((d) => setMessages(d.messages)).catch((e) => setError(e.message));
    api(`/api/chats/${activeId}/read`, { method: "POST" }).then(loadHome).catch(() => {});
  }, [activeId, loadHome]);

  useEffect(() => {
    const channel = supabase
      .channel("inbox")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async (payload) => {
        const row = payload.new as Message;
        if (row.chat_id === activeId) {
          const full = await api<Message>(`/api/messages/${row.id}`).catch(() => row);
          setMessages((list) => (list.some((m) => m.id === full.id) ? list : [...list, full]));
          api(`/api/chats/${activeId}/read`, { method: "POST" }).catch(() => {});
        }
        loadHome();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeId, loadHome]);

  useEffect(() => {
    bottom.current?.scrollIntoView();
  }, [messages]);

  const nameOf = (id: string | null) => {
    if (!id) return "WICKYPEDIA";
    return home?.people.find((p) => p.id === id)?.name.toUpperCase() ?? "???";
  };

  const chatTitle = (c: HomeChat) => {
    if (c.name) return c.name;
    if (c.kind === "self") return "NOTES TO SELF";
    return c.member_ids.filter((id) => id !== home?.me.id).map(nameOf).join(", ");
  };

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !activeId) return;
    setError("");
    setDraft("");
    try {
      if (text.startsWith("/wicky ")) {
        const d = await api<{ question_message: Message; answer_message: Message }>("/api/wickypedia", {
          method: "POST",
          body: JSON.stringify({ chat_id: activeId, question: text.slice(7) }),
        });
        setMessages((list) => [...list.filter((m) => m.id !== d.question_message.id && m.id !== d.answer_message.id), d.question_message, d.answer_message]);
      } else {
        const d = await api<{ message: Message }>(`/api/chats/${activeId}/messages`, { method: "POST", body: JSON.stringify({ body: text }) });
        setMessages((list) => (list.some((m) => m.id === d.message.id) ? list : [...list, d.message]));
      }
    } catch (err) {
      setError((err as Error).message);
      setDraft(text);
    }
  }

  async function newChat() {
    const who = window.prompt("Emails to chat with (comma seperated), leave empty for notes to self");
    if (who === null) return;
    try {
      const emails = who.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const ids: string[] = [];
      for (const email of emails) {
        const found = await api<Person[]>(`/api/users?q=${encodeURIComponent(email)}`);
        const match = found.find((p) => p.email === email);
        if (!match) throw new Error(`No user ${email}`);
        ids.push(match.id);
      }
      const chat = await api<{ id: string }>("/api/chats", { method: "POST", body: JSON.stringify({ user_ids: ids }) });
      await loadHome();
      setActiveId(chat.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const active = home?.chats.find((c) => c.chat_id === activeId);

  return (
    <div className="screen">
      <div className="bar">
        <span>WICKY CHAT // {home ? `${home.me.name.toUpperCase()} [${home.me.role.toUpperCase()}]` : "LOADING..."}</span>
        <span className="temp">TEMP UI, SEE DOCS/</span>
        <form action="/auth/signout" method="post">
          <button>Logoff</button>
        </form>
      </div>
      <div className="main">
        <section className="box">
          <h2>CHATS {home && home.total_unread > 0 ? `(${home.total_unread} NEW)` : ""}</h2>
          <div className="list">
            {home?.chats.map((c) => (
              <button key={c.chat_id} className={c.chat_id === activeId ? "on" : ""} onClick={() => setActiveId(c.chat_id)}>
                <span>&gt; {chatTitle(c)}</span>
                {c.unread_count > 0 && <span className="unread">[{c.unread_count}]</span>}
              </button>
            ))}
            {home && !home.chats.length && <div className="empty">NO CHATS YET.</div>}
          </div>
          <div className="prompt">
            <button onClick={newChat}>+ New chat</button>
          </div>
        </section>
        <section className="box">
          <h2>{active ? chatTitle(active) : "NO CHAT SELECTED"}</h2>
          <div className="log">
            {!active && <div className="empty">PICK A CHAT ON THE LEFT. TYPE /wicky QUESTION TO ASK WICKYPEDIA.</div>}
            {active &&
              messages.map((m) => (
                <div className="msg" key={m.id}>
                  <span className="time">{clock(m.created_at)}</span>
                  <span className="who">{nameOf(m.user_id)}&gt;</span> {m.body}
                  {m.ai_tag && <span className="tag">{m.ai_tag === "bot" ? "AI" : "AI?"}</span>}
                  {m.sticker_url && <img src={m.sticker_url} alt="sticker" />}
                  {m.image_url && <img src={m.image_url} alt="image" />}
                </div>
              ))}
            <div ref={bottom} />
          </div>
          {error && <div className="err">ERROR: {error}</div>}
          {active && (
            <form className="prompt" onSubmit={send}>
              <span>C:\&gt;</span>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="type here" autoFocus />
              <button>Send</button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
