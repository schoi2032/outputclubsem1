import { buildFeed, userFromRequest } from "@/lib/feed";

export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return Response.json({ error: "not logged in" }, { status: 401 });
  return Response.json(await buildFeed(user.id, user.user_metadata.full_name ?? user.email));
}
