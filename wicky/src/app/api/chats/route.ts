import { z } from "zod";
import { ok, readJson, route, check } from "@/lib/api";
import { requireUser } from "@/lib/auth";

const body = z.object({
  user_ids: z.array(z.uuid()).max(50).default([]),
  name: z.string().trim().max(80).optional(),
});

export const POST = route(async (req: Request) => {
  const { me, admin } = await requireUser();
  const input = await readJson(req, body);
  const id = check(await admin.rpc("create_chat", { me: me.id, user_ids: input.user_ids, chat_name: input.name ?? null })) as string;
  const chat = check(await admin.from("chats").select("*").eq("id", id).single());
  return ok(chat, 201);
});
