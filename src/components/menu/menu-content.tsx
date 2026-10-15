"use client";

import { MenuBrowser } from "./menu-browser";
import { useMenu } from "./menu-provider";
import { StatePanel } from "./state-panel";

/** Reads the menu the layout already provides (one cached fetch, shared with the cart). */
export function MenuContent() {
  const menu = useMenu();
  if (menu.categories.length === 0) {
    return <StatePanel title="Estamos actualizando nuestra carta">Volvé en unos minutos para ver las novedades.</StatePanel>;
  }
  return <MenuBrowser menu={menu} />;
}
