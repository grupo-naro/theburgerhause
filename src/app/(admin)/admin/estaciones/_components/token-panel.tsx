"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * One-time display of a plain station token. It only lives in the action state
 * (React memory): never in a URL, cookie or storage, and it is gone on reload.
 */
export function TokenPanel({ token, title }: { token: string; title: string }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
  }

  return (
    <div role="status" className="flex flex-col gap-2 rounded-xl border border-cheddar-400 bg-cheddar-400/20 p-4">
      <p className="font-display text-base font-bold">{title}</p>
      <p className="text-sm font-semibold text-state-error">Guardalo ahora: no se vuelve a mostrar.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          aria-label="Token de la estación"
          value={token}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 font-mono text-xs break-all"
        />
        <Button type="button" variant="secondary" onClick={copy}>
          Copiar token
        </Button>
      </div>
      {copied === "yes" ? <p className="text-sm text-green-800">Copiado al portapapeles.</p> : null}
      {copied === "no" ? (
        <p className="text-sm text-ink-muted">No se pudo copiar automáticamente: seleccioná el texto y copialo a mano.</p>
      ) : null}
      <p className="text-xs text-ink-muted">Pegalo en la configuración del Print Agent de esta estación.</p>
    </div>
  );
}
