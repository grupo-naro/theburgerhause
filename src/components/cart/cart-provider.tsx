"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMenuIndex } from "@/components/menu/menu-provider";
import { groupLines } from "@/lib/cart/group";
import { initCart } from "@/lib/cart/init";
import { CART_STORAGE_KEY, saveCart } from "@/lib/cart/persistence";
import { cartPreviewTotal } from "@/lib/cart/pricing";
import { reconcileCart } from "@/lib/cart/reconcile";
import { canAdd, cartReducer, emptyCart } from "@/lib/cart/reducer";
import type { CartAction, CartGroup, CartIssue, CartLine, UnitConfig } from "@/lib/cart/types";

export type CartApi = {
  lines: CartLine[];
  groups: CartGroup[];
  /** Physical units in the cart. */
  count: number;
  /** Preview only (centavos); the server re-prices. */
  subtotal: number;
  issues: CartIssue[];
  /** False until the stored cart has been loaded (first render is always the empty cart). */
  ready: boolean;
  /** Returns false (and does nothing) when a limit would be exceeded. */
  add: (productId: number, units: UnitConfig[]) => boolean;
  removeGroup: (signature: string) => void;
  setGroupQuantity: (signature: string, quantity: number) => void;
  replaceGroup: (signature: string, productId: number, units: UnitConfig[]) => void;
  clear: () => void;
  dismissIssues: () => void;
};

const CartContext = createContext<CartApi | null>(null);

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function readStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // access denied (private mode, blocked cookies)
  }
}

function readRaw(): string | null {
  try {
    return readStorage()?.getItem(CART_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * Customer cart. HYDRATION: the first render (server and client) is always the empty cart with
 * `ready=false`; the stored cart is loaded in an effect, validated and reconciled against the
 * current menu, and only then `ready` flips, so there is no mismatch and no flash of a wrong
 * count (the header badge just appears). Every change is persisted (effects already batch
 * bursts of changes into one write) and the `storage` event keeps several tabs consistent.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const index = useMenuIndex();
  const [state, dispatch] = useReducer((s: typeof emptyCart, a: CartAction) => cartReducer(s, a, newId), emptyCart);
  const [ready, setReady] = useState(false);
  const [issues, setIssues] = useState<CartIssue[]>([]);
  /** lineId -> unit total when the line was added / last seen; persisted with the cart. */
  const pricesRef = useRef<Record<string, number>>({});
  const indexRef = useRef(index);
  const loadedRef = useRef(false);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // 1) Initial load (once): storage -> validate -> reconcile against the menu.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const loaded = initCart(readRaw(), index);
    pricesRef.current = loaded.prices;
    dispatch({ type: "hydrate", lines: loaded.lines });
    setIssues(loaded.issues);
    setReady(true);
  }, [index]);

  // 2) Keep the cart consistent with the menu (menu refresh, new lines get their price snapshot).
  useEffect(() => {
    if (!ready) return;
    const r = reconcileCart(state.lines, index, { lastSeenPrices: pricesRef.current });
    pricesRef.current = r.prices;
    const changed = r.lines.length !== state.lines.length || r.lines.some((l, i) => l !== state.lines[i]);
    if (changed) dispatch({ type: "hydrate", lines: r.lines });
    if (r.issues.length > 0) setIssues((prev) => [...prev, ...r.issues]);
  }, [ready, state.lines, index]);

  // 3) Persist every change (never before the stored cart was loaded).
  useEffect(() => {
    if (!ready) return;
    saveCart(readStorage(), state, pricesRef.current);
  }, [ready, state]);

  // 4) Other tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== CART_STORAGE_KEY) return;
      const loaded = initCart(readRaw(), indexRef.current);
      pricesRef.current = loaded.prices;
      dispatch({ type: "hydrate", lines: loaded.lines });
      if (loaded.issues.length > 0) setIssues((prev) => [...prev, ...loaded.issues]);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const add = useCallback<CartApi["add"]>(
    (productId, units) => {
      if (!canAdd(state, productId, units.length, units)) return false;
      dispatch({ type: "add", productId, units });
      return true;
    },
    [state],
  );
  const removeGroup = useCallback((sig: string) => dispatch({ type: "removeGroup", signature: sig }), []);
  const setGroupQuantity = useCallback(
    (sig: string, quantity: number) => dispatch({ type: "setGroupQuantity", signature: sig, quantity }),
    [],
  );
  const replaceGroup = useCallback(
    (sig: string, productId: number, units: UnitConfig[]) =>
      dispatch({ type: "replaceGroup", signature: sig, productId, units }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: "clear" }), []);
  const dismissIssues = useCallback(() => setIssues([]), []);

  const groups = useMemo(() => groupLines(state.lines), [state.lines]);
  const subtotal = useMemo(() => cartPreviewTotal(state.lines, index).subtotal, [state.lines, index]);

  const value = useMemo<CartApi>(
    () => ({
      lines: state.lines,
      groups,
      count: state.lines.length,
      subtotal,
      issues,
      ready,
      add,
      removeGroup,
      setGroupQuantity,
      replaceGroup,
      clear,
      dismissIssues,
    }),
    [state.lines, groups, subtotal, issues, ready, add, removeGroup, setGroupQuantity, replaceGroup, clear, dismissIssues],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside <CartProvider>");
  return value;
}
