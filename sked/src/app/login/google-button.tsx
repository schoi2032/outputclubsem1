"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useState } from "react";
import { GOOGLE_SCOPES } from "@/lib/scopes";

export default function GoogleButton() {
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: GOOGLE_SCOPES,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
  }

  return (
    <button className="google" onClick={signIn} disabled={busy}>
      {busy ? "Opening Google..." : "Sign in with Google"}
    </button>
  );
}
