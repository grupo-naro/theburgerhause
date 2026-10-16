import { MAX_SETTLEMENT_NOTE } from "@/lib/settlements/schemas";

/** `text: null` is "Otro": the manager writes the reason. */
export type QuickNote = { label: string; text: string | null };

export const QUICK_NOTES: readonly QuickNote[] = [
  { label: "Gastó en nafta", text: "Gastó en nafta" },
  { label: "Cliente no pagó", text: "Cliente no pagó" },
  { label: "Vuelto de más", text: "Vuelto de más" },
  { label: "Pérdida/robo", text: "Pérdida/robo" },
  { label: "Otro", text: null },
];

const CHIP_TEXTS = new Set(QUICK_NOTES.flatMap((q) => (q.text ? [q.text] : [])));

/** Applies a chip to the current note: replaces a previous chip text, appends to free text. */
export function applyQuickNote(current: string, chip: QuickNote): string {
  const note = current.trim();
  if (chip.text === null) return CHIP_TEXTS.has(note) ? "" : current;
  if (note === "" || CHIP_TEXTS.has(note)) return chip.text;
  if (note.endsWith(chip.text)) return current;
  return `${note}. ${chip.text}`.slice(0, MAX_SETTLEMENT_NOTE);
}
