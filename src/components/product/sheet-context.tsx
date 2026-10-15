"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CartGroup } from "@/lib/cart/types";
import { ProductSheet } from "./product-sheet";

export type OpenSheetOptions = {
  /** Cart group to edit (edit mode). */
  editGroup?: CartGroup;
  /** Element to give the focus back to on close; defaults to the element focused when opening. */
  opener?: Element | null;
};

type SheetApi = {
  open: (productId: number, options?: OpenSheetOptions) => void;
  close: () => void;
};

type Request = { productId: number; editGroup?: CartGroup; nonce: number };

const SheetContext = createContext<SheetApi | null>(null);

/** Owns the single product sheet of the storefront and remembers who opened it. */
export function ProductSheetProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const opener = useRef<Element | null>(null);
  const nonce = useRef(0);

  const open = useCallback<SheetApi["open"]>((productId, options = {}) => {
    opener.current = options.opener ?? document.activeElement;
    nonce.current += 1;
    setRequest({ productId, editGroup: options.editGroup, nonce: nonce.current });
  }, []);
  const close = useCallback(() => setRequest(null), []);

  // Return focus to the opener once the sheet is gone (the opener may have been replaced meanwhile).
  useEffect(() => {
    if (request) return;
    const el = opener.current;
    opener.current = null;
    if (el instanceof HTMLElement && el.isConnected) el.focus({ preventScroll: true });
  }, [request]);

  const api = useMemo(() => ({ open, close }), [open, close]);

  return (
    <SheetContext.Provider value={api}>
      {children}
      {request && <ProductSheet key={request.nonce} request={request} onClose={close} />}
    </SheetContext.Provider>
  );
}

export function useProductSheet(): SheetApi {
  const value = useContext(SheetContext);
  if (!value) throw new Error("useProductSheet must be used inside <ProductSheetProvider>");
  return value;
}
