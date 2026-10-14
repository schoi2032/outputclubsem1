import { z } from "zod";
import { ok, readJson, route, ApiError } from "@/lib/api";
import { requireMember, requireUser } from "@/lib/auth";
import { insertMessage } from "@/lib/messages";
import { askWicky } from "@/lib/wickypedia";

const body = z.object({
  question: z.string().trim().min(1).max(1000),
  chat_id: z.uuid().optional(),
});

export const POST = route(async (req: Request) => {
  const { me } = await requireUser();
  const input = await readJson(req, body);
  if (!input.chat_id) {
    const { answer } = await askWicky(input.question);
    return ok({ answer, question_message: null, answer_message: null });
  }
  const role = await requireMember(input.chat_id, me);
  if (!role) throw new ApiError(403, "forbidden", "Your not in this chat");
  const asked = await insertMessage(input.chat_id, me, { kind: "text", body: `@wicky ${input.question}` });
  const { answer } = await askWicky(input.question);
  const replied = await insertMessage(input.chat_id, null, { kind: "ai", body: answer.slice(0, 4000) });
  return ok({ answer, question_message: asked.message, answer_message: replied.message }, 201);
});
