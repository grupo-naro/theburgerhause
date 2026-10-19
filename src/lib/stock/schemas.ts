import { z } from "@/lib/zod";
import { idempotencyKeySchema, text } from "@/lib/orders/schemas";
import { MAX_MILLI, MILLI_PER_UNIT, STOCK_KINDS, STOCK_UNITS, type Unit } from "./quantity";

/**
 * Input contracts and result type of the stock domain (server). Quantities arrive already in
 * milli-units (the UI parses what people type with `parseQuantity`); the unit-specific rule
 * (whole numbers for `u`) is re-checked here or against the item inside the transaction.
 */

export type StockFailureCode = "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "NOT_EDITABLE" | "NEEDS_CONFIRMATION" | "UNEXPECTED";
export type StockNegative = { itemId: number; name: string; resultingQuantity: number };
export type StockFailure = {
  ok: false;
  code: StockFailureCode;
  message: string;
  fieldErrors?: Record<string, string>;
  /** Only with NEEDS_CONFIRMATION (registerConsumo): the items that would end below zero. */
  negatives?: StockNegative[];
};
export type Result<T> = { ok: true; data: T } | StockFailure;

export const stockFailure = (code: StockFailureCode, message: string, extra: Partial<StockFailure> = {}): StockFailure => ({
  ok: false,
  code,
  message,
  ...extra,
});

export const STOCK_MESSAGES = {
  VALIDATION: "Revisá los datos",
  ITEM_NOT_FOUND: "El artículo no existe",
  MOVEMENT_NOT_FOUND: "El movimiento no existe",
  ITEM_INACTIVE: "El artículo está dado de baja",
  DUPLICATE_NAME: "Ya existe un artículo con ese nombre",
  INITIAL_DONE: "Este artículo ya tiene stock inicial: corregilo desde el historial",
  WHOLE_UNITS: "Para unidades usá números enteros",
  NOTHING_TO_SAVE: "Cargá al menos una cantidad",
  REPEATED_ITEM: "Hay un artículo repetido",
  NOT_EDITABLE: "Las ventas y devoluciones se registran solas y no se pueden editar",
  NEGATIVE: "Esto deja el stock en negativo. Confirmá para guardar igual.",
} as const;

const INT4_MAX = 2_147_483_647;
const BAD_ID = "Dato inválido";
export const idSchema = z.number({ error: BAD_ID }).int(BAD_ID).positive(BAD_ID).max(INT4_MAX, BAD_ID);
const milli = (min: number) =>
  z
    .number({ error: "Cantidad inválida" })
    .int("Cantidad inválida")
    .min(min, min > 0 ? "La cantidad debe ser mayor a cero" : "La cantidad no puede ser negativa")
    .max(MAX_MILLI, "La cantidad es demasiado grande");

export const unitSchema = z.enum(STOCK_UNITS, { error: "Elegí una unidad" });
export const kindSchema = z.enum(STOCK_KINDS, { error: "Elegí un tipo" });

/** True if `milli` is acceptable for `unit` (whole numbers only for `u`). */
export const fitsUnit = (m: number, unit: Unit): boolean => unit !== "u" || m % MILLI_PER_UNIT === 0;

const itemFields = {
  name: text(2, 60),
  minQty: milli(0),
};

export const createStockItemSchema = z
  .object({ ...itemFields, kind: kindSchema, unit: unitSchema })
  .refine((v) => fitsUnit(v.minQty, v.unit), { path: ["minQty"], message: STOCK_MESSAGES.WHOLE_UNITS });
export type CreateStockItemInput = z.input<typeof createStockItemSchema>;

export const updateStockItemSchema = z.object({ ...itemFields, itemId: idSchema, active: z.boolean({ error: BAD_ID }) });
export type UpdateStockItemInput = z.input<typeof updateStockItemSchema>;

export const initialStockSchema = z.object({ itemId: idSchema, userId: idSchema, milli: milli(0) });

export const ingresoSchema = z.object({
  itemId: idSchema,
  userId: idSchema,
  milli: milli(1),
  note: text(0, 200).optional(),
  idempotencyKey: idempotencyKeySchema,
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const businessDateSchema = z
  .string({ error: "Fecha inválida" })
  .regex(DATE, "Fecha inválida")
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  }, "Fecha inválida");

export const consumoSchema = z.object({
  userId: idSchema,
  businessDate: businessDateSchema,
  lines: z
    .array(z.object({ itemId: idSchema, milli: milli(0) }), { error: STOCK_MESSAGES.NOTHING_TO_SAVE })
    .max(500, "Demasiados artículos"),
  idempotencyKey: idempotencyKeySchema,
  confirmNegative: z.boolean().optional().default(false),
});

export const editMovementSchema = z.object({
  movementId: idSchema,
  userId: idSchema,
  newMilli: milli(0),
  confirmNegative: z.boolean({ error: BAD_ID }),
});

export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const k = issue.path.join(".") || "_";
    out[k] ??= issue.message;
  }
  return out;
}

export function validationFailure(error: z.ZodError): StockFailure {
  const fieldErrors = fieldErrorsOf(error);
  const first = Object.values(fieldErrors)[0];
  return stockFailure("VALIDATION", first ?? STOCK_MESSAGES.VALIDATION, { fieldErrors });
}
