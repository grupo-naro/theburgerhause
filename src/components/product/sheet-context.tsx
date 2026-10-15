"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Product sheet entry point. Task 4.2 replaces this stub with the real
 * bottom sheet; cards already call `openProduct(id)` through the hook.
 */
type SheetApi = { openProduct: (productId: number) => void };

const noop: SheetApi = { openProduct: () => {} };
const SheetContext = createContext<SheetApi>(noop);

export function ProductSheetProvider({ children }: { children: ReactNode }) {
  return <SheetContext.Provider value={noop}>{children}</SheetContext.Provider>;
}

export function useProductSheet(): SheetApi {
  return useContext(SheetContext);
}
