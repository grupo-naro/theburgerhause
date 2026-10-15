import { revalidatePath } from "next/cache";

/** Cadets are admin-only data (no public cache tag): refresh the admin page. Server Actions only. */
export function invalidateCadets(): void {
  revalidatePath("/admin/cadetes");
}
