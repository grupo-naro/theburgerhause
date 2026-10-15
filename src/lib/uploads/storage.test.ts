import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let dir: string;
vi.mock("@/lib/env", () => ({ getEnv: () => ({ UPLOAD_DIR: dir }) }));

import { deleteImage, isValidImagePath, saveImage, thumbUrl, uploadUrl } from "./storage";

beforeAll(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "bh-up-")), "nested");
});
afterAll(async () => {
  await rm(path.dirname(dir), { recursive: true, force: true });
});

const sample = () => sharp({ create: { width: 500, height: 400, channels: 3, background: "#c33" } }).png().toBuffer();
const exists = (p: string) => stat(p).then(() => true, () => false);

describe("storage", () => {
  it("saves both files, creating the dir, and returns a valid name", async () => {
    const { path: name } = await saveImage(await sample());
    expect(isValidImagePath(name)).toBe(true);
    expect(await exists(path.join(dir, name))).toBe(true);
    expect(await exists(path.join(dir, name.replace(".webp", ".thumb.webp")))).toBe(true);
    expect(uploadUrl(name)).toBe(`/uploads/${name}`);
    expect(thumbUrl(name)).toBe(`/uploads/${name.replace(".webp", ".thumb.webp")}`);
  });

  it("deleteImage removes both files and is idempotent", async () => {
    const { path: name } = await saveImage(await sample());
    await deleteImage(name);
    expect(await exists(path.join(dir, name))).toBe(false);
    await expect(deleteImage(name)).resolves.toBeUndefined();
  });

  it("deleteImage ignores invalid names without touching the fs", async () => {
    const before = await readdir(dir);
    await deleteImage("../x.webp");
    expect(await readdir(dir)).toEqual(before);
  });

  it("isValidImagePath rejects bad names", () => {
    const u = "123e4567-e89b-42d3-a456-426614174000";
    expect(isValidImagePath(`${u}.webp`)).toBe(true);
    expect(isValidImagePath("../x.webp")).toBe(false);
    expect(isValidImagePath("a.webp")).toBe(false);
    expect(isValidImagePath(`${u}x.webp`)).toBe(false);
    expect(isValidImagePath(`${u}.thumb.webp`)).toBe(false);
    expect(isValidImagePath(`../${u}.webp`)).toBe(false);
  });
});
