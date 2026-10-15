import { readFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/env";

// Strict shape (uuid, optional .thumb, .webp): no traversal, no listing.
const NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.thumb)?\.webp$/;

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path: segments } = await params;
  if (segments.length !== 1 || !NAME_RE.test(segments[0])) return notFound();
  try {
    const data = await readFile(path.join(path.resolve(getEnv().UPLOAD_DIR), segments[0]));
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}
