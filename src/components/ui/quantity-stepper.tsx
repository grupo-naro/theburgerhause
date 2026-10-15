import { MinusIcon, PlusIcon } from "@/components/menu/icons";

type Props = {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  /** What is being counted, for the accessible names ("Cantidad de Ranchita simple"). */
  label: string;
  /** Accessible name of the decrement button when it behaves differently at `min` (e.g. removes). */
  decrementLabel?: string;
  testId?: string;
};

const btn =
  "grid size-11 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink transition-colors hover:bg-brand-50 active:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface";

/** `− n +` with 44px targets. The number is a live value, announced politely. */
export function QuantityStepper({ value, onChange, min = 1, max = 10, label, decrementLabel, testId }: Props) {
  return (
    <div role="group" aria-label={label} data-testid={testId} className="inline-flex items-center gap-1">
      <button
        type="button"
        className={btn}
        aria-label={decrementLabel ?? "Disminuir cantidad"}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <MinusIcon className="size-5" />
      </button>
      <span
        aria-live="polite"
        data-testid={testId ? `${testId}-value` : undefined}
        className="min-w-9 text-center font-display text-xl font-extrabold tabular-nums"
      >
        {value}
      </span>
      <button
        type="button"
        className={btn}
        aria-label="Aumentar cantidad"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <PlusIcon className="size-5" />
      </button>
    </div>
  );
}
