import type { AgentConfig } from "../config";
import { ConsoleBackend } from "./console";
import { FileBackend } from "./file";
import { TcpBackend } from "./tcp";
import type { PrinterBackend } from "./types";
import { WindowsRawBackend } from "./windows-raw";

export type { PrinterBackend, PrintContext } from "./types";
export { PrintError } from "./types";

export function createBackend(config: AgentConfig): PrinterBackend {
  switch (config.printerBackend) {
    case "windows":
      return new WindowsRawBackend({ printerName: config.printerName ?? "", dataDir: config.dataDir });
    case "tcp":
      return new TcpBackend(config.printerHost ?? "", config.printerPort);
    case "file":
      return new FileBackend(config.outputDir);
    case "console":
      return new ConsoleBackend();
  }
}
