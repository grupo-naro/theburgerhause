import { revalidatePath } from "next/cache";

/** Stations are admin-only data (no public cache tag): refresh the admin page. Server Actions only. */
export function invalidateStations(): void {
  revalidatePath("/admin/estaciones");
}
