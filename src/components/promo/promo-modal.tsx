"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CloseIcon } from "@/components/menu/icons";
import { hasSeenPromo, markPromoSeen } from "@/lib/promo/seen";
import type { PublicPromo } from "@/lib/promo/public";
import { isPromoRoute } from "@/lib/promo/window";

const noopSubscribe = () => () => {};

/**
 * Advertising modal, shown once per tab session on the first store page of the visit, and only on the
 * home. Landing straight on the cart, checkout or order tracking counts as "the visit started
 * elsewhere": it is marked seen and never pops up later. It renders after hydration and only opens once
 * its image has loaded (a native modal <dialog> lives in the top layer: nothing behind it moves).
 */
export function PromoModal({ promo }: { promo: Pick<PublicPromo, "version" | "imageUrl" | "title"> }) {
  const pathname = usePathname();
  const [landing] = useState(pathname);
  const [ready, setReady] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pointerDownOnBackdrop = useRef(false);
  const { version } = promo;

  // Client-only facts (sessionStorage): false on the server and while hydrating, so nothing mismatches.
  // Closing marks the flag and re-renders, so the snapshot flips to false.
  const eligible = useSyncExternalStore(
    noopSubscribe,
    () => isPromoRoute(landing) && !hasSeenPromo(version),
    () => false,
  );
  const open = eligible && ready && pathname === landing;

  useEffect(() => {
    if (!isPromoRoute(landing)) markPromoSeen(version); // the visit started on another page
  }, [landing, version]);

  // The dialog is mounted while eligible but stays closed (display: none) until the image loaded.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    if (!dialog.open) dialog.showModal();
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = previousOverflow;
    };
  }, [open]);

  // Back/forward must not leave the modal over another page, nor bring it back later.
  useEffect(() => {
    if (pathname !== landing) markPromoSeen(version);
  }, [pathname, landing, version]);

  const [closed, setClosed] = useState(false);
  const finish = () => {
    markPromoSeen(version);
    setClosed(true);
  };

  if (!eligible || closed || pathname !== landing) return null;
  const label = promo.title ?? "Promoción";
  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      data-testid="promo-modal"
      onClose={finish}
      onPointerDown={(e) => {
        pointerDownOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pointerDownOnBackdrop.current) dialogRef.current?.close();
      }}
      className="m-auto max-h-[96dvh] w-[calc(100%-1.5rem)] max-w-md flex-col overflow-hidden rounded-2xl border-0 bg-surface p-0 text-ink backdrop:bg-ink/60 open:flex md:max-w-[28rem]"
    >
      <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-line py-1 pl-4 pr-2">
        {promo.title ? (
          <h2 data-testid="promo-title" className="min-w-0 font-display text-lg font-extrabold leading-tight [overflow-wrap:anywhere]">
            {promo.title}
          </h2>
        ) : null}
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Cerrar"
          className="ml-auto grid size-11 shrink-0 place-items-center rounded-full text-ink transition-colors hover:bg-brand-50"
        >
          <CloseIcon className="size-5" />
        </button>
      </div>
      <div className="flex min-h-0 justify-center overflow-y-auto bg-surface">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          // Cached images can finish loading before React attaches onLoad: check as soon as it mounts.
          ref={(img) => {
            if (img?.complete && img.naturalWidth > 0) setReady(true);
          }}
          src={promo.imageUrl}
          alt={label}
          decoding="async"
          onLoad={() => setReady(true)}
          onError={finish}
          className="block h-auto max-h-[80dvh] w-full object-contain"
        />
      </div>
    </dialog>
  );
}
