"use client";

import { InfoIcon } from "@/components/menu/icons";
import { issueMessages } from "@/lib/cart/display";
import type { MenuIndex } from "@/lib/cart/pricing";
import type { CartIssue } from "@/lib/cart/types";

/** "Lo que cambió en tu pedido": reconciliation results (unavailable products / options, new prices). */
export function IssuesBanner({
  issues,
  index,
  onDismiss,
}: {
  issues: readonly CartIssue[];
  index: MenuIndex;
  onDismiss: () => void;
}) {
  if (issues.length === 0) return null;
  const messages = issueMessages(issues, index);
  return (
    <section
      role="status"
      data-testid="issues-banner"
      className="mb-5 rounded-2xl border border-cheddar-600/40 bg-cheddar-400/20 p-4"
    >
      <div className="flex items-start gap-3">
        <InfoIcon className="mt-0.5 size-5 shrink-0 text-ink" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-bold text-ink">Actualizamos tu pedido</h2>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-sm leading-snug text-ink">
            {messages.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-3 inline-flex min-h-11 items-center rounded-full border border-ink/30 bg-surface px-5 text-sm font-bold text-ink transition-colors hover:bg-brand-50"
      >
        Entendido
      </button>
    </section>
  );
}
