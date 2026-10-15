import type { ModifierKind } from "@/lib/modifiers/kitchen-label";

/** Plain-Spanish names for the three modifier kinds. */
export const KIND_LABEL: Record<ModifierKind, string> = {
  remove: "Quitar",
  add: "Agregar",
  swap: "Cambiar",
};
