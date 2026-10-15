import type { Metadata } from "next";
import { MenuContent } from "@/components/menu/menu-content";

export const metadata: Metadata = {
  title: "The Burger House 828 — Pedí online",
  description:
    "Mirá la carta de The Burger House 828, armá tu hamburguesa a tu gusto y hacé tu pedido online para retirar o recibir en tu casa.",
};

/** The menu comes from the layout's MenuProvider (no second fetch). */
export default function HomePage() {
  return <MenuContent />;
}
