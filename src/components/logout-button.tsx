import { logout } from "@/app/(staff)/logout/actions";

export function LogoutButton({ dark = false, className = "" }: { dark?: boolean; className?: string }) {
  return (
    <form action={logout} className={className ? "w-full" : undefined}>
      <button
        type="submit"
        className={`${className} rounded-full border px-4 py-2 font-medium whitespace-nowrap ${
          dark ? "min-h-14 border-white/40 bg-transparent text-white hover:bg-white/10" : "border-line bg-surface text-ink hover:bg-brand-50"
        }`}
      >
        Cerrar sesión
      </button>
    </form>
  );
}
