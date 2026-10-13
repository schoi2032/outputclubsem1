import GoogleButton from "./google-button";

const ERRORS: Record<string, string> = {
  school: "ACCESS DENIED. Only chadwickschool.org accounts can get in.",
  nocode: "Login got cancelled, try again.",
};

export default async function Login({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const msg = typeof error === "string" ? ERRORS[error] ?? error : null;
  return (
    <main className="login">
      <pre>{`██     ██ ██  ██████ ██   ██ ██    ██
██     ██ ██ ██      ██  ██   ██  ██
██  █  ██ ██ ██      █████     ████
██ ███ ██ ██ ██      ██  ██     ██
 ███ ███  ██  ██████ ██   ██    ██`}</pre>
      <div>WICKY CHAT SYSTEM v0.1 (C) OUTPUT CLUB 2026</div>
      <p>READY. Sign in with you&apos;re school google account to continue<span className="cursor">_</span></p>
      {msg && <p className="err">{msg}</p>}
      <GoogleButton />
    </main>
  );
}
