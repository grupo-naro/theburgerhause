"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

/**
 * "Are we taking orders?" for client code (Task 4.2 disables add-to-cart with
 * it). The flag is read UNCACHED on the server inside a Suspense hole
 * (ClosedBanner), so it reaches the client through a tiny external store:
 * the provider lives in the prerendered shell, the banner reports into it.
 */
type Store = {
  get: () => boolean;
  set: (open: boolean) => void;
  subscribe: (cb: () => void) => () => void;
};

function createStore(): Store {
  let open = true;
  const subs = new Set<() => void>();
  return {
    get: () => open,
    set: (next) => {
      if (next === open) return;
      open = next;
      subs.forEach((cb) => cb());
    },
    subscribe: (cb) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
  };
}

const StoreStatusContext = createContext<Store | null>(null);

export function StoreStatusProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createStore);
  return <StoreStatusContext.Provider value={store}>{children}</StoreStatusContext.Provider>;
}

const noopSubscribe = () => () => {};

/** `true` while orders are accepted (also the optimistic default before the flag streams in). */
export function useOrdersOpen(): boolean {
  const store = useContext(StoreStatusContext);
  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.get ?? (() => true),
    () => true,
  );
}

/** Used by the closed notice: tells the provider orders are paused while it is mounted. */
export function useReportOrdersClosed(): void {
  const store = useContext(StoreStatusContext);
  useEffect(() => {
    store?.set(false);
    return () => store?.set(true);
  }, [store]);
}
