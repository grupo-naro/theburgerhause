import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, SAMPLE_TICKET } from "./cli";
import { printDocumentSchema } from "./document";
import { FakeServer, tmpDir } from "./testing/support";

let dir: string;
let server: FakeServer | null = null;
beforeEach(() => {
  dir = tmpDir();
});
afterEach(async () => {
  await server?.stop();
  server = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string | undefined> = {}, extra: { exeDir?: string } = {}) {
  let out = "";
  let err = "";
  const code = main(args, {
    env: { DATA_DIR: dir, ...env },
    cwd: dir,
    platform: "linux",
    exeDir: extra.exeDir ?? dir,
    stdout: (s) => void (out += s),
    stderr: (s) => void (err += s),
  });
  return code.then((c) => ({ code: c, out, err }));
}

describe("cli", () => {
  it("--help lists the commands and exits 0", async () => {
    const r = await run(["--help"]);
    expect(r.code).toBe(0);
    for (const word of ["run", "test-print", "check", "SERVER_URL", "STATION_TOKEN", "PRINTER_BACKEND"]) expect(r.out).toContain(word);
  });

  it("an unknown command exits 2 with a hint", async () => {
    const r = await run(["dance"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--help");
  });

  it("the sample ticket is a valid PrintDocument with accents, bold, size 2, divider and a cut", () => {
    expect(printDocumentSchema.safeParse(SAMPLE_TICKET).success).toBe(true);
    const json = JSON.stringify(SAMPLE_TICKET);
    expect(json).toContain("áéíóú");
    expect(json).toContain('"bold":true');
    expect(json).toContain('"size":2');
    expect(json).toContain('"divider"');
    expect(SAMPLE_TICKET.blocks.at(-1)).toEqual({ type: "cut" });
  });

  it("test-print writes the sample ticket through the configured backend, with no server settings", async () => {
    const out = path.join(dir, "out");
    const r = await run(["test-print"], { PRINTER_BACKEND: "file", OUTPUT_DIR: out, CODEPAGE: "cp858" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("Ticket de prueba enviado");
    const files = fs.readdirSync(out);
    expect(files).toHaveLength(1);
    const bytes = fs.readFileSync(path.join(out, files[0]));
    expect(bytes.subarray(0, 2).toString("hex")).toBe("1b40");
    expect(bytes.includes(Buffer.from([0xa0, 0x82, 0xa1, 0xa2, 0xa3]))).toBe(true); // áéíóú in cp858
    expect(bytes.toString("hex").endsWith("1b64041d564203")).toBe(true);
  });

  it("test-print reports a printer failure clearly and exits 1", async () => {
    const blocker = path.join(dir, "blocker");
    fs.writeFileSync(blocker, "x");
    const r = await run(["test-print"], { PRINTER_BACKEND: "file", OUTPUT_DIR: path.join(blocker, "sub") });
    expect(r.code).toBe(1);
    expect(r.err).toContain("No se pudo escribir");
  });

  it("invalid configuration prints every error (Spanish, naming the key) and exits 2, without echoing the token", async () => {
    const r = await run(["check"], { SERVER_URL: "nope", STATION_TOKEN: "bhst_secretsecretsecret", PAPER_WIDTH: "70" });
    expect(r.code).toBe(2);
    expect(r.err).toContain("SERVER_URL");
    expect(r.err).toContain("STATION_TOKEN");
    expect(r.err).toContain("PAPER_WIDTH");
    expect(r.err + r.out).not.toContain("secretsecret");
  });

  it("config.json next to the executable is used, and the environment wins over it", async () => {
    server = await FakeServer.start();
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ SERVER_URL: "http://wrong.invalid", STATION_TOKEN: server.token, PRINTER_BACKEND: "console" }));
    const r = await run(["check"], { SERVER_URL: server.url });
    expect(r.code).toBe(0);
    expect(r.out).toContain(server.url);
  });

  it("check validates the config, pings the server (heartbeat) and masks the token", async () => {
    server = await FakeServer.start();
    const r = await run(["check"], { SERVER_URL: server.url, STATION_TOKEN: server.token, PRINTER_BACKEND: "console" });
    expect(r.code).toBe(0);
    expect(server.heartbeats).toBe(1);
    expect(r.out).toContain("Servidor: OK");
    expect(r.out).toContain("bhst_TTTT…");
    expect(r.out + r.err).not.toContain(server.token);
  });

  it("check says plainly when the token is rejected, and exits 1", async () => {
    server = await FakeServer.start();
    const r = await run(["check"], { SERVER_URL: server.url, STATION_TOKEN: "bhst_" + "W".repeat(43), PRINTER_BACKEND: "console" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("Token inválido o rotado: generá uno nuevo en Admin → Estaciones");
  });

  it("check says plainly when the server is unreachable, and exits 1", async () => {
    server = await FakeServer.start();
    const url = server.url;
    await server.stop();
    server = null;
    const r = await run(["check"], { SERVER_URL: url, STATION_TOKEN: "bhst_" + "W".repeat(43), PRINTER_BACKEND: "console" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("No se pudo conectar con el servidor");
  });
});
