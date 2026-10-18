import { z } from "@/lib/zod";
import { ORDER_STATUSES } from "@/domain/order-status";

/** Postgres NOTIFY channels (spec §5 "Tiempo real"). No next/* here: shared by server and tests. */
export const ORDERS_CHANNEL = "orders_changed";
export const PRINT_CHANNEL = "print_job_created";

export type Channel = typeof ORDERS_CHANNEL | typeof PRINT_CHANNEL;

const KNOWN_ORDER_EVENTS = ["created", "status", "assigned", "settled", "updated"] as const;

/** Unknown `event` strings (a newer writer than reader) degrade to "updated": still a refetch hint. */
const ordersEventSchema = z.object({
  orderId: z.number().int().positive(),
  status: z.enum(ORDER_STATUSES),
  event: z.string().transform((e) => ((KNOWN_ORDER_EVENTS as readonly string[]).includes(e) ? e : "updated") as OrdersEventName),
});

type OrdersEventName = (typeof KNOWN_ORDER_EVENTS)[number];

export type OrdersEvent = { orderId: number; status: (typeof ORDER_STATUSES)[number]; event: OrdersEventName };

const printEventSchema = z.object({
  jobId: z.number().int().positive(),
  stationId: z.number().int().positive(),
});

export type PrintEvent = z.infer<typeof printEventSchema>;

export type ChannelPayloads = {
  [ORDERS_CHANNEL]: OrdersEvent;
  [PRINT_CHANNEL]: PrintEvent;
};

/** Postgres caps a NOTIFY payload at 8000 bytes; anything near that is not ours. */
const MAX_PAYLOAD_CHARS = 8000;

export function parseEventPayload<C extends Channel>(channel: C, raw: string): ChannelPayloads[C] | null;
export function parseEventPayload(channel: string, raw: string): ChannelPayloads[Channel] | null;
export function parseEventPayload(channel: string, raw: string): ChannelPayloads[Channel] | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_PAYLOAD_CHARS) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const schema = channel === ORDERS_CHANNEL ? ordersEventSchema : channel === PRINT_CHANNEL ? printEventSchema : null;
  if (!schema) return null;
  const parsed = schema.safeParse(json);
  return parsed.success ? (parsed.data as ChannelPayloads[Channel]) : null;
}
