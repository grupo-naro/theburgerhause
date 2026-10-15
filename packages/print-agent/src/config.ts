import fs from "node:fs";
import path from "node:path";
import { CODEPAGES, type Codepage } from "./codepages";
import type { PaperWidth } from "./escpos";
import { isValidPrinterName, PRINTER_NAME_HELP } from "./printer/printer-name";

export const BACKENDS = ["windows", "tcp", "file", "console"] as const;
export type BackendName = (typeof BACKENDS)[number];
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type AgentConfig = {
  serverUrl: string;
  stationToken: string;
  paperWidth: PaperWidth;
  codepage: Codepage;
  printerBackend: BackendName;
  printerName?: string;
  printerHost?: string;
  printerPort: number;
  outputDir: string;
  dataDir: string;
  logLevel: LogLevel;
  allowInsecure: boolean;
};
export type ConfigResult = { ok: true; config: AgentConfig } | { ok: false; errors: string[] };

export { PRINTER_NAME_PATTERN } from "./printer/printer-name";
const TOKEN_PATTERN = /^bhst_[A-Za-z0-9_-]{43}$/;
const HOST_PATTERN = /^[A-Za-z0-9.\-:[\]]{1,253}$/;
const KEYS = [
  "SERVER_URL", "STATION_TOKEN", "PAPER_WIDTH", "CODEPAGE", "PRINTER_BACKEND", "PRINTER_NAME", "PRINTER_HOST",
  "PRINTER_PORT", "OUTPUT_DIR", "DATA_DIR", "LOG_LEVEL", "ALLOW_INSECURE", "PROGRAMDATA",
] as const;

export function maskToken(token: string): string {
  if (!token) return "";
  return token.length < 12 ? "***" : `${token.slice(0, 9)}…`;
}

/** Value of a key: the environment wins over config.json; empty strings count as "not set". */
function pick(env: Record<string, string | undefined>, file: Record<string, unknown>, key: string): string | undefined {
  for (const v of [env[key], file[key]]) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      const s = String(v).trim();
      if (s !== "") return s;
    }
  }
  return undefined;
}

const isLocalhost = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";

export function loadConfig(input: { env: Record<string, string | undefined>; file?: Record<string, unknown>; platform: NodeJS.Platform; cwd: string }): ConfigResult {
  const { env, platform, cwd } = input;
  const file = input.file ?? {};
  const v = Object.fromEntries(KEYS.map((k) => [k, pick(env, file, k)])) as Record<(typeof KEYS)[number], string | undefined>;
  const errors: string[] = [];
  const fail = (key: string, msg: string) => errors.push(`${key}: ${msg}`);
  const oneOf = <T extends string>(key: string, raw: string | undefined, allowed: readonly T[], dflt: T): T => {
    if (raw === undefined) return dflt;
    const x = raw.toLowerCase() as T;
    if (allowed.includes(x)) return x;
    fail(key, `valor inválido «${raw.slice(0, 40)}»; opciones: ${allowed.join(", ")}`);
    return dflt;
  };

  const allowInsecure = ["1", "true", "yes"].includes((v.ALLOW_INSECURE ?? "").toLowerCase());

  let serverUrl = "";
  if (!v.SERVER_URL) fail("SERVER_URL", "falta la URL del servidor (por ejemplo https://pedidos.example.com)");
  else {
    let url: URL | null = null;
    try {
      url = new URL(v.SERVER_URL);
    } catch {
      url = null;
    }
    if (!url || !["https:", "http:"].includes(url.protocol) || !url.hostname) fail("SERVER_URL", `no es una URL http(s) válida «${v.SERVER_URL.slice(0, 80)}»`);
    else if (url.username || url.password) fail("SERVER_URL", "no debe incluir usuario ni contraseña");
    else if (url.protocol === "http:" && !isLocalhost(url.hostname) && !allowInsecure)
      fail("SERVER_URL", "http solo se permite para localhost; usá https o, bajo tu responsabilidad, ALLOW_INSECURE=1");
    else serverUrl = (url.origin + url.pathname).replace(/\/+$/, "");
  }

  let stationToken = "";
  if (!v.STATION_TOKEN) fail("STATION_TOKEN", "falta el token de la estación (se genera en Admin → Estaciones)");
  else if (!TOKEN_PATTERN.test(v.STATION_TOKEN)) fail("STATION_TOKEN", "no tiene el formato esperado (bhst_ seguido de 43 caracteres); copialo completo desde Admin → Estaciones");
  else stationToken = v.STATION_TOKEN;

  const width = oneOf("PAPER_WIDTH", v.PAPER_WIDTH, ["58", "80"] as const, "80");
  const codepage = oneOf("CODEPAGE", v.CODEPAGE, CODEPAGES, "cp858");
  const printerBackend = oneOf("PRINTER_BACKEND", v.PRINTER_BACKEND, BACKENDS, platform === "win32" ? "windows" : "console");
  const logLevel = oneOf("LOG_LEVEL", v.LOG_LEVEL, LOG_LEVELS, "info");

  const pathMod = platform === "win32" ? path.win32 : path;
  const programData = v.PROGRAMDATA ?? (platform === "win32" ? "C:\\ProgramData" : undefined);
  const dataDir = v.DATA_DIR ? path.resolve(cwd, v.DATA_DIR) : platform === "win32" && programData ? pathMod.join(programData, "BurgerHouseAgent") : path.resolve(cwd, "data");
  const outputDir = v.OUTPUT_DIR ? path.resolve(cwd, v.OUTPUT_DIR) : path.join(dataDir, "output");

  let printerName: string | undefined;
  if (printerBackend === "windows") {
    if (!v.PRINTER_NAME) fail("PRINTER_NAME", "falta el nombre de la impresora de Windows (listalas con «print-agent check»)");
    else if (!isValidPrinterName(v.PRINTER_NAME)) fail("PRINTER_NAME", `nombre no válido: ${PRINTER_NAME_HELP}`);
    else printerName = v.PRINTER_NAME;
  }

  let printerHost: string | undefined;
  let printerPort = 9100;
  if (printerBackend === "tcp") {
    if (!v.PRINTER_HOST) fail("PRINTER_HOST", "falta la IP o el nombre de la impresora de red");
    else if (!HOST_PATTERN.test(v.PRINTER_HOST)) fail("PRINTER_HOST", "no es un host válido");
    else printerHost = v.PRINTER_HOST;
    if (v.PRINTER_PORT !== undefined) {
      const port = /^\d{1,5}$/.test(v.PRINTER_PORT) ? Number(v.PRINTER_PORT) : 0;
      if (port < 1 || port > 65535) fail("PRINTER_PORT", `puerto inválido «${v.PRINTER_PORT.slice(0, 10)}» (1-65535)`);
      else printerPort = port;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    config: {
      serverUrl,
      stationToken,
      paperWidth: Number(width) as PaperWidth,
      codepage,
      printerBackend,
      printerName,
      printerHost,
      printerPort,
      outputDir,
      dataDir,
      logLevel,
      allowInsecure,
    },
  };
}

/** config.json next to the executable (or in `dir`); missing file = {}, broken file = error message. */
export function readConfigFile(dirs: string[]): { file: Record<string, unknown>; path?: string; error?: string } {
  for (const dir of dirs) {
    const p = path.join(dir, "config.json");
    let raw: string;
    try {
      raw = fs.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { file: {}, path: p, error: `${p}: debe contener un objeto JSON` };
      return { file: parsed as Record<string, unknown>, path: p };
    } catch {
      return { file: {}, path: p, error: `${p}: JSON inválido` };
    }
  }
  return { file: {} };
}

/** Human-readable summary for logs and `check`. The token is masked. */
export function describeConfig(c: AgentConfig): string {
  const lines = [
    `SERVER_URL=${c.serverUrl}`,
    `STATION_TOKEN=${maskToken(c.stationToken)}`,
    `PAPER_WIDTH=${c.paperWidth}`,
    `CODEPAGE=${c.codepage}`,
    `PRINTER_BACKEND=${c.printerBackend}`,
    ...(c.printerName ? [`PRINTER_NAME=${c.printerName}`] : []),
    ...(c.printerHost ? [`PRINTER_HOST=${c.printerHost}:${c.printerPort}`] : []),
    ...(c.printerBackend === "file" ? [`OUTPUT_DIR=${c.outputDir}`] : []),
    `DATA_DIR=${c.dataDir}`,
    `LOG_LEVEL=${c.logLevel}`,
  ];
  return lines.join("\n");
}
