import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let dir: string;
vi.mock("@/lib/env", () => ({ getEnv: () => ({ UPLOAD_DIR: dir }) }));

import { GET } from "./route";

const U = "123e4567-e89b-42d3-a456-426614174000";

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "bh-get-"));
  await writeFile(path.join(dir, `${U}.webp`), "webpdata");
  await writeFile(path.join(dir, `${U}.thumb.webp`), "thumbdata");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const get = (...segs: string[]) =>
  GET(new Request(`http://localhost:3000/uploads/${segs.join("/")}`), { params: Promise.resolve({ path: segs }) });

describe("GET /uploads/[...path]", () => {
  it("serves existing file with headers", async () => {
    const res = await get(`${U}.webp`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("webpdata");
  });

  it("serves thumb", async () => {
    const res = await get(`${U}.thumb.webp`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("thumbdata");
  });

  it.each([
    [["..", "..", "etc", "passwd"]],
    [["foo.webp"]],
    [["x.exe"]],
    [[`${U}.webp`, "extra"]],
    [[`..%2F${U}.webp`]],
    [[`${"-".repeat(36)}.webp`]],
    [[]],
  ])("404 for %j", async (segs) => {
    expect((await get(...segs)).status).toBe(404);
  });

  it("404 for missing valid name", async () => {
    expect((await get("00000000-0000-4000-8000-000000000000.webp")).status).toBe(404);
  });
});
