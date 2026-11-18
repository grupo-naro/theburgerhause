import type { ReactNode } from "react";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { StockSubnav } from "./_components/stock-subnav";

export default async function StockLayout({ children }: { children: ReactNode }) {
  const session = await requireSessionOrRedirect(["admin", "encargado"], "/admin/stock");
  return (
    <div className="flex flex-col gap-5">
      <StockSubnav isAdmin={session.user.role === "admin"} />
      {children}
    </div>
  );
}
