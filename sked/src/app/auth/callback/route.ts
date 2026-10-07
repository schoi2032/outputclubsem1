import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?error=nocode", url.origin));
  const { data, error } = await (await supabaseServer()).auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin));
  if (data.session.provider_refresh_token) {
    await supabaseAdmin().from("google_tokens").upsert({
      user_id: data.user.id,
      refresh_token: data.session.provider_refresh_token,
      updated_at: new Date().toISOString(),
    });
  }
  return NextResponse.redirect(new URL("/", url.origin));
}
