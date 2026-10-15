import { AuthError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/require-role";
import { HttpError } from "@/lib/http/errors";
import { assertSameOrigin } from "@/lib/http/same-origin";
import { ImageError, MAX_UPLOAD_BYTES } from "@/lib/uploads/process-image";
import { saveImage, thumbUrl, uploadUrl } from "@/lib/uploads/storage";

const MULTIPART_OVERHEAD = 64 * 1024;

const fail = (status: number, error: string) => Response.json({ error }, { status });

const IMAGE_ERROR_STATUS = { UNSUPPORTED_TYPE: 415, TOO_LARGE: 413, CORRUPT: 422 } as const;
const IMAGE_ERROR_MESSAGE = {
  UNSUPPORTED_TYPE: "unsupported image type",
  TOO_LARGE: "image too large",
  CORRUPT: "image could not be read",
} as const;

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    await requireRole("admin");

    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD) {
      return fail(413, "image too large");
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail(400, "invalid form data");
    }
    const file = form.get("file");
    if (!(file instanceof File)) return fail(400, "file field is required");
    if (file.size > MAX_UPLOAD_BYTES) return fail(413, "image too large");

    const { path } = await saveImage(Buffer.from(await file.arrayBuffer()));
    return Response.json({ path, url: uploadUrl(path), thumbUrl: thumbUrl(path) }, { status: 201 });
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, "forbidden");
    if (e instanceof AuthError) {
      return e.code === "UNAUTHENTICATED" ? fail(401, "authentication required") : fail(403, "forbidden");
    }
    if (e instanceof ImageError) return fail(IMAGE_ERROR_STATUS[e.code], IMAGE_ERROR_MESSAGE[e.code]);
    console.error("upload failed");
    return fail(500, "upload failed");
  }
}
