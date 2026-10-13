"use client";

import { supabaseBrowser } from "@/lib/supabase/browser";
import { SCHOOL_DOMAIN } from "@/lib/school";

export default function GoogleButton() {
  async function go() {
    await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback`,
        queryParams: { hd: SCHOOL_DOMAIN, prompt: "select_account" },
      },
    });
  }
  return <button onClick={go}>[ Login with Google ]</button>;
}
