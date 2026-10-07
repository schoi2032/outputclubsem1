import type { Feed } from "@/lib/feed";
import AskBox from "./ask-box";
import AutoRefresh from "./auto-refresh";
import CliToken from "./cli-token";

const icons: Record<string, string> = {
  "Output Club meeting": "💻",
  "Chess club": "♟️",
  Basketball: "🏀",
};

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function minsBetween(a: string, b: string) {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return bh * 60 + bm - (ah * 60 + am);
}

function prettyDue(due: string) {
  const d = new Date(`${due}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function Dashboard({ feed, email, avatar }: { feed: Feed; email?: string; avatar?: string }) {
  const initials = feed.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
  const now = feed.today.find((r) => r.status === "now");
  const next = feed.today.find((r) => r.status === "next");
  const classes = feed.today.filter((r) => r.kind === "class");
  const classesLeft = classes.filter((r) => r.status !== "done").length;
  const done = feed.today.filter((r) => r.status === "done").length;
  const progress = feed.today.length ? Math.round((done / feed.today.length) * 100) : 0;
  const nextTest = feed.tests[0];

  return (
    <>
      <AutoRefresh />
      {feed.demo && (
        <div className="demo-bar">
          This is sample data so you can see how Sked works. <a href="/login">Sign in with Google</a> to see you&apos;re real classes and mail.
        </div>
      )}
      <nav className="top">
        <div className="logo">🗓️ Sked</div>
        <div className="top-links">
          <span className="muted">{feed.day} {feed.time}</span>
          <span className="me">
            {avatar ? <img className="av small" src={avatar} alt="" /> : <span className="av small">{initials}</span>}
            {feed.name.split(" ")[0]}
          </span>
          {feed.demo ? (
            <a className="linkish" href="/login">Sign in</a>
          ) : (
            <form action="/auth/signout" method="post">
              <button className="linkish">Sign out</button>
            </form>
          )}
        </div>
      </nav>

      <main className="wrap">
        <aside className="card profile">
          {avatar ? <img className="big-av" src={avatar} alt="" /> : <div className="big-av">{initials}</div>}
          <h2>{feed.name}</h2>
          <p className="grade">{email ?? "demo account"}</p>

          <hr />

          <p className="label">Right now</p>
          <div className="now">
            <div className="now-icon">{now ? (now.kind === "club" ? icons[now.what] ?? "⭐" : "📘") : "☕"}</div>
            <div>
              <span className={now ? "pill live" : "pill"}>● {now ? now.what : "Free"}</span>
              <p className="muted small-text">
                {now ? `${now.where}, ${minsBetween(feed.time, now.end)} min left` : "Nothing on right now"}
                <br />
                {next
                  ? `${next.what} at ${next.start} (${next.where})`
                  : feed.upNext
                    ? `Done for today! ${feed.upNext.day}: ${feed.upNext.what} at ${feed.upNext.start}`
                    : "Nothing else today"}
              </p>
            </div>
          </div>
          {feed.today.length > 0 && (
            <div className="bar" title={`${progress}% of today done`}>
              <div style={{ width: `${progress}%` }} />
            </div>
          )}

          <hr />

          <p className="label">Connected</p>
          {feed.sources.map((s) => (
            <p key={s.name} className={s.ok ? "" : "muted"}>
              {s.name} {s.ok ? <span className="ok">✓</span> : s.note ? `(${s.note})` : "(not yet)"}
            </p>
          ))}
          {feed.errors.map((e) => (
            <p key={e} className="err small-text">{e}</p>
          ))}

          {!feed.demo && (
            <>
              <hr />
              <CliToken />
            </>
          )}
        </aside>

        <section className="right">
          <div className="stats">
            <div className="stat orange">
              <div className="stat-icon">📚</div>
              <div>
                <p className="stat-label">Classes left</p>
                <p className="stat-num">{classesLeft}<span className="of"> / {classes.length}</span></p>
              </div>
            </div>
            <div className="stat green">
              <div className="stat-icon">📝</div>
              <div>
                <p className="stat-label">Work due</p>
                <p className="stat-num">{feed.assignments.length}</p>
              </div>
            </div>
            <div className="stat blue">
              <div className="stat-icon">⏰</div>
              <div>
                <p className="stat-label">Next test</p>
                <p className="stat-num small">{nextTest ? nextTest.soon : "none"}</p>
              </div>
            </div>
          </div>

          <AskBox demo={feed.demo} />

          <div className="card">
            <h3>Today&apos;s schedule</h3>
            <div className="rows">
              {feed.today.length === 0 && <p className="muted">No school today, enjoy it.</p>}
              {feed.today.map((r) => (
                <div key={r.start} className={`row ${r.status === "done" ? "done" : ""} ${r.status === "now" ? "now-row" : ""} ${r.kind === "club" ? "club" : ""}`}>
                  <span className="time">{r.start}</span>
                  <span className="what">{r.kind === "club" ? `${icons[r.what] ?? "⭐"} ` : ""}{r.what}</span>
                  <span className="where">{r.where}</span>
                  <span className="check">{r.status === "done" ? "✓" : r.status === "now" ? "now" : r === next ? "next" : ""}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3>This week</h3>
            <div className="week">
              {weekdays.map((d) => (
                <div key={d} className={d === feed.day ? "day today" : "day"}>
                  <p className="day-name">{d.slice(0, 3)}</p>
                  {(feed.week[d] ?? []).map((b) => (
                    <p key={b.start} className={b.kind === "club" ? "slot club" : "slot"} title={`${b.start} to ${b.end}, ${b.where}`}>
                      {b.what}
                    </p>
                  ))}
                </div>
              ))}
            </div>

            <p className="label">Tests coming up</p>
            <div className="tests">
              {feed.tests.map((t) => (
                <div key={t.name} className="test">
                  <div className={`medal ${t.inDays <= 1 ? "red" : "gray"}`}>{t.inDays === 0 ? "!" : t.inDays}</div>
                  <div>
                    <p className="test-name">{t.name}</p>
                    <p className="muted small-text">{t.day} {t.when}, {t.soon}</p>
                  </div>
                </div>
              ))}
            </div>

            <p className="label">Classroom work due</p>
            {feed.assignments.length === 0 && <p className="muted">Nothing due, or Classroom isn&apos;t connected.</p>}
            <ul className="list">
              {feed.assignments.map((a) => (
                <li key={a.course + a.title}>
                  {a.link ? <a href={a.link} target="_blank" rel="noreferrer">{a.title}</a> : <b>{a.title}</b>}
                  <span className="muted small-text"> {a.course}, due {prettyDue(a.due)}</span>
                </li>
              ))}
            </ul>

            <p className="label">Clubs</p>
            <div className="badges">
              {feed.clubs.map((c) => (
                <span key={c} className="badge" title={c}>{icons[c] ?? "⭐"}</span>
              ))}
            </div>
          </div>

          <div className="two">
            <div className="card">
              <h3>Unread mail</h3>
              {feed.mail.length === 0 && <p className="muted">Inbox zero 🎉</p>}
              <ul className="list">
                {feed.mail.map((m, i) => (
                  <li key={m.link + i}>
                    <a href={m.link} target="_blank" rel="noreferrer">{m.subject}</a>
                    <span className="muted small-text"> {m.from}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card">
              <h3>Google Chat</h3>
              {feed.chat.length === 0 && <p className="muted">No recent messages.</p>}
              <ul className="list">
                {feed.chat.map((c, i) => (
                  <li key={i}>
                    <b>{c.space}</b>
                    <span className="muted small-text"> {c.sender}: {c.text.length > 90 ? `${c.text.slice(0, 90)}...` : c.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
