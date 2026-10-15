import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Db, DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { pesosToCents } from "@/domain/money";
import { pgError, swapInScope, UNEXPECTED, zodFieldErrors, type Direction, type Result } from "@/lib/menu/admin";
import { groupInputSchema, modifierInputSchema } from "./schemas";

/**
 * Admin modifiers core (groups, modifiers, product links). No next/* imports.
 * No hard deletes: modifiers are deactivated (groups have no active flag).
 * `product_modifier_groups` has no sort column, so the order of groups on the
 * product sheet is the group id order (documented ruling, no migration).
 */

type Conn = Db | DbTransaction;
const asDb = (c: Conn) => c as Db;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export type AdminModifier = typeof s.modifiers.$inferSelect;
export type AdminModifierGroup = typeof s.modifierGroups.$inferSelect & { modifiers: AdminModifier[] };

// ---------------------------------------------------------------- groups
export async function saveModifierGroup(db: Conn, input: unknown): Promise<Result<{ id: number }>> {
  const parsed = groupInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  try {
    if (v.id !== undefined) {
      const rows = await db
        .update(s.modifierGroups)
        .set({ name: v.name })
        .where(eq(s.modifierGroups.id, v.id))
        .returning({ id: s.modifierGroups.id });
      return rows.length ? ok({ id: v.id }) : fail("El grupo no existe");
    }
    const [row] = await db.insert(s.modifierGroups).values({ name: v.name }).returning({ id: s.modifierGroups.id });
    return ok({ id: row.id });
  } catch (e) {
    if (pgError(e)?.code === "23505") {
      return { ok: false, fieldErrors: { name: "Ya existe un grupo con ese nombre" } };
    }
    console.error("[modifiers] saveModifierGroup failed");
    return fail(UNEXPECTED);
  }
}

// ------------------------------------------------------------- modifiers
export async function saveModifier(db: Conn, input: unknown): Promise<Result<{ id: number }>> {
  const parsed = modifierInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  const fields = {
    name: v.name,
    kind: v.kind,
    priceDelta: pesosToCents(v.priceArs),
    kitchenLabel: v.kitchenLabel,
    active: v.active,
  };
  const nextSort = async (tx: DbTransaction, groupId: number) => {
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${s.modifiers.sort}), -1) + 1` })
      .from(s.modifiers)
      .where(eq(s.modifiers.groupId, groupId));
    return Number(next);
  };

  try {
    const id = await asDb(db).transaction(async (tx) => {
      if (v.id !== undefined) {
        const [existing] = await tx.select().from(s.modifiers).where(eq(s.modifiers.id, v.id));
        if (!existing) return null;
        const moved = existing.groupId !== v.groupId;
        await tx
          .update(s.modifiers)
          .set({ ...fields, groupId: v.groupId, ...(moved ? { sort: await nextSort(tx, v.groupId) } : {}) })
          .where(eq(s.modifiers.id, v.id));
        return v.id;
      }
      const [row] = await tx
        .insert(s.modifiers)
        .values({ ...fields, groupId: v.groupId, sort: await nextSort(tx, v.groupId) })
        .returning({ id: s.modifiers.id });
      return row.id;
    });
    return id === null ? fail("El modificador no existe") : ok({ id });
  } catch (e) {
    const code = pgError(e)?.code;
    if (code === "23505") {
      return { ok: false, fieldErrors: { name: "Ya existe un modificador con ese nombre en el grupo" } };
    }
    if (code === "23503") return { ok: false, fieldErrors: { groupId: "El grupo elegido no existe" } };
    if (code === "23514") return { ok: false, fieldErrors: { priceArs: "Un quite no puede tener precio" } };
    console.error("[modifiers] saveModifier failed");
    return fail(UNEXPECTED);
  }
}

export async function moveModifier(db: Conn, id: number, dir: Direction): Promise<Result<null>> {
  if (!Number.isInteger(id)) return fail("Modificador inválido");
  return asDb(db).transaction(async (tx) => {
    const [mod] = await tx.select({ groupId: s.modifiers.groupId }).from(s.modifiers).where(eq(s.modifiers.id, id));
    if (!mod) return fail("El modificador no existe");
    const siblings = await tx
      .select({ id: s.modifiers.id, sort: s.modifiers.sort })
      .from(s.modifiers)
      .where(eq(s.modifiers.groupId, mod.groupId))
      .orderBy(asc(s.modifiers.sort), asc(s.modifiers.id));
    await swapInScope(siblings, id, dir, (mid, sort) =>
      tx
        .update(s.modifiers)
        .set({ sort })
        .where(and(eq(s.modifiers.id, mid), eq(s.modifiers.groupId, mod.groupId))),
    );
    return ok(null);
  });
}

export async function setModifierActive(db: Conn, id: number, active: boolean): Promise<Result<null>> {
  if (!Number.isInteger(id)) return fail("Modificador inválido");
  const rows = await db
    .update(s.modifiers)
    .set({ active })
    .where(eq(s.modifiers.id, id))
    .returning({ id: s.modifiers.id });
  return rows.length ? ok(null) : fail("El modificador no existe");
}

// ------------------------------------------------------ product linking
/** Replaces the groups linked to a product, atomically. All-or-nothing. */
export async function setProductModifierGroups(
  db: Conn,
  productId: number,
  groupIds: number[],
): Promise<Result<null>> {
  if (!Number.isInteger(productId) || productId <= 0) return fail("Producto inválido");
  if (!Array.isArray(groupIds) || !groupIds.every((g) => Number.isInteger(g) && g > 0)) {
    return fail("Grupo inválido");
  }
  const ids = [...new Set(groupIds)];
  try {
    return await asDb(db).transaction(async (tx) => {
      const [product] = await tx.select({ id: s.products.id }).from(s.products).where(eq(s.products.id, productId));
      if (!product) return fail("El producto no existe");
      if (ids.length > 0) {
        const found = await tx
          .select({ id: s.modifierGroups.id })
          .from(s.modifierGroups)
          .where(inArray(s.modifierGroups.id, ids));
        if (found.length !== ids.length) return fail("Algún grupo elegido no existe");
      }
      await tx
        .delete(s.productModifierGroups)
        .where(
          ids.length > 0
            ? and(eq(s.productModifierGroups.productId, productId), notInArray(s.productModifierGroups.groupId, ids))
            : eq(s.productModifierGroups.productId, productId),
        );
      if (ids.length > 0) {
        await tx
          .insert(s.productModifierGroups)
          .values(ids.map((groupId) => ({ productId, groupId })))
          .onConflictDoNothing();
      }
      return ok(null);
    });
  } catch (e) {
    if (pgError(e)?.code === "23503") return fail("Algún grupo o el producto ya no existe");
    console.error("[modifiers] setProductModifierGroups failed");
    return fail(UNEXPECTED);
  }
}

// ----------------------------------------------------------------- reads
/** Every group (id order) with all its modifiers, active or not, in display order. */
export async function listGroupsWithModifiers(db: Conn): Promise<AdminModifierGroup[]> {
  const [groups, mods] = await Promise.all([
    db.select().from(s.modifierGroups).orderBy(asc(s.modifierGroups.id)),
    db.select().from(s.modifiers).orderBy(asc(s.modifiers.sort), asc(s.modifiers.id)),
  ]);
  return groups.map((g) => ({ ...g, modifiers: mods.filter((m) => m.groupId === g.id) }));
}

export async function listProductGroupIds(db: Conn, productId: number): Promise<number[]> {
  const rows = await db
    .select({ groupId: s.productModifierGroups.groupId })
    .from(s.productModifierGroups)
    .where(eq(s.productModifierGroups.productId, productId))
    .orderBy(asc(s.productModifierGroups.groupId));
  return rows.map((r) => r.groupId);
}

export async function getGroupForAdmin(db: Conn, id: number) {
  const [row] = await db.select().from(s.modifierGroups).where(eq(s.modifierGroups.id, id));
  return row ?? null;
}

export async function getModifierForAdmin(db: Conn, id: number): Promise<AdminModifier | null> {
  const [row] = await db.select().from(s.modifiers).where(eq(s.modifiers.id, id));
  return row ?? null;
}

export { groupInputSchema, modifierInputSchema } from "./schemas";
export { normalizeKitchenLabel } from "./kitchen-label";
