import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger, fileSink, redact, type LogEntry } from "./logger";

const TOKEN = "bhst_" + "Zq9".repeat(14) + "Z";
const at = () => new Date("2026-10-15T10:00:00.000Z");

function capture(level: "debug" | "info" | "warn" | "error" = "info") {
  const lines: string[] = [];
  const entries: LogEntry[] = [];
  const logger = createLogger({ level, now: at, sinks: [{ write: (line, e) => (lines.push(line), entries.push(e)) }] });
  return { logger, lines, entries };
}

describe("logger", () => {
  it("formats timestamp, level, message and fields", () => {
    const { logger, lines } = capture();
    logger.info("conectado", { station: "Mostrador 1", attempt: 2, ok: true });
    expect(lines).toEqual(["2026-10-15T10:00:00.000Z INFO  conectado station=Mostrador 1 attempt=2 ok=true"]);
  });

  it("filters by level", () => {
    const { logger, entries } = capture("warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(entries.map((e) => e.level)).toEqual(["warn", "error"]);
  });

  it("redacts tokens anywhere in a message or a field", () => {
    const { logger, lines } = capture();
    logger.info(`usando ${TOKEN} y Bearer ${TOKEN}`, { header: `Authorization: Bearer ${TOKEN}`, other: TOKEN });
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(lines.join("\n")).not.toContain("Zq9Zq9");
    expect(lines[0]).toContain("bhst_***");
  });

  it("never logs documents or tokens passed as fields, whatever the key", () => {
    const { logger, lines, entries } = capture("debug");
    logger.debug("job", { document: { blocks: [{ type: "text", text: "SECRETO" }] }, payload: "x", token: "abc", blocks: [1], authorization: "Bearer abc", id: 4 });
    expect(lines[0]).not.toContain("SECRETO");
    expect(lines[0]).toContain("document=[omitido]");
    expect(lines[0]).toContain("id=4");
    expect(JSON.stringify(entries)).not.toContain("SECRETO");
  });

  it("logs an Error as its message only (no stack)", () => {
    const { logger, lines } = capture();
    logger.error("falló", { err: new Error(`boom ${TOKEN}`) });
    expect(lines[0]).toContain("err=boom bhst_***");
    expect(lines[0]).not.toContain("at ");
  });

  it("collapses newlines so one entry is one line", () => {
    const { logger, lines } = capture();
    logger.info("a\nb\r\nc", { x: "1\n2" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/[\r\n]/);
  });

  it("redact() is usable on its own", () => {
    expect(redact(`x ${TOKEN} y`)).toBe("x bhst_*** y");
  });

  it("a failing sink never breaks logging", () => {
    const logger = createLogger({ level: "info", sinks: [{ write: () => { throw new Error("disk full"); } }] });
    expect(() => logger.info("hi")).not.toThrow();
  });
});

describe("fileSink rotation", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-log-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("writes to DATA_DIR/logs/agent.log", () => {
    const sink = fileSink(dir);
    const logger = createLogger({ level: "info", now: at, sinks: [sink] });
    logger.info("hola");
    expect(fs.readFileSync(path.join(dir, "logs", "agent.log"), "utf8")).toBe("2026-10-15T10:00:00.000Z INFO  hola\n");
  });

  it("rotates at the size limit and keeps at most 5 files", () => {
    const sink = fileSink(dir, { maxBytes: 200, maxFiles: 5 });
    const logger = createLogger({ level: "info", now: at, sinks: [sink] });
    for (let i = 0; i < 60; i++) logger.info("x".repeat(60) + i);
    const files = fs.readdirSync(path.join(dir, "logs")).sort();
    expect(files).toEqual(["agent.1.log", "agent.2.log", "agent.3.log", "agent.4.log", "agent.log"]);
    for (const f of files) expect(fs.statSync(path.join(dir, "logs", f)).size).toBeLessThanOrEqual(200 + 80);
    expect(fs.readFileSync(path.join(dir, "logs", "agent.log"), "utf8")).toContain("x".repeat(60) + "59");
  });

  it("does not throw when the directory is unusable", () => {
    const blocker = path.join(dir, "blocker");
    fs.writeFileSync(blocker, "file");
    const sink = fileSink(blocker);
    expect(() => sink.write("line", { level: "info", msg: "m", time: at(), fields: {} })).not.toThrow();
  });
});
