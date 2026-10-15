"use client";

import type { PublicModifier, PublicProduct } from "@/lib/menu/public";
import { ModifierGroup } from "./modifier-group";
import { NoteField } from "./note-field";

type Props = {
  product: PublicProduct;
  selectedIds: readonly number[];
  note: string;
  /** Unique per unit (prefix of the ids of the groups). */
  idPrefix: string;
  onToggle: (modifier: PublicModifier) => void;
  onNote: (note: string) => void;
};

/** The product's modifier groups (in group order) plus the optional note, for ONE unit. */
export function UnitFields({ product, selectedIds, note, idPrefix, onToggle, onNote }: Props) {
  return (
    <div>
      {product.modifierGroups.map((group) => (
        <ModifierGroup
          key={group.id}
          group={group}
          selectedIds={selectedIds}
          onToggle={onToggle}
          idPrefix={`${idPrefix}-g${group.id}`}
        />
      ))}
      <NoteField value={note} onChange={onNote} />
    </div>
  );
}
