"use client";

import { createContext, useContext, type ReactNode } from "react";
import { MenuProvider } from "@/components/menu/menu-provider";
import type { PublicMenu } from "@/lib/menu/public";

const EditorAvailable = createContext(false);

/**
 * Gives the order editor its product picker: provides the (cached) public menu and tells the cards the
 * edit / add buttons can be shown. Screens without it (e.g. the plain dispatch board) simply show no button.
 */
export function EditorMenuProvider({ menu, children }: { menu: PublicMenu; children: ReactNode }) {
  return (
    <MenuProvider menu={menu}>
      <EditorAvailable.Provider value>{children}</EditorAvailable.Provider>
    </MenuProvider>
  );
}

export function useEditorAvailable(): boolean {
  return useContext(EditorAvailable);
}
