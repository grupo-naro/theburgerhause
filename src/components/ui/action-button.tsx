"use client";

import { useActionState, type ReactNode } from "react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./button";

type State = { error?: string };

/**
 * A single-button form bound to a Server Action `(prev, formData) => state`.
 * Hidden inputs carry the (untrusted) ids; the action re-validates them.
 */
export function ActionButton({
  action,
  fields,
  children,
  label,
  variant = "secondary",
  size = "sm",
  disabled = false,
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
  fields: Record<string, string | number>;
  children: ReactNode;
  /** Accessible name when the visible content is an icon/short text. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {} as State);
  return (
    <form action={formAction} className="inline-flex flex-col">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button
        type="submit"
        aria-label={label}
        title={state.error ?? label}
        disabled={pending || disabled}
        className={buttonClass(variant, size)}
      >
        {children}
      </button>
      {state.error ? (
        <span role="alert" className="text-xs text-state-error">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
