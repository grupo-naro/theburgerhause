import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { getLockedNames } from "@/lib/analytics/locked-names";
import { resolvePeriod } from "@/lib/analytics/period";
import { getAnalyticsUnlock, hasAnalyticsPin } from "@/lib/analytics/pin";
import { getHeatmap, getKpis, getSellers, getTopProducts } from "@/lib/analytics/queries";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { getBusinessDayCutoff } from "@/lib/settings";
import {
  HeatmapBlock,
  KpiCards,
  LockedHeatmap,
  LockedKpiCards,
  LockedSellersTable,
  LockedTopProducts,
  SellersTable,
  TopProducts,
} from "./_components/blocks";
import { CategoryFilter } from "./_components/category-filter";
import { PeriodBar } from "./_components/period-bar";
import { PinGate } from "./_components/pin-gate";
import { UnlockCountdown } from "./_components/unlock-countdown";

export const metadata = { title: "Analíticas · Administración" };

export default async function AdminAnalyticsPage({ searchParams }: PageProps<"/admin/analiticas">) {
  const session = await requireSessionOrRedirect(["admin"], "/admin/analiticas");
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v : undefined;
  };
  const db = getDb();
  const cutoff = await getBusinessDayCutoff(db);
  const period = resolvePeriod({ p: one("p"), desde: one("desde"), hasta: one("hasta") }, new Date(), cutoff);
  const catRaw = one("cat");
  const categoryId = catRaw && /^\d{1,9}$/.test(catRaw) ? Number(catRaw) : undefined;
  const cat = categoryId === undefined ? undefined : String(categoryId);

  // The unlock is checked BEFORE any sales query: locked, none of them runs.
  const [until, categories] = await Promise.all([
    getAnalyticsUnlock(db, session.sessionId),
    db.select({ id: s.categories.id, name: s.categories.name }).from(s.categories).orderBy(asc(s.categories.sort), asc(s.categories.id)),
  ]);
  const keep =
    period.kind === "custom" ? { p: "custom", desde: period.from, hasta: period.to } : { p: period.kind };
  const filter = <CategoryFilter categories={categories} value={cat} keep={keep} />;

  const header = (
    <>
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Analíticas</h1>
    </>
  );

  if (!until) {
    const [names, hasPin] = await Promise.all([getLockedNames(db, { categoryId }), hasAnalyticsPin(db)]);
    return (
      <section className="flex flex-col gap-5">
        {header}
        <PeriodBar period={period} cat={cat} right={<span className="text-sm font-semibold">🔒 Bloqueado</span>} />
        <PinGate hasPin={hasPin} />
        <LockedKpiCards />
        <div className="grid gap-4 lg:grid-cols-2">
          <LockedTopProducts names={names.products} filter={filter} />
          <LockedHeatmap />
        </div>
        <LockedSellersTable names={names.sellers} />
      </section>
    );
  }

  const [kpis, top, heatmap, sellers] = await Promise.all([
    getKpis(db, period),
    getTopProducts(db, period, { categoryId }),
    getHeatmap(db, period, cutoff),
    getSellers(db, period),
  ]);
  return (
    <section className="flex flex-col gap-5">
      {header}
      <PeriodBar period={period} cat={cat} right={<UnlockCountdown untilIso={until.toISOString()} />} />
      <KpiCards data={kpis} />
      <div className="grid gap-4 lg:grid-cols-2">
        <TopProducts rows={top} filter={filter} />
        <HeatmapBlock data={heatmap} />
      </div>
      <SellersTable rows={sellers} />
    </section>
  );
}
