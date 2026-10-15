import fs from "node:fs";
import path from "node:path";
import type { LogLevel } from "./config";

export type LogFields = Record<string, unknown>;
export type LogEntry = { level: LogLevel; msg: string; time: Date; fields: LogFields };
export type LogSink = { write(line: string, entry: LogEntry): void };
export type Logger = {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
};

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
/** Fields with these names are never printed, whatever they hold. */
const OMITTED_KEYS = /^(document|payload|blocks|token|stationtoken|authorization|secret|password|body)$/i;

/** Scrubs station tokens (and Bearer credentials) from any text. */
export function redact(text: string): string {
  return text.replace(/bhst_[A-Za-z0-9_-]{8,}/g, "bhst_***").replace(/(bearer\s+)(?!bhst_\*\*\*)\S+/gi, "$1***");
}

const oneLine = (s: string) => redact(s).replace(/\s*[\r\n]+\s*/g, " ");

function fieldText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return String(value);
  return "[objeto]";
}

/** What sinks (and tests) see: omitted keys blanked, Errors reduced to their message, text redacted. */
function sanitizeFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (OMITTED_KEYS.test(k)) out[k] = "[omitido]";
    else if (v instanceof Error) out[k] = oneLine(v.message);
    else if (typeof v === "string") out[k] = oneLine(v);
    else out[k] = v;
  }
  return out;
}

export function formatEntry(e: LogEntry): string {
  const fields = Object.entries(e.fields)
    .map(([k, v]) => `${k}=${fieldText(v)}`)
    .join(" ");
  return `${e.time.toISOString()} ${e.level.toUpperCase().padEnd(5)} ${e.msg}${fields ? " " + fields : ""}`;
}

export function createLogger(opts: { level: LogLevel; sinks: LogSink[]; now?: () => Date }): Logger {
  const emit = (level: LogLevel, msg: string, fields: LogFields = {}) => {
    if (ORDER[level] < ORDER[opts.level]) return;
    const entry: LogEntry = { level, msg: oneLine(msg), time: (opts.now ?? (() => new Date()))(), fields: sanitizeFields(fields) };
    const line = formatEntry(entry);
    for (const sink of opts.sinks) {
      try {
        sink.write(line, entry);
      } catch {
        // logging must never break the agent
      }
    }
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}

type Writable = { write(s: string): unknown };

export function consoleSink(out: Writable = process.stdout, err: Writable = process.stderr): LogSink {
  return {
    write(line, e) {
      (e.level === "error" || e.level === "warn" ? err : out).write(line + "\n");
    },
  };
}

/** DATA_DIR/logs/agent.log, rotated at maxBytes into agent.1.log ... (maxFiles files in total). */
export function fileSink(dataDir: string, opts: { maxBytes?: number; maxFiles?: number } = {}): LogSink {
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  const maxFiles = opts.maxFiles ?? 5;
  const dir = path.join(dataDir, "logs");
  const current = path.join(dir, "agent.log");
  const rotated = (n: number) => path.join(dir, `agent.${n}.log`);
  return {
    write(line) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const data = line + "\n";
        let size = 0;
        try {
          size = fs.statSync(current).size;
        } catch {
          // no file yet
        }
        if (size > 0 && size + Buffer.byteLength(data) > maxBytes) {
          fs.rmSync(rotated(maxFiles - 1), { force: true });
          for (let i = maxFiles - 2; i >= 1; i--) if (fs.existsSync(rotated(i))) fs.renameSync(rotated(i), rotated(i + 1));
          fs.renameSync(current, rotated(1));
        }
        fs.appendFileSync(current, data);
      } catch {
        // an unusable log directory must not stop printing
      }
    },
  };
}
