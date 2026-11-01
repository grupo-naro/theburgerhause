import { revalidatePath } from "next/cache";

/** After any stock write: the admin stock screens are dynamic, so refresh the whole section. */
export function revalidateStockPages(): void {
  revalidatePath("/admin/stock", "layout");
}

/** After a rendición: the admin shell (every admin page) shows the "rendición pendiente" reminder. */
export function revalidateAdminShell(): void {
  revalidatePath("/admin", "layout");
}
