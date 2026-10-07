import { redirect } from "next/navigation";
import { userFromRequest } from "@/lib/feed";
import GoogleButton from "./google-button";

export default async function Login({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  if (!error && (await userFromRequest())) redirect("/");

  return (
    <main className="login">
      <div className="card login-card">
        <div className="logo big">🗓️ Sked</div>
        <p className="muted">All your classes, tests, clubs, Classroom work, mail and chats in one place.</p>
        <GoogleButton />
        <a className="try" href="/demo">Try it with sample data</a>
        {error && <p className="err">Sign in failed: {error}</p>}
        <p className="muted small-text">Made by Output Club</p>
      </div>
    </main>
  );
}
