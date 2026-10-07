import { redirect } from "next/navigation";
import { buildFeed, userFromRequest } from "@/lib/feed";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await userFromRequest();
  if (!user) redirect("/login");
  const feed = await buildFeed(user.id, user.user_metadata.full_name ?? user.email ?? "You");
  return <Dashboard feed={feed} email={user.email} avatar={user.user_metadata.avatar_url} />;
}
