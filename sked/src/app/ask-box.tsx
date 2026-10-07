"use client";

import { useState } from "react";

const ideas = ["What should I study tonight?", "When is my next free period?", "What's due this week?"];

export default function AskBox({ demo }: { demo: boolean }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);

  async function ask(question: string) {
    if (demo) {
      setErr(true);
      setAnswer("Ask Sked only works when you're signed in with Google.");
      return;
    }
    setBusy(true);
    setAnswer("");
    try {
      const res = await fetch("/api/ai", { method: "POST", body: JSON.stringify({ question }) });
      const data = await res.json();
      setErr(!data.answer);
      setAnswer(data.answer ?? data.error);
    } catch {
      setErr(true);
      setAnswer("Couldn't reach Sked, check your internet and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Ask Sked ✨</h3>
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything about your week" />
        <button disabled={busy}>{busy ? "Thinking..." : "Ask"}</button>
      </form>
      <div className="ideas">
        {ideas.map((i) => (
          <button
            key={i}
            className="idea"
            disabled={busy}
            onClick={() => {
              setQ(i);
              ask(i);
            }}
          >
            {i}
          </button>
        ))}
      </div>
      {answer && <p className={err ? "answer bad" : "answer"}>{answer}</p>}
    </div>
  );
}
