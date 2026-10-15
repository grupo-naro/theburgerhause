import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const control =
  "w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-ink outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-300 aria-[invalid=true]:border-state-error";

/** Label + control + hint + inline error, wired with aria-describedby. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-sm font-medium text-state-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string | undefined, error?: string, hint?: boolean) {
  if (!id) return undefined;
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

type Common = { error?: string; hasHint?: boolean };

export function Input({
  error,
  hasHint,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & Common) {
  return (
    <input
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(props.id, error, hasHint)}
      className={`${control} ${className}`}
      {...props}
    />
  );
}

export function Select({
  error,
  hasHint,
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & Common) {
  return (
    <select
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(props.id, error, hasHint)}
      className={`${control} ${className}`}
      {...props}
    />
  );
}

export function Textarea({
  error,
  hasHint,
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & Common) {
  return (
    <textarea
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(props.id, error, hasHint)}
      className={`${control} ${className}`}
      {...props}
    />
  );
}
