import { and, asc, eq, sql } from "drizzle-orm";
import type { Db, DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { pesosToCents } from "@/domain/money";
import { deleteImage as defaultDeleteImage } from "@/lib/uploads/storage";
import { categoryInputSchema, productInputSchema } from "./schemas";

/**
 * Admin menu core (categories + products). No next/* imports: callers pass the
 * db (or a transaction) and plain inputs. There are NO hard deletes: items are
 * deactivated so order history and the ledger stay intact.
 */

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error?: string; fieldErrors?: Record<string, string> };

type Conn = Db | DbTransaction;
export type MenuDeps = { deleteImage?: (name: string) => Promise<void> };
export type Direction = "up" | "down";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const asDb = (c: Conn) => c as Db;

function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = String(i.path[0] ?? "form");
    out[key] ??= i.message;
  }
  return out;
}

/** drizzle wraps driver errors in `cause`; walk it to find the pg code. */
function pgError(e: unknown): { code?: string; constraint?: string } | null {
  for (let cur: unknown = e, i = 0; cur && typeof cur === "object" && i < 5; i++) {
    const o = cur as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof o.code === "string" && /^[0-9A-Z]{5}$/.test(o.code)) {
      return { code: o.code, constraint: typeof o.constraint === "string" ? o.constraint : undefined };
    }
    cur = o.cause;
  }
  return null;
}

const UNEXPECTED = "No se pudo guardar. Intentá de nuevo.";

async function discardOldImage(old: string | null | undefined, next: string | null, deps: MenuDeps) {
  if (!old || old === next) return;
  try {
    await (deps.deleteImage ?? defaultDeleteImage)(old);
  } catch {
    console.error("[menu] no se pudo borrar la imagen anterior");
  }
}

// ------------------------------------------------------------ categories
export async function saveCategory(db: Conn, input: unknown, deps: MenuDeps = {}): Promise<Result<{ id: number }>> {
  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error.issues) };
  const v = parsed.data;

  try {
    const { id, oldImage } = await asDb(db).transaction(async (tx) => {
      if (v.id !== undefined) {
        const [existing] = await tx.select().from(s.categories).where(eq(s.categories.id, v.id));
        if (!existing) return { id: null, oldImage: null };
        await tx
          .update(s.categories)
          .set({ name: v.name, slug: v.slug, imagePath: v.imagePath, active: v.active })
          .where(eq(s.categories.id, v.id));
        return { id: v.id, oldImage: existing.imagePath };
      }
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${s.categories.sort}), -1) + 1` })
        .from(s.categories);
      const [row] = await tx
        .insert(s.categories)
        .values({ name: v.name, slug: v.slug, imagePath: v.imagePath, active: v.active, sort: Number(next) })
        .returning({ id: s.categories.id });
      return { id: row.id, oldImage: null };
    });
    if (id === null) return fail("La categoría no existe");
    await discardOldImage(oldImage, v.imagePath, deps);
    return ok({ id });
  } catch (e) {
    if (pgError(e)?.code === "23505") {
      return { ok: false, fieldErrors: { name: "Ya existe una categoría con ese nombre" } };
    }
    console.error("[menu] saveCategory failed");
    return fail(UNEXPECTED);
  }
}

// -------------------------------------------------------------- products
export async function saveProduct(db: Conn, input: unknown, deps: MenuDeps = {}): Promise<Result<{ id: number }>> {
  const parsed = productInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  const fields = {
    name: v.name,
    description: v.description === "" ? null : v.description,
    price: pesosToCents(v.priceArs),
    imagePath: v.imagePath,
    active: v.active,
    featured: v.featured,
  };
  const nextSort = async (tx: DbTransaction, categoryId: number) => {
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${s.products.sort}), -1) + 1` })
      .from(s.products)
      .where(eq(s.products.categoryId, categoryId));
    return Number(next);
  };

  try {
    const { id, oldImage } = await asDb(db).transaction(async (tx) => {
      if (v.id !== undefined) {
        const [existing] = await tx.select().from(s.products).where(eq(s.products.id, v.id));
        if (!existing) return { id: null, oldImage: null };
        const moved = existing.categoryId !== v.categoryId;
        await tx
          .update(s.products)
          .set({ ...fields, categoryId: v.categoryId, ...(moved ? { sort: await nextSort(tx, v.categoryId) } : {}) })
          .where(eq(s.products.id, v.id));
        return { id: v.id, oldImage: existing.imagePath };
      }
      const [row] = await tx
        .insert(s.products)
        .values({ ...fields, categoryId: v.categoryId, sort: await nextSort(tx, v.categoryId) })
        .returning({ id: s.products.id });
      return { id: row.id, oldImage: null };
    });
    if (id === null) return fail("El producto no existe");
    await discardOldImage(oldImage, v.imagePath, deps);
    return ok({ id });
  } catch (e) {
    const code = pgError(e)?.code;
    if (code === "23505") {
      return { ok: false, fieldErrors: { name: "Ya existe un producto con ese nombre en la categoría" } };
    }
    if (code === "23503") {
      return { ok: false, fieldErrors: { categoryId: "La categoría elegida no existe" } };
    }
    console.error("[menu] saveProduct failed");
    return fail(UNEXPECTED);
  }
}

// ------------------------------------------------------------- ordering
type Sibling = { id: number; sort: number };

/** Renormalizes `siblings` (already ordered) to 0..n-1, then swaps `id` with its neighbour. */
async function swapInScope(
  siblings: Sibling[],
  id: number,
  dir: Direction,
  write: (id: number, sort: number) => Promise<unknown>,
): Promise<boolean> {
  const order = siblings.map((x) => x.id);
  const idx = order.indexOf(id);
  const target = dir === "up" ? idx - 1 : idx + 1;
  if (target >= 0 && target < order.length) {
    [order[idx], order[target]] = [order[target], order[idx]];
  }
  let changed = false;
  for (let i = 0; i < order.length; i++) {
    const before = siblings.find((x) => x.id === order[i])!.sort;
    if (before !== i) {
      await write(order[i], i);
      changed = true;
    }
  }
  return changed;
}

export async function moveCategory(db: Conn, id: number, dir: Direction): Promise<Result<null>> {
  if (!Number.isInteger(id)) return fail("Categoría inválida");
  return asDb(db).transaction(async (tx) => {
    const siblings = await tx
      .select({ id: s.categories.id, sort: s.categories.sort })
      .from(s.categories)
      .orderBy(asc(s.categories.sort), asc(s.categories.id));
    if (!siblings.some((x) => x.id === id)) return fail("La categoría no existe");
    await swapInScope(siblings, id, dir, (cid, sort) =>
      tx.update(s.categories).set({ sort }).where(eq(s.categories.id, cid)),
    );
    return ok(null);
  });
}

export async function moveProduct(db: Conn, id: number, dir: Direction): Promise<Result<null>> {
  if (!Number.isInteger(id)) return fail("Producto inválido");
  return asDb(db).transaction(async (tx) => {
    const [product] = await tx.select({ categoryId: s.products.categoryId }).from(s.products).where(eq(s.products.id, id));
    if (!product) return fail("El producto no existe");
    const siblings = await tx
      .select({ id: s.products.id, sort: s.products.sort })
      .from(s.products)
      .where(eq(s.products.categoryId, product.categoryId))
      .orderBy(asc(s.products.sort), asc(s.products.id));
    await swapInScope(siblings, id, dir, (pid, sort) =>
      tx
        .update(s.products)
        .set({ sort })
        .where(and(eq(s.products.id, pid), eq(s.products.categoryId, product.categoryId))),
    );
    return ok(null);
  });
}

// --------------------------------------------------------------- toggles
async function setFlag(
  affected: Promise<{ id: number }[]>,
  notFound: string,
): Promise<Result<null>> {
  return (await affected).length ? ok(null) : fail(notFound);
}

export async function setCategoryActive(db: Conn, id: number, active: boolean): Promise<Result<null>> {
  if (!Number.isInteger(id)) return fail("Categoría inválida");
  return setFlag(
    db.update(s.categories).set({ active }).where(eq(s.categories.id, id)).returning({ id: s.categories.id }),
    "La categoría no existe",
  );
}

export async function setProductActive(db: Conn, id: number, active: boolean): Promise<Result<null>> {
  if (!Number.isInteger(id)) return fail("Producto inválido");
  return setFlag(
    db.update(s.products).set({ active }).where(eq(s.products.id, id)).returning({ id: s.products.id }),
    "El producto no existe",
  );
}

export async function setProductFeatured(db: Conn, id: number, featured: boolean): Promise<Result<null>> {
  if (!Number.isInteger(id)) return fail("Producto inválido");
  return setFlag(
    db.update(s.products).set({ featured }).where(eq(s.products.id, id)).returning({ id: s.products.id }),
    "El producto no existe",
  );
}

export { categoryInputSchema, productInputSchema } from "./schemas";
export { slugify } from "./slug";
