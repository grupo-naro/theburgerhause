import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/auth/roles";

let dir: string;
vi.mock("@/lib/env", () => ({ getEnv: () => ({ UPLOAD_DIR: dir }) }));
const requireRole = vi.fn();
vi.mock("@/lib/auth/require-role", () => ({ requireRole: (...a: unknown[]) => requireRole(...a) }));

import { POST } from "./route";

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "bh-route-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  requireRole.mockReset();
  requireRole.mockResolvedValue({ user: { role: "admin" } });
});

const png = () => sharp({ create: { width: 900, height: 600, channels: 3, background: "#c33" } }).png().toBuffer();

function upload(opts: { body?: Buffer | string; field?: string; name?: string; headers?: Record<string, string> } = {}) {
  const form = new FormData();
  if (opts.body !== undefined || !opts.field) {
    form.set(opts.field ?? "file", new Blob([new Uint8Array(Buffer.from(opts.body ?? "x"))]), opts.name ?? "a.png");
  }
  return new Request("http://localhost:3000/api/uploads", {
    method: "POST",
    headers: { origin: "http://localhost:3000", host: "localhost:3000", ...opts.headers },
    body: form,
  });
}
const exists = (p: string) => stat(p).then(() => true, () => false);

describe("POST /api/uploads", () => {
  it("401 without session", async () => {
    requireRole.mockRejectedValue(new AuthError("UNAUTHENTICATED"));
    const res = await POST(upload({ body: await png() }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  it("403 for cajera", async () => {
    requireRole.mockRejectedValue(new AuthError("FORBIDDEN"));
    expect((await POST(upload({ body: await png() }))).status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith("admin");
  });

  it("201 for admin with png, files written", async () => {
    const res = await POST(upload({ body: await png() }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.path).toMatch(/^[0-9a-f-]{36}\.webp$/);
    expect(json.url).toBe(`/uploads/${json.path}`);
    expect(json.thumbUrl).toBe(`/uploads/${json.path.replace(".webp", ".thumb.webp")}`);
    expect(await exists(path.join(dir, json.path))).toBe(true);
    expect(await exists(path.join(dir, json.path.replace(".webp", ".thumb.webp")))).toBe(true);
  });

  it("403 on bad Origin, before auth", async () => {
    const res = await POST(upload({ body: await png(), headers: { origin: "http://evil.example" } }));
    expect(res.status).toBe(403);
    expect(requireRole).not.toHaveBeenCalled();
  });

  it("400 without file field", async () => {
    expect((await POST(upload({ field: "other", body: "x" }))).status).toBe(400);
  });

  it("400 when file field is a string", async () => {
    const form = new FormData();
    form.set("file", "text");
    const res = await POST(
      new Request("http://localhost:3000/api/uploads", {
        method: "POST",
        headers: { origin: "http://localhost:3000", host: "localhost:3000" },
        body: form,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("415 for text named .jpg, without leaking details", async () => {
    const res = await POST(upload({ body: "MZ not an image", name: "evil.jpg" }));
    expect(res.status).toBe(415);
    expect(JSON.stringify(await res.json())).not.toContain(dir);
  });

  it("413 for oversized Content-Length", async () => {
    const res = await POST(upload({ body: await png(), headers: { "content-length": String(6 * 1024 * 1024) } }));
    expect(res.status).toBe(413);
  });

  it("413 for oversized file", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1);
    big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
    expect((await POST(upload({ body: big }))).status).toBe(413);
  });

  it("422 for corrupt image", async () => {
    const full = await png();
    const res = await POST(upload({ body: full.subarray(0, 60) }));
    expect(res.status).toBe(422);
  });
});
