"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initial: LoginState = { error: null };

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, initial);
  const field =
    "w-full rounded-xl border border-line bg-surface px-4 py-3 text-ink outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-300";
  return (
    <form action={action} className="flex w-full flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Usuario
        <input name="username" type="text" autoComplete="username" required maxLength={64} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Contraseña
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          className={field}
        />
      </label>
      <p role="alert" aria-live="polite" className="min-h-5 text-sm font-medium text-state-error">
        {state.error}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-brand-600 px-6 py-3 font-display text-lg font-bold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
