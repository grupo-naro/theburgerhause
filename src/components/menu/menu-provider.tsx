"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { buildMenuIndex, type MenuIndex } from "@/lib/cart/pricing";
import type { PublicMenu } from "@/lib/menu/public";

type MenuValue = { menu: PublicMenu; index: MenuIndex };
const MenuContext = createContext<MenuValue | null>(null);

/**
 * Hands the (cached, serializable) public menu to client code once, so the home page, the cart
 * and the product sheet share one copy. Receives it from a server component that awaits `getMenu()`.
 */
export function MenuProvider({ menu, children }: { menu: PublicMenu; children: ReactNode }) {
  const value = useMemo(() => ({ menu, index: buildMenuIndex(menu) }), [menu]);
  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

function useMenuValue(): MenuValue {
  const value = useContext(MenuContext);
  if (!value) throw new Error("useMenu must be used inside <MenuProvider>");
  return value;
}

export function useMenu(): PublicMenu {
  return useMenuValue().menu;
}

/** Product / modifier lookup built once per menu. */
export function useMenuIndex(): MenuIndex {
  return useMenuValue().index;
}
