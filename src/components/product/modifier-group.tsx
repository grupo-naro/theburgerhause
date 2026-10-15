import { CheckIcon } from "@/components/menu/icons";
import type { PublicModifier, PublicModifierGroup } from "@/lib/menu/public";
import { modifierDisplay } from "@/lib/cart/sheet-state";

type Props = {
  group: PublicModifierGroup;
  selectedIds: readonly number[];
  onToggle: (modifier: PublicModifier) => void;
  /** Unique per unit + group (ids of the heading). */
  idPrefix: string;
};

/**
 * One modifier group for one unit. Every option is a real checkbox (keyboard + screen readers for
 * free) drawn as a large row; `swap` groups are mutually exclusive, which the state enforces and the
 * round marker hints at ("Elegí una").
 */
export function ModifierGroup({ group, selectedIds, onToggle, idPrefix }: Props) {
  const headingId = `${idPrefix}-h`;
  const exclusive = group.modifiers.every((m) => m.kind === "swap");
  return (
    <div role="group" aria-labelledby={headingId} data-testid="modifier-group" className="mt-5 first:mt-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h4 id={headingId} className="font-display text-base font-bold text-ink">
          {group.name}
        </h4>
        {exclusive && <span className="text-xs text-ink-muted">Elegí una</span>}
      </div>
      <ul className="flex flex-col gap-2">
        {group.modifiers.map((modifier) => {
          const checked = selectedIds.includes(modifier.id);
          const { label, priceLabel, kind } = modifierDisplay(modifier);
          return (
            <li key={modifier.id}>
              <label
                data-testid="modifier-row"
                className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand-600 ${
                  checked ? "border-brand-600 bg-brand-50" : "border-line bg-surface hover:bg-brand-50/60"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  aria-checked={checked}
                  onChange={() => onToggle(modifier)}
                  onKeyDown={(e) => {
                    // Space toggles natively; Enter does too, for keyboard users used to forms.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onToggle(modifier);
                    }
                  }}
                />
                <span
                  aria-hidden="true"
                  className={`grid size-6 shrink-0 place-items-center border-2 transition-colors ${
                    kind === "swap" ? "rounded-full" : "rounded-md"
                  } ${checked ? "border-brand-600 bg-brand-600 text-white" : "border-ink-muted bg-surface text-transparent"}`}
                >
                  <CheckIcon className="size-4" strokeWidth={3} />
                </span>
                <span className="min-w-0 flex-1 text-base leading-snug text-ink">{label}</span>
                {priceLabel && (
                  <span className="shrink-0 font-display text-base font-bold tabular-nums text-brand-600">
                    {priceLabel}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
