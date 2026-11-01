import Link from "next/link";

/**
 * "Rendición de materia prima" reminder of the admin shell, in the slot of the shortage strip: shown
 * to the managers while today's rendición is not closed (the text comes from closingReminderText).
 * Rendered on the server with the page, so it never pops in after load.
 */
export function ClosingReminder({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <section
      data-testid="closing-reminder"
      aria-label="Rendición de materia prima pendiente"
      className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl border border-cheddar-600/60 bg-cheddar-400/15 px-4 py-2"
    >
      <p className="min-w-0 flex-1 basis-60 text-sm font-semibold text-ink">{text}</p>
      <Link
        href="/admin/stock/rendicion"
        className="flex min-h-11 items-center font-display text-base font-bold whitespace-nowrap text-brand-600 underline underline-offset-4 hover:text-brand-700"
      >
        Cargar la rendición
      </Link>
    </section>
  );
}
