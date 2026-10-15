"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Product sheet entry point. Task 4.2 replaces this stub with the real
 * bottom sheet; cards already call `openProduct(id)` through the hook.
 */
type SheetApi = { openProduct: (productId: number) => void };

const noop: SheetApi = { openProduct: () => {} };
const SheetContext = createContext<SheetApi>(noop);

export function ProductSheetProvider({ children }: { children: ReactNode }) {
  const api = useMemo<SheetApi>(() => ({ openProduct: () => {} }), []);
  return <SheetContext.Provider value={api}>{children}</SheetContext.Provider>;
}

export function useProductSheet(): SheetApi {
  return useContext(SheetContext);
}
