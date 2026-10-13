import { ok, route, ApiError } from "@/lib/api";
import { isMod, requireMember, requireUser } from "@/lib/auth";
import { getMessage } from "@/lib/messages";

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/messages/[id]">) => {
  const { me } = await requireUser();
  const { id } = await ctx.params;
  const message = await getMessage(Number(id));
  if (!message || (message.status === "hidden" && !isMod(me))) throw new ApiError(404, "message_not_found", "Couldnt find that message");
  await requireMember(message.chat_id, me);
  return ok(message);
});
