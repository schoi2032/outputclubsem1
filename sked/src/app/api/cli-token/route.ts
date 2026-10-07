import { createHash, randomBytes } from "crypto";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

export async function POST() {
  const { data } = await (await supabaseServer()).auth.getUser();
  if (!data.user) return Response.json({ error: "not logged in" }, { status: 401 });
  const token = `sked_${randomBytes(24).toString("hex")}`;
  const hash = createHash("sha256").update(token).digest("hex");
  const { error } = await supabaseAdmin().from("cli_tokens").insert({ token_hash: hash, user_id: data.user.id });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ token });
}
