import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { isSchoolEmail } from "@/lib/school";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = (msg: string) => NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, url.origin));
  const oauthError = url.searchParams.get("error_description");
  if (oauthError) return fail(oauthError.includes("chadwickschool") ? "school" : oauthError);
  const code = url.searchParams.get("code");
  if (!code) return fail("nocode");
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail(error.message);
  if (!isSchoolEmail(data.user.email)) {
    await supabase.auth.signOut();
    return fail("school");
  }
  return NextResponse.redirect(new URL("/", url.origin));
}
