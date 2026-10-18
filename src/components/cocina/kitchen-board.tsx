"use client";

import { SoundHintBanner, SoundToggle } from "@/components/caja/sound-controls";
import { useNewOrderAlert } from "@/components/caja/use-new-order-alert";
import { useServerClock } from "./use-server-clock";
import { canActOn, type KitchenCardDto } from "@/lib/cocina/card-style";
import type { KitchenThresholds } from "@/lib/orders/kitchen-age";
import type { Sector } from "@/lib/orders/sector";
import { KitchenCard } from "./kitchen-card";
import { RecentlyReady } from "./recently-ready";

type Props = {
  cards: KitchenCardDto[];
  recent: KitchenCardDto[];
  serverNow: string;
  thresholds: KitchenThresholds;
  /** The sector the user may act in (null = any: cocina, admin). */
  actorSector: Sector | null;
  /** True for the kitchen device: the board owns the tab title. Staff in the normal shell keep the shell alert's title. */
  ownsTitle: boolean;
  /** Set when the user cannot act at all (e.g. a cashier with no station): the board is read-only and says why. */
  blockedReason: string | null;
};

/**
 * The kitchen screen body. It opens NO event stream: the staff shell's LiveRefresh re-renders the page with fresh
 * data (exactly one EventSource per page). Local state is only the new-card alert and the undo strip.
 */
export function KitchenBoard({ cards, recent, serverNow, thresholds, actorSector, ownsTitle, blockedReason }: Props) {
  const now = useServerClock(serverNow);
  const alert = useNewOrderAlert(
    cards.map((c) => ({ id: c.id, number: c.number, createdAt: c.since })),
    "Cocina",
    { reminders: false, manageTitle: ownsTitle },
  );
  const canAct = (c: KitchenCardDto) => blockedReason === null && canActOn(actorSector, c.type);

  return (
    <div data-testid="kitchen-board" className="rounded-3xl bg-[#0b1220] text-white">
      <div className="flex flex-wrap items-center gap-3 pb-3">
        <h1 className="font-display text-3xl font-extrabold text-white">
          En preparación <span data-testid="kitchen-count" className="text-cheddar-400 tabular-nums">{cards.length}</span>
        </h1>
        <div className="ml-auto">
          <SoundToggle dark on={alert.soundOn} onToggle={alert.toggleSound} />
        </div>
      </div>
      {blockedReason !== null && (
        <p role="alert" data-testid="kitchen-blocked" className="mb-3 rounded-2xl border-2 border-cheddar-400 bg-cheddar-400/15 px-5 py-3 text-lg font-bold">
          {blockedReason}
        </p>
      )}
      <SoundHintBanner dark hint={alert.hint} onEnable={alert.toggleSound} />
      <p aria-live="polite" role="status" data-testid="kitchen-announcer" className="sr-only">
        {alert.announcement}
      </p>

      {cards.length === 0 ? (
        <div data-testid="kitchen-empty" className="grid min-h-64 place-items-center rounded-2xl border-2 border-dashed border-white/25 px-6 py-12 text-center">
          <div>
            <p className="font-display text-4xl font-extrabold text-white">Sin pedidos en preparación</p>
            <p className="mt-2 text-xl text-white/70">Cuando se apruebe un pedido aparece acá.</p>
          </div>
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] items-start gap-4">
          {cards.map((c) => (
            <li key={c.id} className="min-w-0">
              <KitchenCard card={c} now={now} thresholds={thresholds} canAct={canAct(c)} fresh={alert.freshIds.has(c.id)} />
            </li>
          ))}
        </ul>
      )}

      <RecentlyReady cards={recent} canAct={canAct} />
    </div>
  );
}
