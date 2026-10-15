import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { UserForm } from "../_components/user-form";

export const metadata = { title: "Nuevo usuario · Administración" };

export default async function NewUserPage() {
  await requireSessionOrRedirect(["admin"], "/admin/usuarios/nuevo");
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Nuevo usuario</h1>
      <UserForm initial={{ name: "", username: "", role: "cajera", active: true }} />
    </section>
  );
}
