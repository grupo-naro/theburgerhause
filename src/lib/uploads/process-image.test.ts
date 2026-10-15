import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ImageError, MAX_UPLOAD_BYTES, detectImageType, processImage } from "./process-image";

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#c33" } }).png().toBuffer();

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ImageError);
    return (e as ImageError).code;
  }
  throw new Error("expected rejection");
}

describe("detectImageType", () => {
  it("detects by magic bytes only", () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("jpeg");
    expect(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(detectImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(detectImageType(Buffer.from("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
    expect(detectImageType(Buffer.from("GIF89a..."))).toBeNull();
    expect(detectImageType(Buffer.from("<svg></svg>"))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(Buffer.from("MZ\x90\x00"))).toBeNull();
  });
});

describe("processImage", () => {
  it("produces 800px and 200px webp preserving aspect ratio", async () => {
    const { large, thumb } = await processImage(await png(1200, 900));
    expect(detectImageType(large)).toBe("webp");
    expect(detectImageType(thumb)).toBe("webp");
    const l = await sharp(large).metadata();
    const t = await sharp(thumb).metadata();
    expect(l.width).toBe(800);
    expect(Math.abs((l.height ?? 0) - 600)).toBeLessThanOrEqual(1);
    expect(t.width).toBe(200);
    expect(Math.abs((t.height ?? 0) - 150)).toBeLessThanOrEqual(1);
  });

  it("does not enlarge small images", async () => {
    const jpeg = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#369" } }).jpeg().toBuffer();
    const { large, thumb } = await processImage(jpeg);
    expect((await sharp(large).metadata()).width).toBe(300);
    expect((await sharp(thumb).metadata()).width).toBe(200);
  });

  it("applies EXIF orientation and strips metadata", async () => {
    const jpeg = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#369" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const { large } = await processImage(jpeg);
    const m = await sharp(large).metadata();
    expect(m.width).toBe(200);
    expect(m.height).toBe(400);
    expect(m.exif).toBeUndefined();
    expect(m.orientation).toBeUndefined();
  });

  it("rejects text renamed to .jpg", async () => {
    expect(await codeOf(processImage(Buffer.from("not an image at all")))).toBe("UNSUPPORTED_TYPE");
  });

  it("rejects GIF", async () => {
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).gif().toBuffer();
    expect(await codeOf(processImage(gif))).toBe("UNSUPPORTED_TYPE");
  });

  it("rejects truncated PNG as CORRUPT", async () => {
    const full = await sharp({ create: { width: 600, height: 600, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 40 } } }).png().toBuffer();
    expect(await codeOf(processImage(full.subarray(0, Math.floor(full.length / 3))))).toBe("CORRUPT");
  });

  it("rejects buffers over 5MB", async () => {
    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
    expect(await codeOf(processImage(big))).toBe("TOO_LARGE");
  });
});
