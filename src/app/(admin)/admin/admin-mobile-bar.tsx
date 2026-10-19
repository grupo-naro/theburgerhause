"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { LogoutButton } from "@/components/logout-button";
import type { Role } from "@/lib/auth/roles";
import { adminLinksFor } from "./admin-nav";

const FOCUSABLE = "a[href], button:not([disabled])";

/**
 * Below `md`: a sticky top bar (☰ + current section) and a side drawer with every admin section,
 * the way back to the operation area and "Cerrar sesión". From `md` up it is not rendered visible
 * (the shell shows the sidebar instead).
 */
export function AdminMobileBar({ userName, role, homeHref }: { userName: string; role: Role; homeHref: string }) {
  const pathname = usePathname();
  // The drawer is open only on the page where it was opened: navigating closes it with no effect.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const drawerId = useId();
  const links = adminLinksFor(role);
  const current = links.find((l) => pathname === l.href || pathname.startsWith(`${l.href}/`));

  const close = () => {
    setOpenedOn(null);
    triggerRef.current?.focus();
  };

  // Lock the page scroll while the drawer is open, and close it if the viewport grows to desktop.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const mq = window.matchMedia("(min-width: 48rem)");
    const onChange = () => {
      if (mq.matches) setOpenedOn(null);
    };
    mq.addEventListener("change", onChange);
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      document.body.style.overflow = previous;
      mq.removeEventListener("change", onChange);
    };
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      data-testid="admin-mobile-bar"
      className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-surface px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] md:hidden"
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label="Abrir menú"
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={() => setOpenedOn(pathname)}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-xl text-ink hover:bg-brand-50"
      >
        <span aria-hidden="true">☰</span>
      </button>
      <span className="min-w-0 flex-1 truncate font-display text-lg font-extrabold text-brand-600">
        {current?.label ?? "Administración"}
      </span>

      {open && (
        <div id={drawerId} role="dialog" aria-modal="true" aria-label="Menú de administración" onKeyDown={onKeyDown} className="fixed inset-0 z-40">
          <div data-testid="admin-drawer-backdrop" onClick={close} className="absolute inset-0 bg-ink/50" />
          <div
            ref={panelRef}
            className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col gap-4 overflow-y-auto bg-surface px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] shadow-xl"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-display text-xl font-extrabold text-brand-600">Administración</span>
              <button
                type="button"
                aria-label="Cerrar menú"
                onClick={close}
                className="inline-flex size-11 items-center justify-center rounded-full border border-line text-xl text-ink hover:bg-brand-50"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
            <p className="-mt-2 truncate text-sm text-ink-muted">{userName}</p>
            <nav aria-label="Secciones de administración">
              <ul className="flex flex-col gap-1">
                {links.map((l) => {
                  const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
                  return (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex min-h-12 items-center rounded-xl px-4 text-base font-semibold ${
                          active ? "bg-brand-600 text-white" : "text-ink hover:bg-brand-50"
                        }`}
                      >
                        {l.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <div className="mt-auto flex flex-col gap-2 border-t border-line pt-4">
              <Link
                href={homeHref}
                className="flex min-h-12 items-center rounded-xl px-4 text-base font-semibold text-ink hover:bg-brand-50"
              >
                Volver a operación
              </Link>
              <LogoutButton className="min-h-12 w-full" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
