import { formatMoney } from "./shortage";

const TZ = "America/Argentina/Buenos_Aires";

export type ReceiptSource = {
  id: number;
  cadetName: string;
  amount: number;
  receivedAmount: number;
  shortage: number;
  orderCount: number;
  orders: { id: number; number: number; total: number }[];
  settledByName: string | null;
  note: string | null;
  createdAt: string;
};

export type Receipt = {
  title: string;
  cadetName: string;
  dateLabel: string;
  ordersLabel: string;
  orderNumbers: string[];
  expected: string;
  received: string;
  shortage: string;
  hasShortage: boolean;
  settledBy: string;
  note: string | null;
};

type Parts = { day: string; month: string; year: string; hour: string; minute: string };

const formatter = new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const partsOf = (d: Date): Parts => {
  const p: Record<string, string> = {};
  for (const x of formatter.formatToParts(d)) p[x.type] = x.value;
  return p as Parts;
};

export const pluralOrders = (n: number): string => `${n} ${n === 1 ? "pedido" : "pedidos"}`;

export function buildReceipt(r: ReceiptSource): Receipt {
  const d = new Date(r.createdAt);
  const p = Number.isNaN(d.getTime()) ? null : partsOf(d);
  return {
    title: `Rendición #${r.id}`,
    cadetName: r.cadetName,
    dateLabel: p ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}` : "—",
    ordersLabel: pluralOrders(r.orderCount),
    orderNumbers: r.orders.map((o) => `#${o.number}`),
    expected: formatMoney(r.amount),
    received: formatMoney(r.receivedAmount),
    shortage: formatMoney(r.shortage),
    hasShortage: r.shortage > 0,
    settledBy: r.settledByName ?? "—",
    note: r.note && r.note.trim() !== "" ? r.note : null,
  };
}

const dayKey = (p: Parts) => `${p.year}-${p.month}-${p.day}`;

/** "Nunca" / "hoy 14:05" / "ayer 20:30" / "10/10 12:00", on the Argentina calendar. */
export function formatSettledAt(iso: string | null, now: Date): string {
  if (iso === null) return "Nunca";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = partsOf(d);
  const time = `${p.hour}:${p.minute}`;
  if (dayKey(p) === dayKey(partsOf(now))) return `hoy ${time}`;
  if (dayKey(p) === dayKey(partsOf(new Date(now.getTime() - 24 * 3_600_000)))) return `ayer ${time}`;
  return `${p.day}/${p.month} ${time}`;
}

/** The non-dismissable banner shown when the cadet's balance moved under the manager's feet. */
export function mismatchMessage(d: { expected: number; actual: number; orderCount: number }): string {
  return `El saldo cambió: antes ${formatMoney(d.expected)}, ahora ${formatMoney(d.actual)} (${pluralOrders(d.orderCount)}). Revisá la lista y volvé a confirmar`;
}
