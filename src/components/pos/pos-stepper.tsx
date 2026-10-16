import { MinusIcon, PlusIcon } from "@/components/menu/icons";

type Props = {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  label: string;
  testId?: string;
};

const btn =
  "grid size-12 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink transition-colors hover:bg-brand-50 active:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface";

/** `- n +` with 48px targets (POS flavor of the storefront stepper). */
export function PosStepper({ value, onChange, min = 1, max = 10, label, testId }: Props) {
  return (
    <div role="group" aria-label={label} data-testid={testId} className="inline-flex items-center">
      <button type="button" className={btn} aria-label={`Menos ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        <MinusIcon className="size-5" />
      </button>
      <span
        aria-live="polite"
        data-testid={testId ? `${testId}-value` : undefined}
        className="min-w-10 text-center font-display text-xl font-extrabold tabular-nums"
      >
        {value}
      </span>
      <button type="button" className={btn} aria-label={`Más ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <PlusIcon className="size-5" />
      </button>
    </div>
  );
}
