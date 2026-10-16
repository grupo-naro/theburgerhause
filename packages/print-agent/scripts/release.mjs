// Builds the installable release: build (tsc check) + bundle + release/burgerhause-print-agent-<version>/ + .zip + .sha256.
// No external zip tool: the archive is written here (deflate, forward slashes, fixed timestamp so it is reproducible).
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const name = `burgerhause-print-agent-${pkg.version}`;
const releaseDir = path.join(root, "release");
const folder = path.join(releaseDir, name);

function run(script) {
  const r = spawnSync("pnpm", ["run", script], { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error(`Falló "pnpm run ${script}"`);
    process.exit(r.status ?? 1);
  }
}

const leeme = `BURGER HAUSE PRINT AGENT ${pkg.version}

1. Abrir PowerShell COMO ADMINISTRADOR y entrar a esta carpeta (cd "<ruta de esta carpeta>").
2. Correr:  .\\install.ps1 -ServerUrl https://TU-SERVIDOR -PrinterName "NOMBRE DE LA IMPRESORA"   (pide el token en pantalla)
3. Guia completa paso a paso, solucion de problemas y lista de las 9 PCs: GUIA-INSTALACION.md (en esta carpeta)

Otros programas de esta carpeta: status.ps1 (ver el estado), update.ps1 (actualizar), uninstall.ps1 (desinstalar).
`;

run("build");
run("bundle");

fs.rmSync(folder, { recursive: true, force: true });
fs.rmSync(path.join(releaseDir, `${name}.zip`), { force: true });
fs.rmSync(path.join(releaseDir, `${name}.zip.sha256`), { force: true });
fs.mkdirSync(folder, { recursive: true });

const files = [
  ["dist/print-agent.cjs", "print-agent.cjs"],
  ["install/install.ps1", "install.ps1"],
  ["install/uninstall.ps1", "uninstall.ps1"],
  ["install/status.ps1", "status.ps1"],
  ["install/update.ps1", "update.ps1"],
  ["install/common.ps1", "common.ps1"],
  ["install/config.example.json", "config.example.json"],
  ["../../docs/ops/print-agent-install.md", "GUIA-INSTALACION.md"],
];
for (const [from, to] of files) fs.copyFileSync(path.join(root, from), path.join(folder, to));
// UTF-8 with BOM so Windows Notepad shows the accents.
fs.writeFileSync(path.join(folder, "LEEME.txt"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(leeme.replace(/\n/g, "\r\n"), "utf8")]));

// ---- zip writer ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01

const names = fs.readdirSync(folder).sort();
const locals = [];
const centrals = [];
let offset = 0;
for (const f of names) {
  const data = fs.readFileSync(path.join(folder, f));
  const entryName = Buffer.from(`${name}/${f}`, "utf8");
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0x0800, 6); // UTF-8 names
  lh.writeUInt16LE(8, 8);
  lh.writeUInt16LE(DOS_TIME, 10);
  lh.writeUInt16LE(DOS_DATE, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(entryName.length, 26);
  const local = Buffer.concat([lh, entryName, comp]);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(8, 10);
  ch.writeUInt16LE(DOS_TIME, 12);
  ch.writeUInt16LE(DOS_DATE, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(entryName.length, 28);
  ch.writeUInt32LE(offset, 42);
  centrals.push(Buffer.concat([ch, entryName]));
  locals.push(local);
  offset += local.length;
}
const centralBuf = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(names.length, 8);
end.writeUInt16LE(names.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...locals, centralBuf, end]);
const zipPath = path.join(releaseDir, `${name}.zip`);
fs.writeFileSync(zipPath, zip);
const digest = crypto.createHash("sha256").update(zip).digest("hex");
fs.writeFileSync(`${zipPath}.sha256`, `${digest}  ${name}.zip\n`);

console.log(`Release lista: ${path.relative(process.cwd(), folder)}`);
console.log(`  ZIP:    ${path.relative(process.cwd(), zipPath)} (${zip.length} bytes)`);
console.log(`  SHA256: ${digest}`);
console.log(`  Archivos: ${names.join(", ")}`);
