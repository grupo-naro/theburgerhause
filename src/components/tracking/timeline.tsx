import { CheckIcon } from "@/components/menu/icons";
import type { TrackingStep } from "@/lib/orders/tracking-steps";

const STATE_TEXT = { done: "Completado", current: "En curso", upcoming: "Pendiente" } as const;

/** Vertical timeline: done = check, current = pulsing dot (motion-safe), upcoming = muted. */
export function Timeline({ steps }: { steps: TrackingStep[] }) {
  return (
    <ol aria-label="Estado del pedido" data-testid="timeline">
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <li
            key={step.key}
            data-testid="timeline-step"
            data-state={step.state}
            aria-current={step.state === "current" ? "step" : undefined}
            className="relative flex gap-4 pb-6 last:pb-0"
          >
            {!last && (
              <span
                aria-hidden="true"
                className={`absolute bottom-0 left-[0.9375rem] top-8 w-0.5 ${step.state === "done" ? "bg-brand-600" : "bg-line"}`}
              />
            )}
            <span className="relative grid size-8 shrink-0 place-items-center">
              {step.state === "done" && (
                <span className="grid size-8 place-items-center rounded-full bg-brand-600 text-white">
                  <CheckIcon className="size-4" strokeWidth={3.5} />
                </span>
              )}
              {step.state === "current" && (
                <>
                  <span aria-hidden="true" className="absolute size-8 rounded-full bg-cheddar-400/50 motion-safe:animate-ping" />
                  <span
                    aria-hidden="true"
                    className="relative size-5 rounded-full border-4 border-white bg-cheddar-400 shadow ring-2 ring-cheddar-600"
                  />
                </>
              )}
              {step.state === "upcoming" && (
                <span aria-hidden="true" className="size-4 rounded-full border-2 border-line bg-surface" />
              )}
            </span>
            <div className="min-w-0 pt-1">
              <p
                className={`font-display text-lg font-bold leading-tight ${
                  step.state === "upcoming" ? "text-ink-muted" : "text-ink"
                }`}
              >
                {step.label}
              </p>
              <p className="sr-only">{STATE_TEXT[step.state]}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
