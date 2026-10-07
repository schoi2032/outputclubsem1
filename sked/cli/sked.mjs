#!/usr/bin/env node
import { execSync, exec } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir, cpus, totalmem, freemem, loadavg, uptime, hostname } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

const RC = join(homedir(), ".skedrc");
const c = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  b: (s) => `\x1b[36m${s}\x1b[0m`,
  d: (s) => `\x1b[2m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const logo = `
 ____  _  _______ ____
/ ___|| |/ / ____|  _ \\
\\___ \\| ' /|  _| | | | |
 ___) | . \\| |___| |_| |
|____/|_|\\_\\_____|____/`;

function config() {
  try {
    return JSON.parse(readFileSync(RC, "utf8"));
  } catch {
    return {};
  }
}

async function api(path, body) {
  const { token, url } = config();
  if (!token) throw new Error("not logged in, run: sked login <token> (get one on the website)");
  const res = await fetch(`${url}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error);
  return data;
}

function row(r) {
  const mark = r.status === "done" ? c.d("✓") : r.status === "now" ? c.g("● now") : r.kind === "club" ? "🔔" : " ";
  const text = `${r.start}  ${r.what.padEnd(22)} ${r.where}`;
  return `  ${r.status === "done" ? c.d(text) : r.status === "now" ? c.bold(text) : text}  ${mark}`;
}

const bar = (pct, w = 24) => {
  const n = Math.round((pct / 100) * w);
  const color = pct > 85 ? c.r : pct > 60 ? c.y : c.g;
  return color("█".repeat(n)) + c.d("░".repeat(w - n)) + ` ${pct.toFixed(0)}%`;
};

function cpuPct() {
  const t = cpus().map((x) => x.times);
  return new Promise((res) =>
    setTimeout(() => {
      const t2 = cpus().map((x) => x.times);
      let idle = 0, total = 0;
      t2.forEach((b, i) => {
        const a = t[i];
        idle += b.idle - a.idle;
        total += Object.values(b).reduce((s, v) => s + v, 0) - Object.values(a).reduce((s, v) => s + v, 0);
      });
      res(100 - (idle / total) * 100);
    }, 400),
  );
}

function battery() {
  try {
    const out = execSync("pmset -g batt", { encoding: "utf8" });
    const m = out.match(/(\d+)%;\s*([^;]+)/);
    return m ? { pct: +m[1], state: m[2].trim() } : null;
  } catch {
    return null;
  }
}

const commands = {
  async today() {
    const f = await api("/api/feed");
    console.log(c.bold(`\n  ${f.day} ${f.time}\n`));
    if (!f.today.length) console.log("  No school today, enjoy it.");
    f.today.forEach((r) => console.log(row(r)));
    if (f.assignments.length) {
      console.log(c.bold("\n  Due soon"));
      f.assignments.slice(0, 4).forEach((a) => console.log(`  ${c.y(a.due)}  ${a.title} ${c.d(a.course)}`));
    }
    console.log();
  },
  async week() {
    const f = await api("/api/feed");
    for (const [day, blocks] of Object.entries(f.week)) {
      console.log(c.bold(`\n  ${day}${day === f.day ? c.g(" (today)") : ""}`));
      blocks.forEach((b) => console.log(`  ${b.start}  ${b.kind === "club" ? c.b(b.what) : b.what}`));
    }
    console.log();
  },
  async tests() {
    const f = await api("/api/feed");
    console.log(c.bold("\n  Tests"));
    f.tests.forEach((t) => console.log(`  ${c.r("!")} ${t.name.padEnd(26)} ${c.d(`${t.day}, ${t.when}${t.soon ? `, ${t.soon}` : ""}`)}`));
    console.log(c.bold("\n  Classroom"));
    if (!f.assignments.length) console.log(c.d("  nothing due"));
    f.assignments.forEach((a) => console.log(`  ${c.y(a.due)}  ${a.title} ${c.d(a.course)}`));
    console.log();
  },
  async clubs() {
    const f = await api("/api/feed");
    console.log(c.bold("\n  Your clubs"));
    for (const [day, blocks] of Object.entries(f.week))
      blocks.filter((b) => b.kind === "club").forEach((b) => console.log(`  ${c.b(b.what.padEnd(22))} ${day} ${b.start}, ${b.where}`));
    console.log();
  },
  async mail() {
    const f = await api("/api/feed");
    console.log(c.bold("\n  Unread mail"));
    if (!f.mail.length) console.log(c.d("  inbox zero"));
    f.mail.forEach((m) => console.log(`  ${m.subject}  ${c.d(m.from)}`));
    console.log(c.bold("\n  Google Chat"));
    if (!f.chat.length) console.log(c.d("  nothing new"));
    f.chat.forEach((m) => console.log(`  ${c.b(m.space)} ${m.sender}: ${m.text.slice(0, 70)}`));
    console.log();
  },
  async ask(...words) {
    process.stdout.write(c.d("  thinking...\r"));
    const { answer } = await api("/api/ai", { question: words.join(" ") });
    console.log(`\n  ${c.b("✨")} ${answer}\n`);
  },
  async sys() {
    const mem = ((totalmem() - freemem()) / totalmem()) * 100;
    const cpu = await cpuPct();
    const bat = battery();
    const up = uptime();
    console.log(c.bold(`\n  ${hostname()}`));
    console.log(`  CPU      ${bar(cpu)}  ${c.d(`${cpus().length} cores, load ${loadavg()[0].toFixed(2)}`)}`);
    console.log(`  Memory   ${bar(mem)}  ${c.d(`${((totalmem() - freemem()) / 2 ** 30).toFixed(1)} / ${(totalmem() / 2 ** 30).toFixed(0)} GB`)}`);
    if (bat) console.log(`  Battery  ${bar(bat.pct)}  ${c.d(bat.state)}`);
    console.log(`  Uptime   ${Math.floor(up / 86400)}d ${Math.floor((up % 86400) / 3600)}h ${Math.floor((up % 3600) / 60)}m\n`);
  },
  async watch() {
    for (;;) {
      console.clear();
      await commands.sys();
      console.log(c.d("  ctrl+c to stop"));
      await new Promise((r) => setTimeout(r, 1600));
    }
  },
  dashboard() {
    const { url } = config();
    exec(`open ${url || "https://sked-eight.vercel.app"}`);
  },
  login(token, url) {
    if (!token) return console.log("usage: sked login <token> [site url]");
    writeFileSync(RC, JSON.stringify({ token, url: url || config().url || DEFAULT_URL }), { mode: 0o600 });
    console.log(c.g("  logged in ✓"));
  },
  logout() {
    writeFileSync(RC, "{}");
    console.log("  logged out");
  },
};

const DEFAULT_URL = process.env.SKED_URL || "https://sked-eight.vercel.app";

const menu = [
  ["today", "📊", "Show whats on today"],
  ["week", "🗓️", "Full week at a glance"],
  ["tests", "📝", "Tests and Classroom work"],
  ["clubs", "🧩", "Club meetings you're in"],
  ["mail", "📬", "Unread Gmail and Google Chat"],
  ["ask", "✨", "Ask Sked AI about your day"],
  ["sys", "🖥️", "System monitor (CPU, memory, battery)"],
  ["watch", "📈", "Live system monitor"],
  ["dashboard", "🌐", "Open the website version"],
  ["exit", "❌", "Quit"],
];

function interactive() {
  let sel = 0;
  const draw = () => {
    console.clear();
    console.log(c.b(logo));
    console.log(`  Made with ♥ by ${c.bold("Output Club")}\n`);
    console.log(config().token ? `  ${c.g("logged in")}\n` : `  ${c.y("not logged in, run: sked login <token>")}\n`);
    menu.forEach(([cmd, ico, desc], i) =>
      console.log(`  ${i === sel ? c.g("❯") : " "} ${ico}  ${i === sel ? c.bold(cmd.padEnd(10)) : cmd.padEnd(10)} ${c.d(desc)}`),
    );
  };
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  draw();
  const onKey = async (_s, key) => {
    if (key.name === "up") sel = (sel + menu.length - 1) % menu.length;
    if (key.name === "down") sel = (sel + 1) % menu.length;
    if ((key.ctrl && key.name === "c") || key.name === "q") process.exit(0);
    if (key.name !== "return") return draw();
    const cmd = menu[sel][0];
    if (cmd === "exit") process.exit(0);
    process.stdin.off("keypress", onKey);
    process.stdin.setRawMode(false);
    console.clear();
    let args = [];
    if (cmd === "ask") {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      args = [await new Promise((r) => rl.question("  Ask: ", r))];
      rl.close();
    }
    await run(cmd, args);
    if (cmd === "watch") return;
    console.log(c.d("  press any key to go back"));
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("keypress", () => {
      process.stdin.on("keypress", onKey);
      draw();
    });
  };
  process.stdin.on("keypress", onKey);
}

async function run(cmd, args) {
  try {
    await commands[cmd](...args);
  } catch (e) {
    console.log(c.r(`  ${e.message}\n`));
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  if (process.stdin.isTTY) interactive();
  else console.log(`commands: ${Object.keys(commands).join(", ")}`);
} else if (commands[cmd]) {
  await run(cmd, args);
} else {
  console.log(`unknown command. try: ${Object.keys(commands).join(", ")}`);
}
