export type PrintContext = { jobId: number };

export interface PrinterBackend {
  /** Sends the bytes to the printer. Resolves once the OS/printer accepted them; rejects with a PrintError. */
  print(bytes: Buffer, ctx: PrintContext): Promise<void>;
  describe(): string;
}

/** An error whose message is already short, Spanish and safe to send to the server (no stack, no paths). */
export class PrintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintError";
  }
}
