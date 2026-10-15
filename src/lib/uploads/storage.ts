import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/env";
import { processImage } from "./process-image";

const IMAGE_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

export function isValidImagePath(name: string): boolean {
  return IMAGE_PATH_RE.test(name);
}

function uploadDir(): string {
  return path.resolve(getEnv().UPLOAD_DIR);
}

const thumbName = (name: string) => name.replace(/\.webp$/, ".thumb.webp");

export async function saveImage(buf: Buffer): Promise<{ path: string }> {
  const { large, thumb } = await processImage(buf);
  const name = `${randomUUID()}.webp`;
  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  await Promise.all([writeFile(path.join(dir, name), large), writeFile(path.join(dir, thumbName(name)), thumb)]);
  return { path: name };
}

export function uploadUrl(name: string): string {
  return `/uploads/${name}`;
}

export function thumbUrl(name: string): string {
  return `/uploads/${thumbName(name)}`;
}

/** Removes both variants; missing files are ignored. Invalid names are a no-op. */
export async function deleteImage(name: string): Promise<void> {
  if (!isValidImagePath(name)) return;
  const dir = uploadDir();
  for (const file of [name, thumbName(name)]) {
    try {
      await unlink(path.join(dir, file));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
}
