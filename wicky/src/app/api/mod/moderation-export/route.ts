import { route, check } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const GET = route(async (req: Request) => {
  const { admin } = await requireUser("moderator", "admin");
  const params = new URL(req.url).searchParams;
  let query = admin.from("moderation_log").select("id, kind, input, verdict, categories, reason, model, human_override, created_at").order("id").limit(5000);
  if (params.get("kind")) query = query.eq("kind", params.get("kind")!);
  if (params.get("human_only") === "1") query = query.eq("human_override", true);
  const rows = check(await query);
  const jsonl = rows.map((r) => JSON.stringify({ ...r, label: r.verdict })).join("\n");
  return new Response(jsonl, {
    headers: { "content-type": "application/x-ndjson", "content-disposition": 'attachment; filename="moderation.jsonl"' },
  });
});
