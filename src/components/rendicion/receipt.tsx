import type { Receipt } from "@/lib/rendicion/receipt";

function Row({ label, value, strong, danger, testId }: { label: string; value: string; strong?: boolean; danger?: boolean; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-line py-2 print:border-black/40">
      <dt className="text-base text-ink-muted print:text-black">{label}</dt>
      <dd data-testid={testId} className={`text-right tabular-nums ${strong ? "font-display text-2xl font-extrabold" : "text-lg font-bold"} ${danger ? "text-state-error print:text-black" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

/**
 * The settlement receipt. Used for the success panel and the history modal; `data-print-receipt`
 * is what the print stylesheet keeps (everything else is hidden when printing).
 */
export function ReceiptView({ receipt, balanceAfter }: { receipt: Receipt; balanceAfter?: string }) {
  return (
    <article data-testid="receipt" data-print-receipt className="rounded-2xl border border-line bg-surface p-6 print:rounded-none print:border-0 print:p-0 print:text-black">
      <p className="text-sm font-bold tracking-wide text-ink-muted uppercase print:text-black">The Burger House 828 · Comprobante de rendición</p>
      <h2 data-testid="receipt-title" className="mt-1 font-display text-4xl font-extrabold text-ink print:text-black">
        {receipt.title}
      </h2>
      <p className="mt-1 text-lg font-semibold">
        Cadete <span data-testid="receipt-cadet">{receipt.cadetName}</span> · {receipt.dateLabel}
      </p>
      <dl className="mt-4">
        <Row label="Pedidos" value={receipt.ordersLabel} testId="receipt-orders" />
        <Row label="A rendir" value={receipt.expected} testId="receipt-expected" />
        <Row label="Recibido" value={receipt.received} strong testId="receipt-received" />
        {receipt.hasShortage ? (
          <Row label="Faltante" value={receipt.shortage} strong danger testId="receipt-shortage" />
        ) : (
          <Row label="Faltante" value="Sin faltante" testId="receipt-shortage" />
        )}
        {balanceAfter && <Row label="Saldo del cadete" value={balanceAfter} testId="receipt-balance" />}
        <Row label="Recibió" value={receipt.settledBy} testId="receipt-by" />
      </dl>
      <p className="mt-4 text-base text-ink-muted print:text-black">Pedidos rendidos</p>
      <p data-testid="receipt-order-numbers" className="mt-1 text-lg font-bold break-words">
        {receipt.orderNumbers.join("  ")}
      </p>
      {receipt.note && (
        <p data-testid="receipt-note" className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-base print:border print:border-black/40 print:bg-white">
          <span className="font-bold">Nota: </span>
          {receipt.note}
        </p>
      )}
    </article>
  );
}
