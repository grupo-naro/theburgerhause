import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";

/** Runs the real `release` script (build + bundle + zip) and inspects the result. */
const pkgDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const repoRoot = path.resolve(pkgDir, "../..");
const version = (JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")) as { version: string }).version;
const name = `burgerhause-print-agent-${version}`;
const releaseDir = path.join(pkgDir, "release");
const folder = path.join(releaseDir, name);
const zipPath = path.join(releaseDir, `${name}.zip`);

const EXPECTED = ["print-agent.cjs", "install.ps1", "uninstall.ps1", "status.ps1", "update.ps1", "common.ps1", "config.example.json", "LEEME.txt"].sort();

type ZipEntry = { name: string; size: number; crc: number; data: Buffer };

/** Minimal zip reader (central directory + deflate/store), enough to verify our own archive. */
function readZip(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const entryName = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(lho + 30 + lnlen + lelen, lho + 30 + lnlen + lelen + csize);
    out.push({ name: entryName, size, crc, data: method === 8 ? zlib.inflateRawSync(raw) : raw });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

describe("release packaging", () => {
  beforeAll(() => {
    const r = spawnSync("pnpm", ["--filter", "@burgerhause/print-agent", "release"], { cwd: repoRoot, encoding: "utf8", shell: true, timeout: 170_000 });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  }, 180_000);

  it("produces the folder, the zip and a matching .sha256", () => {
    expect(fs.readdirSync(folder).sort()).toEqual(EXPECTED);
    const sha = fs.readFileSync(`${zipPath}.sha256`, "utf8").trim();
    const digest = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
    expect(sha).toBe(`${digest}  ${name}.zip`);
  });

  it("zip entries are exactly the release folder files (names, sizes, crc, bytes)", () => {
    const entries = readZip(fs.readFileSync(zipPath));
    expect(entries.map((e) => e.name).sort()).toEqual(EXPECTED.map((f) => `${name}/${f}`).sort());
    for (const e of entries) {
      const disk = fs.readFileSync(path.join(releaseDir, e.name));
      expect(e.size).toBe(disk.length);
      expect(e.data.equals(disk), e.name).toBe(true);
      expect(zlib.crc32(disk) >>> 0).toBe(e.crc);
    }
  });

  it("the bundled print-agent.cjs runs --help", () => {
    const r = spawnSync(process.execPath, [path.join(folder, "print-agent.cjs"), "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Burger Hause Print Agent");
  });

  it("contains no real token and no developer paths", () => {
    const slashed = repoRoot.replace(/\\/g, "/");
    for (const f of walk(folder)) {
      const text = fs.readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/bhst_[A-Za-z0-9_-]{30,}/);
      expect(text.includes(repoRoot) || text.includes(slashed) || text.includes(repoRoot.replace(/\\/g, "\\\\")), `${f} has the repo path`).toBe(false);
      expect(text, f).not.toMatch(/gruponaroprojects/i);
    }
  });

  it("config.example.json is valid JSON with placeholders only", () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(folder, "config.example.json"), "utf8")) as Record<string, unknown>;
    expect(cfg.SERVER_URL).toMatch(/^https:\/\//);
    expect(String(cfg.STATION_TOKEN)).not.toMatch(/^bhst_[A-Za-z0-9_-]{43}$/);
  });

  it("LEEME.txt points to the guide", () => {
    const t = fs.readFileSync(path.join(folder, "LEEME.txt"), "utf8");
    expect(t).toContain("print-agent-install.md");
    expect(t).toContain("install.ps1");
  });
});
