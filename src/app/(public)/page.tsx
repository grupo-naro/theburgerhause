import type { Metadata } from "next";
import { Suspense } from "react";
import { MenuContent } from "@/components/menu/menu-content";
import { MenuSkeleton } from "@/components/menu/menu-skeleton";

export const metadata: Metadata = {
  title: "The Burger House 828 — Pedí online",
  description:
    "Mirá la carta de The Burger House 828, armá tu hamburguesa a tu gusto y hacé tu pedido online para retirar o recibir en tu casa.",
};

export default function HomePage() {
  return (
    <Suspense fallback={<MenuSkeleton />}>
      <MenuContent />
    </Suspense>
  );
}
