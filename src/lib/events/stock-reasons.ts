/** Why a stock balance changed (payload of STOCK_CHANNEL). Dependency-free: imported by the browser side too. */
export const STOCK_EVENT_REASONS = ["ingreso", "consumo", "venta", "devolucion", "ajuste", "edicion"] as const;
export type StockEventReason = (typeof STOCK_EVENT_REASONS)[number];
