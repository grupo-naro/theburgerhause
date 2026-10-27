import type { ReactNode } from "react";
import { StockSubnav } from "./_components/stock-subnav";

export default function StockLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <StockSubnav />
      {children}
    </div>
  );
}
