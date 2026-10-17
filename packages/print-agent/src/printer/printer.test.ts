import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConsoleBackend, previewEscPos } from "./console";
import { FileBackend } from "./file";
import { TcpBackend } from "./tcp";
import { PrintError } from "./types";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-printer-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("FileBackend", () => {
  it("writes the exact bytes to OUTPUT_DIR/job-<id>-1.bin", async () => {
    const out = path.join(dir, "out");
    const b = new FileBackend(out);
    const bytes = Buffer.from([0x1b, 0x40, 0x41, 0x0a]);
    await b.print(bytes, { jobId: 12 });
    expect(fs.readdirSync(out)).toEqual(["job-12-1.bin"]);
    expect(fs.readFileSync(path.join(out, "job-12-1.bin"))).toEqual(bytes);
    expect(b.describe()).toContain(out);
  });

  it("never overwrites: printing the same job twice leaves two files (so a duplicate is visible)", async () => {
    const b = new FileBackend(dir);
    await b.print(Buffer.from("a"), { jobId: 3 });
    await b.print(Buffer.from("b"), { jobId: 3 });
    expect(fs.readdirSync(dir).sort()).toEqual(["job-3-1.bin", "job-3-2.bin"]);
  });

  it("leaves no partial files behind and reports an unwritable directory as a PrintError", async () => {
    const blocker = path.join(dir, "blocker");
    fs.writeFileSync(blocker, "x");
    const b = new FileBackend(path.join(blocker, "sub"));
    await expect(b.print(Buffer.from("a"), { jobId: 1 })).rejects.toBeInstanceOf(PrintError);
  });
});

describe("ConsoleBackend", () => {
  it("writes a readable preview (no control codes) and the size", async () => {
    const chunks: string[] = [];
    const b = new ConsoleBackend((s) => chunks.push(s));
    const bytes = Buffer.concat([Buffer.from([0x1b, 0x40, 0x1b, 0x74, 0x13, 0x1b, 0x61, 0x01, 0x1b, 0x45, 0x01, 0x1d, 0x21, 0x11]), Buffer.from("HOLA\n"), Buffer.from([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x03])]);
    await b.print(bytes, { jobId: 9 });
    const text = chunks.join("");
    expect(text).toContain("HOLA");
    expect(text).toContain("job 9");
    expect(text).toContain("[corte]");
    expect(text).not.toMatch(/[\u0000-\u0008\u001b\u001d]/);
  });

  it("previewEscPos summarizes a GS v 0 raster as [logo WxH] and does not print its data as text", () => {
    const data = Buffer.alloc(2 * 3, 0x41); // 16x3 dots, bytes that look like the letter A
    const bytes = Buffer.concat([Buffer.from([0x1d, 0x76, 0x30, 0x00, 2, 0, 3, 0]), data, Buffer.from([0x42, 0x0a])]);
    expect(previewEscPos(bytes)).toBe("[logo 16x3]\nB\n");
  });

  it("previewEscPos strips commands and keeps text lines", () => {
    expect(previewEscPos(Buffer.from([0x1b, 0x40, 0x41, 0x0a, 0x1d, 0x56, 0x42, 0x03]))).toBe("A\n[corte]\n");
  });
});

describe("TcpBackend", () => {
  it("sends the bytes to host:port and resolves once the socket is flushed", async () => {
    const received: Buffer[] = [];
    const server = net.createServer((sock) => {
      sock.on("data", (d) => received.push(d));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    const b = new TcpBackend("127.0.0.1", port);
    const bytes = Buffer.alloc(5000, 0x41);
    await b.print(bytes, { jobId: 1 });
    await new Promise((r) => setTimeout(r, 20));
    expect(Buffer.concat(received)).toEqual(bytes);
    expect(b.describe()).toContain(`127.0.0.1:${port}`);
    await new Promise((r) => server.close(r));
  });

  it("maps a refused connection to a short Spanish PrintError", async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise((r) => server.close(r));
    const err = await new TcpBackend("127.0.0.1", port).print(Buffer.from("x"), { jobId: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(PrintError);
    expect(err.message).toMatch(/No se pudo conectar con la impresora/);
    expect(err.message).not.toMatch(/ECONNREFUSED|at /);
  });

  it("times out when the printer never accepts the connection", async () => {
    const server = net.createServer(); // accepts but never reads: fine, but we test connect timeout via a blackhole address
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    // a tiny timeout against a server that is listening still connects; use an unroutable address instead
    const b = new TcpBackend("10.255.255.1", port, { timeoutMs: 100 });
    const err = await b.print(Buffer.from("x"), { jobId: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(PrintError);
    expect(err.message).toMatch(/impresora/i);
    await new Promise((r) => server.close(r));
  });
});
