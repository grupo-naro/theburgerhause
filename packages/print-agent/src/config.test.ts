import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeConfig, loadConfig, maskToken, type ConfigResult } from "./config";

const TOKEN = "bhst_" + "A".repeat(43);
const base = { SERVER_URL: "https://pedidos.example.com", STATION_TOKEN: TOKEN, PRINTER_BACKEND: "file" };

function load(env: Record<string, string | undefined>, file: Record<string, unknown> = {}, platform: NodeJS.Platform = "linux"): ConfigResult {
  return loadConfig({ env, file, platform, cwd: "/work" });
}
function ok(r: ConfigResult) {
  if (!r.ok) throw new Error("expected ok, got: " + r.errors.join(" | "));
  return r.config;
}
function errors(r: ConfigResult): string[] {
  if (r.ok) throw new Error("expected errors");
  return r.errors;
}

describe("loadConfig: defaults and sources", () => {
  it("applies the defaults", () => {
    const c = ok(load(base));
    expect(c).toMatchObject({
      serverUrl: "https://pedidos.example.com",
      stationToken: TOKEN,
      paperWidth: 80,
      codepage: "cp858",
      printerBackend: "file",
      printerPort: 9100,
      logLevel: "info",
    });
    expect(c.dataDir).toBe(path.resolve("/work", "data"));
    expect(c.outputDir).toBe(path.join(c.dataDir, "output"));
  });

  it("defaults DATA_DIR to %PROGRAMDATA%\\BurgerHouseAgent on Windows", () => {
    const c = ok(load({ ...base, PROGRAMDATA: "C:\\ProgramData" }, {}, "win32"));
    expect(c.dataDir).toBe(path.win32.join("C:\\ProgramData", "BurgerHouseAgent"));
  });

  it("defaults the backend to windows on Windows and console elsewhere", () => {
    const env = { SERVER_URL: base.SERVER_URL, STATION_TOKEN: TOKEN };
    expect(errors(load(env, {}, "win32")).join(" ")).toContain("PRINTER_NAME");
    expect(ok(load(env, {}, "linux")).printerBackend).toBe("console");
  });

  it("reads config.json values and lets the environment win", () => {
    const file = { SERVER_URL: "https://from-file.example.com/", STATION_TOKEN: TOKEN, PRINTER_BACKEND: "console", PAPER_WIDTH: 58, CODEPAGE: "cp437", LOG_LEVEL: "debug" };
    const c = ok(load({}, file));
    expect(c).toMatchObject({ serverUrl: "https://from-file.example.com", paperWidth: 58, codepage: "cp437", logLevel: "debug", printerBackend: "console" });
    const c2 = ok(load({ SERVER_URL: "https://env.example.com", PAPER_WIDTH: "80", LOG_LEVEL: "" }, file));
    expect(c2.serverUrl).toBe("https://env.example.com");
    expect(c2.paperWidth).toBe(80);
    expect(c2.logLevel).toBe("debug"); // an empty env var does not override
  });

  it("is case-insensitive for enums and trims values", () => {
    const c = ok(load({ ...base, CODEPAGE: " CP850 ", PRINTER_BACKEND: "FILE", STATION_TOKEN: ` ${TOKEN} ` }));
    expect(c).toMatchObject({ codepage: "cp850", printerBackend: "file", stationToken: TOKEN });
  });

  it("windows and tcp backends", () => {
    expect(ok(load({ ...base, PRINTER_BACKEND: "windows", PRINTER_NAME: "POS-80 (Copy 1)" }))).toMatchObject({ printerBackend: "windows", printerName: "POS-80 (Copy 1)" });
    expect(ok(load({ ...base, PRINTER_BACKEND: "tcp", PRINTER_HOST: "192.168.1.50" }))).toMatchObject({ printerHost: "192.168.1.50", printerPort: 9100 });
    expect(ok(load({ ...base, PRINTER_BACKEND: "tcp", PRINTER_HOST: "192.168.1.50", PRINTER_PORT: "9101" })).printerPort).toBe(9101);
  });
});

describe("loadConfig: validation errors (Spanish, naming the key)", () => {
  it("reports every problem at once", () => {
    const e = errors(load({ SERVER_URL: "nope", STATION_TOKEN: "x", PAPER_WIDTH: "70", CODEPAGE: "latin9", PRINTER_BACKEND: "usb" }));
    expect(e).toHaveLength(5);
    for (const key of ["SERVER_URL", "STATION_TOKEN", "PAPER_WIDTH", "CODEPAGE", "PRINTER_BACKEND"]) expect(e.some((m) => m.startsWith(key))).toBe(true);
  });

  it("requires SERVER_URL and STATION_TOKEN", () => {
    const e = errors(load({ PRINTER_BACKEND: "console" }));
    expect(e).toEqual([expect.stringContaining("SERVER_URL"), expect.stringContaining("STATION_TOKEN")]);
    expect(e[0]).toMatch(/falta|requerid/i);
  });

  it("rejects http for non-localhost unless ALLOW_INSECURE=1", () => {
    const e = errors(load({ ...base, SERVER_URL: "http://pedidos.example.com" }));
    expect(e[0]).toContain("SERVER_URL");
    expect(e[0]).toContain("ALLOW_INSECURE");
    expect(ok(load({ ...base, SERVER_URL: "http://pedidos.example.com", ALLOW_INSECURE: "1" })).serverUrl).toBe("http://pedidos.example.com");
    for (const host of ["localhost:3100", "127.0.0.1:3100", "[::1]:3100"]) expect(ok(load({ ...base, SERVER_URL: `http://${host}` })).serverUrl).toBe(`http://${host}`);
  });

  it("rejects other protocols, credentials in the URL and garbage", () => {
    for (const url of ["ftp://x.com", "file:///etc/passwd", "https://user:pw@x.com", "x.com", "https://"]) {
      expect(errors(load({ ...base, SERVER_URL: url }))[0]).toContain("SERVER_URL");
    }
  });

  it("validates the token shape and never echoes it", () => {
    for (const t of ["", "bhst_short", "xxxx_" + "A".repeat(43), "bhst_" + "A".repeat(44), "bhst_" + "!".repeat(43)]) {
      const e = errors(load({ ...base, STATION_TOKEN: t }));
      expect(e[0]).toContain("STATION_TOKEN");
      if (t.length > 8) expect(e.join()).not.toContain(t);
    }
  });

  it("validates width, codepage, backend and log level", () => {
    expect(errors(load({ ...base, PAPER_WIDTH: "80mm" }))[0]).toContain("PAPER_WIDTH");
    expect(errors(load({ ...base, CODEPAGE: "utf8" }))[0]).toContain("CODEPAGE");
    expect(errors(load({ ...base, PRINTER_BACKEND: "bluetooth" }))[0]).toContain("PRINTER_BACKEND");
    expect(errors(load({ ...base, LOG_LEVEL: "verbose" }))[0]).toContain("LOG_LEVEL");
  });

  it("windows needs PRINTER_NAME, and a safe one", () => {
    expect(errors(load({ ...base, PRINTER_BACKEND: "windows" }))[0]).toContain("PRINTER_NAME");
    for (const name of ["a;b", "x`y", "$(calc)", "a|b", "x'y", 'x"y', "a".repeat(101), "a\nb", "a<b"]) {
      expect(errors(load({ ...base, PRINTER_BACKEND: "windows", PRINTER_NAME: name }))[0]).toContain("PRINTER_NAME");
    }
  });

  it("tcp needs PRINTER_HOST and a valid port", () => {
    expect(errors(load({ ...base, PRINTER_BACKEND: "tcp" }))[0]).toContain("PRINTER_HOST");
    expect(errors(load({ ...base, PRINTER_BACKEND: "tcp", PRINTER_HOST: "h", PRINTER_PORT: "0" }))[0]).toContain("PRINTER_PORT");
    expect(errors(load({ ...base, PRINTER_BACKEND: "tcp", PRINTER_HOST: "h", PRINTER_PORT: "70000" }))[0]).toContain("PRINTER_PORT");
    expect(errors(load({ ...base, PRINTER_BACKEND: "tcp", PRINTER_HOST: "bad host;" }))[0]).toContain("PRINTER_HOST");
  });

  it("explicit OUTPUT_DIR and DATA_DIR are resolved", () => {
    const c = ok(load({ ...base, OUTPUT_DIR: "out", DATA_DIR: "/var/agent" }));
    expect(c.outputDir).toBe(path.resolve("/work", "out"));
    expect(c.dataDir).toBe(path.resolve("/work", "/var/agent"));
  });
});

describe("secret masking", () => {
  it("maskToken keeps only a recognisable prefix", () => {
    expect(maskToken(TOKEN)).toBe("bhst_AAAA…");
    expect(maskToken("")).toBe("");
    expect(maskToken("abc")).toBe("***");
  });

  it("describeConfig never contains the token", () => {
    const c = ok(load({ ...base, PRINTER_BACKEND: "windows", PRINTER_NAME: "POS" }));
    const text = describeConfig(c);
    expect(text).not.toContain(TOKEN);
    expect(text).toContain("bhst_AAAA…");
    expect(text).toContain("POS");
  });
});
