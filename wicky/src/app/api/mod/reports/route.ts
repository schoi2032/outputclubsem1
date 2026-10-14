import { ok, route, check } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const GET = route(async (req: Request) => {
  const { admin } = await requireUser("moderator", "admin");
  const status = new URL(req.url).searchParams.get("status") || "open";
  const reports = check(
    await admin
      .from("reports")
      .select(
        "*, reporter:profiles!reports_reporter_id_fkey(id, name, email), target:profiles!reports_user_id_fkey(id, name, email, role), message:messages(id, chat_id, kind, body, body_original, status, ai_tag, created_at)",
      )
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(100),
  );
  return ok(reports);
});
