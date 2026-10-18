import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { LiveRefresh } from "@/components/live/live-refresh";
import { LogoutButton } from "@/components/logout-button";
import { roleHome } from "@/lib/auth/login";
import type { AuthSession } from "@/lib/auth/roles";

/**
 * The kitchen screen's own frame, the SAME for every role that opens it: dark, no sidebar, no navigation, no station
 * name, no printer indicator, so the board can fill a whole monitor in fullscreen (F11). It owns the page's ONE live
 * connection (`LiveRefresh`). The `cocina` role gets "Cerrar sesión"; everyone else a discreet "Salir" to their home.
 * The shell's new-web-order alert is intentionally absent here: this screen is for the kitchen only.
 */
export function KitchenShell({ session, children }: { session: AuthSession; children: ReactNode }) {
  const isKitchen = session.user.role === "cocina";
  return (
    <div data-testid="kitchen-shell" className="flex min-h-dvh flex-col bg-[#0b1220] text-white">
      <header className="flex items-center gap-3 px-3 py-2 sm:px-4">
        <Image src="/brand/logo-512.webp" alt="" width={32} height={32} className="size-8 rounded-full bg-white" />
        <p className="font-display text-xl leading-tight font-extrabold text-cheddar-400">Cocina</p>
        <div className="ml-auto flex items-center gap-3">
          <LiveRefresh dark />
          <span data-testid="user-name" className="hidden text-sm font-semibold text-white/70 md:inline">
            {session.user.name}
          </span>
          {isKitchen ? (
            <LogoutButton dark />
          ) : (
            <Link
              href={roleHome(session.user.role)}
              data-testid="kitchen-exit"
              className="inline-flex min-h-12 items-center rounded-full border border-white/30 px-4 text-sm font-semibold text-white/80 hover:bg-white/10"
            >
              Salir
            </Link>
          )}
        </div>
      </header>
      <main className="min-w-0 flex-1 px-3 pb-3 sm:px-4">{children}</main>
    </div>
  );
}
