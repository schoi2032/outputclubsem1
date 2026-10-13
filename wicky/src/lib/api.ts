import { NextResponse } from "next/server";
import type { ZodType } from "zod";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

const dbErrors: Record<string, [number, string]> = {
  chat_full: [409, "Chats can only have 3 people unless a teacher is in it"],
  spam: [429, "You already sent that twice in a row"],
};

export function route<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof ApiError) return fail(err.status, err.code, err.message);
      const text = err instanceof Error ? err.message : String(err ?? "");
      const hit = Object.keys(dbErrors).find((code) => text.startsWith(`${code}:`));
      if (hit) return fail(dbErrors[hit][0], hit, dbErrors[hit][1]);
      console.error(err);
      return fail(500, "server_error", "Something broke on the server");
    }
  };
}

export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "bad_json", "Body has to be JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(400, "bad_input", `${issue.path.join(".") || "body"}: ${issue.message}`);
  }
  return parsed.data;
}

export function check<T>(result: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  return result.data as NonNullable<T>;
}
