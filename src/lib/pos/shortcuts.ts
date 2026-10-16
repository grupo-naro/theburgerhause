export type KeyInfo = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat?: boolean;
  /** True when the event target is a text field / select / contenteditable. */
  typing: boolean;
};

export type Shortcut = "search" | "charge" | "clear";

/**
 * Keyboard shortcuts of the POS: `/` focuses the search, Ctrl/Cmd+Enter charges, Alt+L clears the
 * ticket. `/` and Alt+L never fire while typing in a field; Ctrl+Enter does (the cashier is often
 * in the "Recibido" or name box). Esc is handled natively by the dialogs.
 */
export function shortcutFor(e: KeyInfo): Shortcut | null {
  if (e.repeat) return null;
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) return "charge";
  if (e.typing) return null;
  if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) return "search";
  if ((e.key === "l" || e.key === "L") && e.altKey && !e.ctrlKey && !e.metaKey) return "clear";
  return null;
}
