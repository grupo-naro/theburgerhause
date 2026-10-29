import { formatARS } from "@/domain/money";

export type PrintBlock =
  | { type: "text"; text: string; bold?: boolean; size?: 1 | 2; align?: "left" | "center" }
  | { type: "divider" }
  /** The brand logo, centered. The AGENT owns the bitmap (it knows the paper width); it falls back to text. */
  | { type: "logo" }
  | { type: "cut" };
export type PrintDocument = { blocks: PrintBlock[] };

export type PrintableModifier = {
  name: string;
  kitchenLabel: string;
  kind: "remove" | "add" | "swap";
  priceDelta: number;
};
export type PrintableItem = {
  name: string;
  unitPrice: number;
  note: string | null;
  modifiers: PrintableModifier[];
  /** Sequence number of the add-on this unit belongs to; null = part of the original order. */
  addonSeq: number | null;
};
export type PrintableOrder = {
  number: number;
  channel: "web" | "counter";
  fulfillment: "delivery" | "takeaway";
  createdAt: Date;
  customerName: string | null;
  whatsapp: string | null;
  address: string | null;
  crossStreets: string | null;
  addressNotes: string | null;
  pagerNumber: number | null;
  paymentMethod: "cash" | "transfer";
  paymentStatus: "pending" | "paid";
  subtotal: number;
  deliveryFee: number;
  total: number;
  items: PrintableItem[]; // ONE entry per physical unit (2 burgers = 2 items)
};

const TIME_ZONE = "America/Argentina/Buenos_Aires";
const timeFormat = new Intl.DateTimeFormat("es-AR", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dateFormat = new Intl.DateTimeFormat("es-AR", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const DIVIDER: PrintBlock = { type: "divider" };
const CUT: PrintBlock = { type: "cut" };
const LOGO: PrintBlock = { type: "logo" };

export const BRAND_NAME = "THE BURGER HOUSE 828";
export const THANKS_LINE = "GRACIAS POR TU COMPRA";

function text(
  value: string,
  opts: { bold?: boolean; size?: 1 | 2; align?: "left" | "center" } = {},
): PrintBlock {
  return { type: "text", text: value, ...opts };
}

const big = (value: string) => text(value, { bold: true, size: 2, align: "center" });

function pagerBlocks(order: PrintableOrder): PrintBlock[] {
  return order.pagerNumber != null ? [big(`LLAMADOR ${order.pagerNumber}`)] : [];
}

function serviceType(order: PrintableOrder): string {
  if (order.channel === "counter") return "MOSTRADOR";
  return order.fulfillment === "delivery" ? "DELIVERY" : "RETIRO";
}

/** One numbered entry per physical unit with its kitchen labels and note (no prices). */
function kitchenItemBlocks(order: PrintableOrder): PrintBlock[] {
  return order.items.flatMap((item, i): PrintBlock[] => [
    text(`${i + 1}) ${item.name.toUpperCase()}`, { bold: true, size: 1, align: "left" }),
    ...item.modifiers.map((m) =>
      text(`   ${m.kitchenLabel.toUpperCase()}`, { bold: true, size: 2, align: "left" }),
    ),
    ...(item.note
      ? [text(`   NOTA: ${item.note.toUpperCase()}`, { bold: true, size: 1, align: "left" })]
      : []),
  ]);
}

/**
 * Add-on kitchen comanda: `order.items` must hold ONLY that add-on's units (loadPrintableOrder with `addonId`); no prices.
 * `addonSeq` is not a printable block: it rides in the job payload so a failed ticket is matched only with the
 * reprint of the SAME add-on (SAME_KIND in caja-queries.ts); the agent ignores unknown keys.
 */
export function renderAdditionalTicket(order: PrintableOrder, addon: { seq: number }): PrintDocument & { addonSeq: number } {
  return {
    addonSeq: addon.seq,
    blocks: [
      big(`ADICIONAL ${addon.seq} al #${order.number}`),
      big(serviceType(order)),
      ...pagerBlocks(order),
      text(timeFormat.format(order.createdAt), { size: 1, align: "center" }),
      DIVIDER,
      ...kitchenItemBlocks(order),
      DIVIDER,
      CUT,
    ],
  };
}

/**
 * Kitchen comanda: number, service type (+ llamador), time and every physical unit with its kitchen labels and note. Printed first on every station.
 */
export function renderKitchenTicket(order: PrintableOrder): PrintDocument {
  const items = kitchenItemBlocks(order);

  return {
    blocks: [
      big(`PEDIDO #${order.number}`),
      big(serviceType(order)),
      ...pagerBlocks(order),
      text(timeFormat.format(order.createdAt), { size: 1, align: "center" }),
      DIVIDER,
      ...items,
      DIVIDER,
      CUT,
    ],
  };
}

function signedARS(delta: number): string {
  return `${delta < 0 ? "-" : "+"}${formatARS(Math.abs(delta))}`;
}

function paymentLine(order: PrintableOrder): string {
  const method = order.paymentMethod === "cash" ? "Efectivo" : "Transferencia";
  const pending = order.paymentMethod === "cash" ? "pendiente de cobro" : "pendiente de verificación";
  return `Pago: ${method} (${order.paymentStatus === "paid" ? "pagado" : pending})`;
}

function customerBlocks(order: PrintableOrder): PrintBlock[] {
  const lines: [string, string | null][] = [
    ["Cliente", order.customerName],
    ["WhatsApp", order.whatsapp],
  ];
  if (order.fulfillment === "delivery") {
    lines.push(
      ["Dirección", order.address],
      ["Entre calles", order.crossStreets],
      ["Aclaraciones", order.addressNotes],
    );
  }
  return [
    ...lines.flatMap(([label, value]) => (value ? [text(`${label}: ${value}`)] : [])),
    ...pagerBlocks(order),
    ...(order.channel === "web" && order.fulfillment === "takeaway"
      ? [text("Retira en el local")]
      : []),
  ];
}

function priceItems(order: PrintableOrder): PrintBlock[] {
  return order.items.flatMap((item): PrintBlock[] => [
    text(`${item.name}  ${formatARS(item.unitPrice)}`, { align: "left" }),
    ...item.modifiers.map((m) =>
      text(`   ${m.name}${m.priceDelta !== 0 ? `  (${signedARS(m.priceDelta)})` : ""}`),
    ),
    ...(item.note ? [text(`   Nota: ${item.note}`)] : []),
  ]);
}

function totalsBlocks(order: PrintableOrder): PrintBlock[] {
  return [
    text(`Subtotal: ${formatARS(order.subtotal)}`),
    ...(order.deliveryFee > 0 ? [text(`Envío: ${formatARS(order.deliveryFee)}`)] : []),
    text(`TOTAL: ${formatARS(order.total)}`, { bold: true, size: 2 }),
  ];
}

/**
 * Delivery (dispatch) ticket: the one that travels with the order. Address, phone, payment, items; no
 * logo, no thanks. Cash still to collect is spelled out as "Efectivo: cobrar $X" for the cadet.
 */
export function renderDeliveryTicket(order: PrintableOrder): PrintDocument {
  const collect = order.paymentMethod === "cash" && order.paymentStatus === "pending";
  return {
    blocks: [
      big(`PEDIDO #${order.number}`),
      big(serviceType(order)),
      ...pagerBlocks(order),
      text(timeFormat.format(order.createdAt), { size: 1, align: "center" }),
      DIVIDER,
      ...customerBlocks(order),
      DIVIDER,
      ...priceItems(order),
      DIVIDER,
      ...totalsBlocks(order),
      collect ? text(`Efectivo: cobrar ${formatARS(order.total)}`, { bold: true }) : text(paymentLine(order)),
      CUT,
    ],
  };
}

export function renderCustomerTicket(order: PrintableOrder): PrintDocument {
  return {
    blocks: [
      LOGO,
      text(BRAND_NAME, { bold: true, align: "center" }),
      text(`PEDIDO #${order.number}`, { bold: true, align: "center" }),
      text(`${dateFormat.format(order.createdAt)} ${timeFormat.format(order.createdAt)}`, {
        align: "center",
      }),
      DIVIDER,
      ...customerBlocks(order),
      DIVIDER,
      ...priceItems(order),
      DIVIDER,
      ...totalsBlocks(order),
      text(paymentLine(order)),
      DIVIDER,
      text(THANKS_LINE, { bold: true, align: "center" }),
      CUT,
    ],
  };
}
