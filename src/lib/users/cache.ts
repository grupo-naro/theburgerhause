import { revalidatePath } from "next/cache";

/** Users are admin-only data (no public cache tag): refresh the admin page. Server Actions only. */
export function invalidateUsers(): void {
  revalidatePath("/admin/usuarios");
}
