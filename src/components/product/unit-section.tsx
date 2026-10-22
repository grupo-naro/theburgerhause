"use client";

import { ChevronDownIcon } from "@/components/menu/icons";
import type { PublicModifier, PublicProduct } from "@/lib/menu/public";
import type { SheetUnit } from "@/lib/cart/sheet-state";
import { UnitFields } from "./unit-fields";

type Props = {
  product: PublicProduct;
  unit: SheetUnit;
  /** 0-based; the title shows `#index+1`. */
  index: number;
  summary: string[];
  open: boolean;
  idPrefix: string;
  canCopy: boolean;
  onOpen: () => void;
  onToggle: (modifier: PublicModifier) => void;
  onNote: (note: string) => void;
  onCopyFirst: () => void;
};

/**
 * Accordion section of one unit ("Ranchita simple #2"): the header shows a live one-line summary of
 * that unit's choices; units after the first get the "Igual que la 1" shortcut.
 */
export function UnitSection({
  product,
  unit,
  index,
  summary,
  open,
  idPrefix,
  canCopy,
  onOpen,
  onToggle,
  onNote,
  onCopyFirst,
}: Props) {
  const panelId = `${idPrefix}-panel`;
  return (
    <section
      data-testid="unit-section"
      className={`overflow-hidden rounded-2xl border bg-surface transition-colors ${open ? "border-brand-600/40 shadow-sm" : "border-line"}`}
    >
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onOpen}
          className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-display text-base font-bold leading-tight text-ink [overflow-wrap:anywhere]">
              {product.name} #{index + 1}
            </span>
            <span data-testid="unit-summary" className="mt-0.5 line-clamp-2 block text-sm leading-snug text-ink-muted">
              {summary.length > 0 ? summary.join(" · ") : "Sin modificaciones"}
            </span>
          </span>
          <ChevronDownIcon className={`size-5 shrink-0 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </h3>
      <div id={panelId} hidden={!open} className="border-t border-line px-4 pb-4 pt-4">
        {index > 0 && (
          <button
            type="button"
            onClick={onCopyFirst}
            disabled={!canCopy}
            className="mb-5 inline-flex min-h-12 w-full items-center justify-center rounded-full border-2 border-brand-600 bg-brand-50 px-4 font-display text-base font-bold text-brand-600 transition-colors hover:bg-brand-600 hover:text-white disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-ink-muted disabled:hover:bg-transparent disabled:hover:text-ink-muted"
          >
            Igual que la 1
          </button>
        )}
        <UnitFields
          product={product}
          selectedIds={unit.modifierIds}
          note={unit.note}
          idPrefix={idPrefix}
          onToggle={onToggle}
          onNote={onNote}
        />
      </div>
    </section>
  );
}
