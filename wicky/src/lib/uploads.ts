import { ApiError } from "./api";

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export async function readImage(req: Request, maxBytes: number) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "bad_form", "Send the file as multipart form data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "no_file", "Put the image in a field called file");
  const ext = TYPES[file.type];
  if (!ext) throw new ApiError(415, "bad_type", "Only png, jpg, webp and gif images are allowed");
  if (file.size > maxBytes) throw new ApiError(413, "too_big", `Image has to be under ${Math.round(maxBytes / 1024 / 1024)}MB`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { bytes, type: file.type, ext, form };
}
