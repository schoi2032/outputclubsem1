import { buildFeed } from "@/lib/feed";
import Dashboard from "../dashboard";

export const dynamic = "force-dynamic";

export default async function Demo() {
  const feed = await buildFeed(null, "Demo Student");
  return <Dashboard feed={feed} />;
}
