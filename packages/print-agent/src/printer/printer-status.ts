/**
 * Windows printer states (PRINTER_INFO_2.Status / .Attributes) that mean "paper cannot come out now".
 * The Spooler happily ACCEPTS jobs for an unplugged or paper-out USB printer, so the PowerShell script
 * checks these bits before StartDocPrinter and refuses; this table is the single source for both the
 * masks handed to the script and the reasons shown to the operator.
 * Not blocking on purpose: POWER_SAVE (0x1000000), BUSY, PRINTING, IO_ACTIVE, PROCESSING, WARMING_UP,
 * TONER_LOW, PAUSED (jobs just queue) and anything unknown. A driver that reports 0 never blocks.
 */
export const STATUS_REASONS: { bit: number; name: string; reason: string }[] = [
  { bit: 0x80, name: "PRINTER_STATUS_OFFLINE", reason: "desconectada" },
  { bit: 0x1000, name: "PRINTER_STATUS_NOT_AVAILABLE", reason: "no disponible" },
  { bit: 0x10, name: "PRINTER_STATUS_PAPER_OUT", reason: "sin papel" },
  { bit: 0x8, name: "PRINTER_STATUS_PAPER_JAM", reason: "con papel atascado" },
  { bit: 0x40, name: "PRINTER_STATUS_PAPER_PROBLEM", reason: "con problema de papel" },
  { bit: 0x2, name: "PRINTER_STATUS_ERROR", reason: "con error" },
  { bit: 0x400000, name: "PRINTER_STATUS_DOOR_OPEN", reason: "con la tapa abierta" },
  { bit: 0x100000, name: "PRINTER_STATUS_USER_INTERVENTION", reason: "esperando intervención" },
];

/** PRINTER_ATTRIBUTE_WORK_OFFLINE: "Use Printer Offline" or the spooler marked it offline. */
export const ATTRIBUTE_WORK_OFFLINE = 0x400;

export const STATUS_BLOCK_MASK = STATUS_REASONS.reduce((m, r) => m | r.bit, 0);
export const ATTR_BLOCK_MASK = ATTRIBUTE_WORK_OFFLINE;

/** Human reasons for a (status, attributes) pair; empty = nothing blocks printing. */
export function describePrinterState(status: number, attributes: number): string[] {
  const reasons: string[] = [];
  const offline = (attributes & ATTRIBUTE_WORK_OFFLINE) !== 0 || (status & 0x80) !== 0;
  if (offline) reasons.push("desconectada");
  for (const r of STATUS_REASONS) if (r.bit !== 0x80 && (status & r.bit) !== 0) reasons.push(r.reason);
  return reasons;
}

export function stateMessage(status: number, attributes: number): string {
  const reasons = describePrinterState(status, attributes);
  return reasons.length ? `La impresora no está lista: ${reasons.join(", ")}` : "La impresora no está lista";
}
