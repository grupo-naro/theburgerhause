import Link from "next/link";
import { Suspense } from "react";
import { getDb } from "@/db/client";
import { BalanceList } from "@/components/rendicion/balance-list";
import { CadetDetail } from "@/components/rendicion/cadet-detail";
import { StaffShell, StaffShellFallback } from "@/components/staff/staff-shell";
import { requireWorkspace } from "@/lib/auth/workspace";
import { getCadetSettlementDetail, listCadetBalances, listSettlements } from "@/lib/settlements/queries";

export const metadata = { title: "Rendición · The Burger House 828" };

const INT4_MAX = 2_147_483_647;
const HISTORY_PAGE = 10;
const HISTORY_ALL = 100;

/** `?cadet=` -> a positive int4, or null (absent / garbage / repeated). */
function parseCadetParam(raw: string | string[] | undefined): number | null | "invalid" {
  if (raw === undefined) return null;
  if (typeof raw !== "string" || !/^\d{1,10}$/.test(raw)) return "invalid";
  const n = Number(raw);
  return n > 0 && n <= INT4_MAX ? n : "invalid";
}

function NotFound() {
  return (
    <div data-testid="cadet-not-found" className="mx-auto max-w-xl space-y-4 rounded-2xl border border-line bg-surface px-6 py-10 text-center">
      <h1 className="font-display text-3xl font-extrabold">No encontramos a ese cadete</h1>
      <p className="text-lg text-ink-muted">El enlace puede estar mal o el cadete ya no existe.</p>
      <Link href="/delivery/rendicion" className="inline-flex min-h-14 items-center rounded-full bg-brand-600 px-6 font-display text-lg font-bold text-white hover:bg-brand-700">
        Volver a rendiciones
      </Link>
    </div>
  );
}

async function RendicionPage({ searchParams }: PageProps<"/delivery/rendicion">) {
  const { session } = await requireWorkspace("delivery", ["encargada_delivery", "admin"], "/delivery/rendicion");

  const sp = await searchParams;
  const cadet = parseCadetParam(sp.cadet);
  const now = new Date();
  const db = getDb();

  let content;
  if (cadet === null) {
    const balances = await listCadetBalances(db);
    content = (
      <>
        <h1 className="mb-5 font-display text-3xl font-extrabold">Rendición de cadetes</h1>
        <BalanceList balances={balances} now={now} />
      </>
    );
  } else {
    const detail = cadet === "invalid" ? null : await getCadetSettlementDetail(db, cadet, { now });
    if (!detail) {
      content = <NotFound />;
    } else {
      const all = sp.historial === "todas";
      // One row more than a page tells whether "Ver todas" has anything to show.
      const fetched = await listSettlements(db, { cadetId: detail.cadet.id, limit: all ? HISTORY_ALL : HISTORY_PAGE + 1 });
      const hasMore = !all && fetched.length > HISTORY_PAGE;
      const recent = hasMore ? fetched.slice(0, HISTORY_PAGE) : fetched;
      content = (
        <CadetDetail
          detail={{ ...detail, recentSettlements: recent }}
          serverNow={now.toISOString()}
          settledByName={session.user.name}
          historyAll={all}
          historyHasMore={hasMore}
          historyCapped={all && recent.length >= HISTORY_ALL}
        />
      );
    }
  }

  return <StaffShell session={session}>{content}</StaffShell>;
}

/** Dynamic (cookies + DB): everything runs inside Suspense; the guards run in the page itself. */
export default function Page(props: PageProps<"/delivery/rendicion">) {
  return (
    <Suspense fallback={<StaffShellFallback />}>
      <RendicionPage {...props} />
    </Suspense>
  );
}
