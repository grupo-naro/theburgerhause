import type { Role } from "@/lib/auth/roles";

export type Capabilities = {
  /** Select delivery orders and assign them to a cadet. */
  canAssign: boolean;
  /** Entregado / Volver a despacho on en-camino orders. */
  canControlDelivery: boolean;
  /** Open the cadet's rendicion. */
  canRender: boolean;
  /** Ready / pickup / delivered for counter and takeaway orders. */
  canControlCounter: boolean;
};

const FULL: Capabilities = { canAssign: true, canControlDelivery: true, canRender: true, canControlCounter: true };

const BY_ROLE: Record<Role, Capabilities> = {
  admin: FULL,
  encargado: FULL,
  encargada_delivery: FULL,
  cocina: { canAssign: false, canControlDelivery: false, canRender: false, canControlCounter: false },
  cajera: { canAssign: false, canControlDelivery: false, canRender: false, canControlCounter: true },
};

/** What each role sees as actionable on the board. The server actions are the real boundary. */
export const capabilitiesFor = (role: Role): Capabilities => ({ ...BY_ROLE[role] });
