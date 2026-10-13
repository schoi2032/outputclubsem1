import { z } from "zod";
import { ok, readJson, route, check, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/wiki/[slug]">) => {
  const { admin } = await requireUser();
  const { slug } = await ctx.params;
  const page = check(await admin.from("wiki_pages").select("*").eq("slug", slug).maybeSingle());
  if (!page) throw new ApiError(404, "page_not_found", "That wiki page doesnt exist yet");
  return ok(page);
});

const body = z.object({ title: z.string().trim().min(1).max(120), body: z.string().max(50000) });

export const PUT = route(async (req: Request, ctx: RouteContext<"/api/wiki/[slug]">) => {
  const { me, admin } = await requireUser("teacher", "moderator", "admin");
  const { slug } = await ctx.params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new ApiError(400, "bad_slug", "Slugs are lowercase words with dashes, like chat-rules");
  const input = await readJson(req, body);
  const page = check(
    await admin
      .from("wiki_pages")
      .upsert({ slug, title: input.title, body: input.body, updated_by: me.id, updated_at: new Date().toISOString() })
      .select("*")
      .single(),
  );
  return ok(page);
});

export const DELETE = route(async (_req: Request, ctx: RouteContext<"/api/wiki/[slug]">) => {
  const { admin } = await requireUser("moderator", "admin");
  const { slug } = await ctx.params;
  check(await admin.from("wiki_pages").delete().eq("slug", slug));
  return ok({ deleted: slug });
});
