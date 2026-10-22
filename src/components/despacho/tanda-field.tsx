"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { setTandaAction } from "@/app/(staff)/despacho/actions";

type Props = { orderId: number; tanda: number | null; canEdit: boolean; /** Only for the accessible name. */ number?: number };

const GENERIC_ERROR = "No se pudo guardar la tanda. Probá de nuevo.";

/**
 * The tanda of a delivery order: a free number the manager writes by hand (blank clears it). It
 * saves on leaving the field or with Enter, and shows the server's error inside the card. Without
 * `canEdit` it is plain text. A change made elsewhere replaces the value unless it is being edited.
 */
export function TandaField({ orderId, tanda, canEdit, number }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<string | null>(null);
  const [seen, setSeen] = useState(tanda);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const saving = useRef(false);

  // The server value moved (live update): follow it, unless this field is being typed in.
  if (seen !== tanda) {
    setSeen(tanda);
    if (!editing) {
      setDraft(null);
      setError(null);
    }
  }

  const shown = draft ?? (tanda === null ? "" : String(tanda));
  const none = <span data-testid="tanda-none" className="text-base font-semibold text-ink-muted">Sin tanda</span>;

  if (!canEdit) {
    return (
      <p data-testid="tanda-readonly" className="mt-2 text-base font-bold text-ink">
        {tanda === null ? none : `Tanda ${tanda}`}
      </p>
    );
  }

  const current = tanda === null ? "" : String(tanda);
  const save = () => {
    setEditing(false);
    if (draft === null || saving.current) return;
    if (draft.trim() === current) {
      setDraft(null);
      return;
    }
    saving.current = true;
    const form = new FormData();
    form.set("orderId", String(orderId));
    form.set("tanda", draft.trim());
    setError(null);
    startTransition(async () => {
      try {
        const result = await setTandaAction(null, form);
        if (result.ok) router.refresh();
        else setError(result.message);
      } catch {
        setError(GENERIC_ERROR);
      } finally {
        saving.current = false;
      }
    });
  };

  return (
    <div data-testid="tanda-field" className="mt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-base font-bold text-ink">Tanda</span>
        <input
          data-testid="tanda-input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={3}
          value={shown}
          disabled={pending}
          aria-label={number === undefined ? "Tanda" : `Tanda del pedido #${number}`}
          aria-invalid={error !== null}
          onFocus={() => setEditing(true)}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className="h-12 w-20 rounded-xl border-2 border-line bg-white px-3 text-center font-display text-xl font-extrabold text-ink tabular-nums focus:border-brand-600 aria-invalid:border-state-error disabled:opacity-60"
        />
        {tanda === null && none}
      </div>
      {error && (
        <p role="alert" data-testid="tanda-error" className="mt-1.5 rounded-lg border border-state-error bg-red-50 px-3 py-1.5 text-sm font-medium text-state-error">
          {error}
        </p>
      )}
    </div>
  );
}
