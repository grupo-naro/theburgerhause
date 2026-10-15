import { formatARS } from "@/domain/money";

export type PrintBlock =
  | { type: "text"; text: string; bold?: boolean; size?: 1 | 2; align?: "left" | "center" }
  | { type: "divider" }
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

export function renderKitchenTicket(order: PrintableOrder): PrintDocument {
  const items = order.items.flatMap((item, i): PrintBlock[] => [
    text(`${i + 1}) ${item.name.toUpperCase()}`, { bold: true, size: 1, align: "left" }),
    ...item.modifiers.map((m) =>
      text(`   ${m.kitchenLabel.toUpperCase()}`, { bold: true, size: 2, align: "left" }),
    ),
    ...(item.note
      ? [text(`   NOTA: ${item.note.toUpperCase()}`, { bold: true, size: 1, align: "left" })]
      : []),
  ]);

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

export function renderCustomerTicket(order: PrintableOrder): PrintDocument {
  const items = order.items.flatMap((item): PrintBlock[] => [
    text(`${item.name}  ${formatARS(item.unitPrice)}`, { align: "left" }),
    ...item.modifiers.map((m) =>
      text(`   ${m.name}${m.priceDelta !== 0 ? `  (${signedARS(m.priceDelta)})` : ""}`),
    ),
    ...(item.note ? [text(`   Nota: ${item.note}`)] : []),
  ]);

  return {
    blocks: [
      big("THE BURGER HOUSE 828"),
      text(`PEDIDO #${order.number}`, { bold: true, align: "center" }),
      text(`${dateFormat.format(order.createdAt)} ${timeFormat.format(order.createdAt)}`, {
        align: "center",
      }),
      DIVIDER,
      ...customerBlocks(order),
      DIVIDER,
      ...items,
      DIVIDER,
      text(`Subtotal: ${formatARS(order.subtotal)}`),
      ...(order.deliveryFee > 0 ? [text(`Envío: ${formatARS(order.deliveryFee)}`)] : []),
      text(`TOTAL: ${formatARS(order.total)}`, { bold: true, size: 2 }),
      text(paymentLine(order)),
      text("¡Gracias por tu compra!", { align: "center" }),
      CUT,
    ],
  };
}
