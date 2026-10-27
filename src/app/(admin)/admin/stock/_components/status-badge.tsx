import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL } from "@/lib/stock/labels";
import type { StockStatus } from "@/lib/stock/quantity";

const TONE = { ok: "success", poco: "warning", agotado: "danger" } as const;

/** Status as TEXT (never color alone): Ok / Poco / Agotado. */
export function StatusBadge({ status }: { status: StockStatus }) {
  return <Badge tone={TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
