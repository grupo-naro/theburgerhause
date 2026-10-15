import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const LARGE_WIDTH = 800;
const THUMB_WIDTH = 200;
const WEBP_QUALITY = 80;

export type ImageErrorCode = "UNSUPPORTED_TYPE" | "TOO_LARGE" | "CORRUPT";

export class ImageError extends Error {
  readonly code: ImageErrorCode;
  constructor(code: ImageErrorCode) {
    super(`Image rejected: ${code}`);
    this.name = "ImageError";
    this.code = code;
  }
}

/** Magic-byte detection only; filename and declared MIME are never consulted. */
export function detectImageType(buf: Buffer): "jpeg" | "png" | "webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "png";
  }
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") {
    return "webp";
  }
  return null;
}

function resizeTo(buf: Buffer, width: number): Promise<Buffer> {
  return sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
    .rotate() // apply EXIF orientation; metadata is dropped on output by default
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

export async function processImage(buf: Buffer): Promise<{ large: Buffer; thumb: Buffer }> {
  if (buf.length > MAX_UPLOAD_BYTES) throw new ImageError("TOO_LARGE");
  if (!detectImageType(buf)) throw new ImageError("UNSUPPORTED_TYPE");
  try {
    const [large, thumb] = await Promise.all([resizeTo(buf, LARGE_WIDTH), resizeTo(buf, THUMB_WIDTH)]);
    return { large, thumb };
  } catch {
    throw new ImageError("CORRUPT");
  }
}
