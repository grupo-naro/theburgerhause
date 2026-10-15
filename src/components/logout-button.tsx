import { logout } from "@/app/(staff)/logout/actions";

export function LogoutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        className="rounded-full border border-line bg-surface px-4 py-2 font-medium whitespace-nowrap text-ink hover:bg-brand-50"
      >
        Cerrar sesión
      </button>
    </form>
  );
}
