"use client";

import { useEffect, useRef, useState } from "react";
import type { OrdersEvent, StockEvent } from "./channels";
import { createLiveClient, type LiveState } from "./client-state";

export type UseLiveEventsOptions = {
  onOrders?: (event: OrdersEvent) => void;
  /** A stock balance changed (shortage alert, stock screens). */
  onStock?: (event: StockEvent) => void;
  /** Called on server `resync` events, on every reconnect and by the fallback poll while offline. */
  onResync?: () => void;
};

/**
 * Connects to /api/events and reports the connection state. The policy lives in client-state.ts;
 * this only wires it to the browser (EventSource, timers) and tears everything down on unmount.
 * Callbacks may change on every render without reconnecting.
 */
export function useLiveEvents({ onOrders, onStock, onResync }: UseLiveEventsOptions = {}): LiveState {
  const [state, setState] = useState<LiveState>("connecting");
  const handlers = useRef({ onOrders, onStock, onResync });

  useEffect(() => {
    handlers.current = { onOrders, onStock, onResync };
  });

  useEffect(() => {
    const client = createLiveClient({
      url: "/api/events",
      createSource: (url) => new EventSource(url),
      schedule: (fn, ms) => window.setTimeout(fn, ms),
      cancel: (handle) => window.clearTimeout(handle as number),
      onOrders: (e) => handlers.current.onOrders?.(e),
      onStock: (e) => handlers.current.onStock?.(e),
      onResync: () => handlers.current.onResync?.(),
      onState: setState,
    });
    client.start();
    return () => client.stop();
  }, []);

  return state;
}
