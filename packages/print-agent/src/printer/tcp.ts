import net from "node:net";
import { PrintError, type PrinterBackend, type PrintContext } from "./types";

/** Raw socket printing (JetDirect-style, port 9100) for network printers. */
export class TcpBackend implements PrinterBackend {
  private readonly timeoutMs: number;

  constructor(
    private readonly host: string,
    private readonly port: number,
    opts: { timeoutMs?: number } = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  print(bytes: Buffer, ctx?: PrintContext): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err?: PrintError) => {
        if (settled) return;
        settled = true;
        sock.destroy();
        if (err) reject(err);
        else resolve();
      };
      const where = `${this.host}:${this.port}`;
      const sock = net.connect({ host: this.host, port: this.port });
      sock.setTimeout(this.timeoutMs, () => done(new PrintError(`La impresora no responde (${where})`)));
      sock.on("error", () => done(new PrintError(`No se pudo conectar con la impresora (${where})`)));
      sock.on("connect", () => sock.end(bytes));
      sock.on("close", () => done());
    });
  }

  describe(): string {
    return `Red → ${this.host}:${this.port}`;
  }
}
