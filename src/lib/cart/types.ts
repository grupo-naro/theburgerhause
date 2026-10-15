/** ONE LINE PER PHYSICAL UNIT. Grouping identical units is purely visual (see group.ts). */
export type CartLine = {
  /** Client-generated unique id. */
  id: string;
  productId: number;
  /** Always sorted ascending and de-duplicated. */
  modifierIds: number[];
  /** Always trimmed ("" when none). */
  note: string;
};

export type CartState = { lines: CartLine[] };

export type CartGroup = {
  signature: string;
  productId: number;
  modifierIds: number[];
  note: string;
  quantity: number;
  lineIds: string[];
};

/** What one unit looks like before it gets an id. */
export type UnitConfig = { modifierIds: number[]; note: string };

/** The contract Task 4.3 (`createOrder`) consumes: one entry per unit, no prices. */
export type OrderUnitInput = { productId: number; modifierIds: number[]; note: string };

export type CartAction =
  | { type: "add"; productId: number; units: UnitConfig[] }
  | { type: "removeLine"; id: string }
  | { type: "removeGroup"; signature: string }
  | { type: "setGroupQuantity"; signature: string; quantity: number }
  | { type: "replaceGroup"; signature: string; productId: number; units: UnitConfig[] }
  | { type: "clear" }
  | { type: "hydrate"; lines: CartLine[] };

export type CartIssue =
  | { type: "product_unavailable"; productId: number; name?: string; quantity: number }
  | { type: "modifier_unavailable"; productId: number; modifierIds: number[]; quantity: number }
  | { type: "price_changed"; productId: number; from: number; to: number; quantity: number };
