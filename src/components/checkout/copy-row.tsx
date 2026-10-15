"use client";

import { useRef } from "react";
import { useToast } from "@/components/ui/toast";

/** Selects the node's text so the customer can copy it by hand (fallback when the Clipboard API is not available). */
function selectText(node: HTMLElement | null): boolean {
  if (!node) return false;
  try {
    const selection = window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    return false;
  }
}

/** "Alias: burger.828 [Copiar]". Clipboard API first, then select-the-text with a hint. */
export function CopyRow({
  label,
  value,
  testId,
  copied,
  onCopied,
}: {
  label: string;
  value: string;
  testId: string;
  /** Shown as "¡Copiado!" while true (state lives in the parent: only the last copied row confirms). */
  copied: boolean;
  onCopied: () => void;
}) {
  const valueRef = useRef<HTMLElement>(null);
  const toast = useToast();

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      onCopied();
      toast.show({ message: `${label} copiado` });
      return;
    } catch {
      // permission denied / insecure context / old browser: fall through
    }
    const selected = selectText(valueRef.current);
    let done = false;
    try {
      done = selected && document.execCommand("copy");
    } catch {
      done = false;
    }
    if (done) {
      onCopied();
      toast.show({ message: `${label} copiado` });
    } else {
      toast.show({ message: `Dejamos el ${label.toLowerCase()} seleccionado: copialo desde tu teclado` });
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
        <code
          ref={valueRef}
          data-testid={testId}
          className="block select-all break-all font-mono text-[0.78rem] font-semibold tracking-tight sm:text-base text-ink"
        >
          {value}
        </code>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? `${label} copiado` : `Copiar ${label.toLowerCase()}`}
        data-testid={`${testId}-copy`}
        className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-brand-600 px-4 font-display text-sm font-bold text-brand-600 transition-colors hover:bg-brand-50"
      >
        {copied ? "¡Copiado!" : "Copiar"}
      </button>
    </div>
  );
}
