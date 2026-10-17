import path from "node:path";
import { AgentApi } from "./ack";
import { TOKEN_ERROR_MESSAGE } from "./client";
import { describeConfig, loadConfig, readConfigFile, type AgentConfig } from "./config";
import type { PrintDocument } from "./document";
import { toEscPos } from "./escpos";
import { startAgent } from "./index";
import { createBackend } from "./printer";
import { listPrinters } from "./printer/windows-raw";

const VERSION = "0.2.0";

export const SAMPLE_TICKET: PrintDocument = {
  blocks: [
    { type: "logo" },
    { type: "text", text: "Prueba de impresión", align: "center" },
    { type: "divider" },
    { type: "text", text: "Acentos: áéíóú ÁÉÍÓÚ ñ Ñ ü Ü" },
    { type: "text", text: "Signos: ¿Qué tal? ¡Hola! 50° $ 1.234,50" },
    { type: "text", text: "Texto en negrita", bold: true },
    { type: "text", text: "Tamaño doble", size: 2 },
    { type: "text", text: "Una línea larga para comprobar que se corta en el ancho del papel sin partir palabras a la mitad." },
    { type: "divider" },
    { type: "text", text: "Si ves esto completo y con acentos, la impresora está lista.", align: "center" },
    { type: "divider" },
    { type: "text", text: "GRACIAS POR TU COMPRA", bold: true, align: "center" },
    { type: "cut" },
  ],
};

const HELP = `Burger Hause Print Agent ${VERSION}

Uso: print-agent [comando]

Comandos:
  run          (por defecto) conecta con el servidor e imprime los trabajos
  test-print   imprime un ticket de prueba (logo, acentos, negrita, tamaño 2, corte); no necesita servidor
  check        valida la configuración, lista las impresoras de Windows y prueba la conexión
  --help       muestra esta ayuda
  --version    muestra la versión

Configuración (variables de entorno o config.json junto al programa; el entorno gana):
  SERVER_URL        URL https del servidor            STATION_TOKEN   token de la estación (bhst_...)
  PAPER_WIDTH       58 | 80 (80)                      CODEPAGE        cp858 | cp437 | cp850 | wpc1252
  PRINTER_BACKEND   windows | tcp | file | console    PRINTER_NAME    nombre de la impresora (windows)
  PRINTER_HOST / PRINTER_PORT   impresora de red (9100)   OUTPUT_DIR   carpeta (file)
  DATA_DIR          estado y logs                     LOG_LEVEL       debug | info | warn | error
  ALLOW_INSECURE=1  permite http fuera de localhost (no recomendado)
`;

export type CliIo = {
  env: Record<string, string | undefined>;
  cwd: string;
  platform: NodeJS.Platform;
  exeDir: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

function resolveConfig(io: CliIo, opts: { serverOptional: boolean }): { config: AgentConfig } | { code: number } {
  const fromFile = readConfigFile([io.exeDir, io.cwd]);
  if (fromFile.error) {
    io.stderr(`Error de configuración\n  ${fromFile.error}\n`);
    return { code: 2 };
  }
  // `test-print` only talks to the printer: placeholders stand in for the server settings.
  const env = opts.serverOptional
    ? { SERVER_URL: "https://sin-servidor.invalid", STATION_TOKEN: "bhst_" + "0".repeat(43), ...stripEmpty(fromFile.file), ...stripEmpty(io.env) }
    : io.env;
  const r = loadConfig({ env: env as Record<string, string | undefined>, file: opts.serverOptional ? {} : fromFile.file, platform: io.platform, cwd: io.cwd });
  if (!r.ok) {
    io.stderr(`Configuración inválida:\n${r.errors.map((e) => `  - ${e}`).join("\n")}\n`);
    return { code: 2 };
  }
  return { config: r.config };
}

function stripEmpty(o: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
}

async function testPrint(io: CliIo): Promise<number> {
  const c = resolveConfig(io, { serverOptional: true });
  if ("code" in c) return c.code;
  const backend = createBackend(c.config);
  io.stdout(`Imprimiendo ticket de prueba en: ${backend.describe()} (${c.config.paperWidth} mm, ${c.config.codepage})\n`);
  try {
    await backend.print(toEscPos(SAMPLE_TICKET, { paperWidth: c.config.paperWidth, codepage: c.config.codepage }), { jobId: 0 });
  } catch (err) {
    io.stderr(`No se pudo imprimir: ${err instanceof Error ? err.message : "error desconocido"}\n`);
    return 1;
  }
  io.stdout("Ticket de prueba enviado. Revisá el papel: logo arriba, acentos (áéíóú ñ ¿ ¡), negrita, tamaño doble, la frase final y el corte.\n");
  return 0;
}

async function check(io: CliIo): Promise<number> {
  const c = resolveConfig(io, { serverOptional: false });
  if ("code" in c) return c.code;
  const { config } = c;
  io.stdout(`Configuración válida:\n${describeConfig(config).replace(/^/gm, "  ")}\n`);
  let ok = true;

  if (config.printerBackend === "windows") {
    try {
      const printers = await listPrinters();
      io.stdout(`Impresoras instaladas en Windows (${printers.length}):\n${printers.map((p) => `  - «${p.name}»  [driver: ${p.driver}, puerto: ${p.port}]`).join("\n") || "  (ninguna)"}\n`);
      if (!printers.some((p) => p.name === config.printerName)) {
        io.stderr(`ATENCIÓN: PRINTER_NAME «${config.printerName}» no coincide con ninguna impresora instalada.\n`);
        ok = false;
      }
    } catch (err) {
      io.stderr(`No se pudo listar las impresoras: ${err instanceof Error ? err.message : "error"}\n`);
      ok = false;
    }
  }

  const before = Date.now();
  const hb = await new AgentApi({ serverUrl: config.serverUrl, token: config.stationToken, timeoutMs: 8000 }).heartbeat();
  if (hb.ok) {
    const skew = hb.serverTime ? Math.round((Date.parse(hb.serverTime) - before) / 1000) : 0;
    io.stdout(`Servidor: OK (${config.serverUrl}), la estación quedó marcada como activa. Diferencia de reloj con el servidor: ${skew} s\n`);
  } else {
    ok = false;
    const why: Record<string, string> = {
      unauthorized: TOKEN_ERROR_MESSAGE,
      ratelimited: "El servidor limitó los intentos (429); esperá unos minutos y probá de nuevo",
      network: `No se pudo conectar con el servidor (${config.serverUrl}); revisá la URL y la conexión a internet`,
      server: "El servidor respondió con un error; probá de nuevo en unos minutos",
    };
    io.stderr(`${why[hb.reason]}\n`);
  }
  return ok ? 0 : 1;
}

async function runAgent(io: CliIo): Promise<number> {
  const c = resolveConfig(io, { serverOptional: false });
  if ("code" in c) return c.code;
  const agent = startAgent(c.config);
  return new Promise<number>((resolve) => {
    let signalled = false;
    const shutdown = (signal: string) => {
      if (signalled) {
        io.stderr("Segunda señal: se fuerza la salida\n");
        process.exit(1);
      }
      signalled = true;
      io.stdout(`${signal} recibido: terminando el trabajo en curso y guardando el estado...\n`);
      void agent.stop().then(() => resolve(0));
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGBREAK", () => shutdown("SIGBREAK"));
    process.on("unhandledRejection", (reason) => io.stderr(`Promesa rechazada sin manejar: ${reason instanceof Error ? reason.message : String(reason)}\n`));
    process.on("uncaughtException", (err) => {
      io.stderr(`Error fatal: ${err.message}\n`);
      process.exit(1); // the service manager restarts us; the persisted state keeps us idempotent
    });
  });
}

export async function main(args: string[], io: CliIo): Promise<number> {
  const cmd = args[0] ?? "run";
  switch (cmd) {
    case "--help":
    case "-h":
    case "help":
      io.stdout(HELP);
      return 0;
    case "--version":
    case "-v":
      io.stdout(`${VERSION}\n`);
      return 0;
    case "run":
      return runAgent(io);
    case "test-print":
      return testPrint(io);
    case "check":
      return check(io);
    default:
      io.stderr(`Comando desconocido «${cmd.slice(0, 30)}». Probá con --help\n`);
      return 2;
  }
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  const io: CliIo = {
    env: process.env,
    cwd: process.cwd(),
    platform: process.platform,
    exeDir: path.dirname(process.argv[1] ?? process.cwd()),
    stdout: (s) => void process.stdout.write(s),
    stderr: (s) => void process.stderr.write(s),
  };
  main(process.argv.slice(2), io).then(
    (code) => {
      // No process.exit() here: on Windows with Node 24 exiting while the HTTP client still closes its sockets
      // aborts with "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" and a bad exit code even though the
      // command succeeded. Let the event loop drain; the unref'd timer only forces the exit if something lingers.
      process.exitCode = code;
      setTimeout(() => process.exit(code), 10_000).unref();
    },
    (err) => {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
