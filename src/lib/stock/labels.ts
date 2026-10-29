import type { Kind, StockStatus } from "./quantity";
import type { MovementKind } from "./movements";

/** es-AR names for the stock screens (pure: safe on the client). */
export const KIND_LABEL: Record<Kind, string> = { bebida: "Bebida", materia_prima: "Materia prima" };
export const KIND_SECTION: Record<Kind, string> = { bebida: "Bebidas", materia_prima: "Materia prima" };
export const UNIT_LABEL = { kg: "kg (kilos)", u: "u (unidades)", l: "l (litros)" } as const;
export const STATUS_LABEL: Record<StockStatus, string> = { ok: "Ok", poco: "Poco", agotado: "Agotado" };
export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  ajuste_inicial: "Stock inicial",
  ingreso: "Ingreso",
  consumo: "Consumo",
  venta: "Venta",
  devolucion: "Devolución",
  ajuste_pedido: "Ajuste de pedido",
};
