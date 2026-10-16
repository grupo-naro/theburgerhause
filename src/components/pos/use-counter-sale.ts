"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createCounterOrderAction } from "@/app/(staff)/mostrador/actions";
import { useCart } from "@/components/cart/cart-provider";
import { useMenuIndex } from "@/components/menu/menu-provider";
import { toOrderUnits } from "@/lib/cart/order-input";
import { createKeyHolder } from "@/lib/checkout/idempotency";
import { describeUnitIssues, unavailableLineIds } from "@/lib/checkout/unit-issues";
import type { ActivePager } from "@/lib/orders/pagers";
import { chargeState } from "@/lib/pos/can-charge";
import { changeFor, parsePesosInput } from "@/lib/pos/change";
import { ticketTotals } from "@/lib/pos/fast-path";
import { posSignature } from "@/lib/pos/order-signature";
import { pagerKey, pagerValue, type PagerKey } from "@/lib/pos/pager-keypad";
import { conflictMessage, holderOf, suggestPager } from "@/lib/pos/pagers";
import type { PaymentMethod } from "./payment-section";

export type Confirmation = {
  orderId: number;
  number: number;
  pager: number;
  total: number;
  payment: PaymentMethod;
};

const NETWORK_MESSAGE = "No pudimos conectarnos. Revisá la conexión y probá de nuevo: el ticket sigue intacto.";
const KEY_STORAGE_PREFIX = "bh_pos_key_v1:";

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

type Args = {
  pagers: ActivePager[];
  refreshPagers: () => Promise<void>;
  stationId: number | null;
};

/**
 * Everything the cashier does to turn the ticket into a paid order: payment / pager / name inputs
 * (component state only, never persisted), the charge rule, the idempotent submit and the mapping
 * of every server answer. The ticket itself lives in the POS cart (CartProvider).
 */
export function useCounterSale({ pagers, refreshPagers, stationId }: Args) {
  const cart = useCart();
  const index = useMenuIndex();
  const router = useRouter();

  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  const [pagerText, setPagerText] = useState("");
  const [name, setName] = useState("");
  const [receivedText, setReceivedText] = useState("");
  const [pagerError, setPagerError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unitMessages, setUnitMessages] = useState<string[] | null>(null);
  const [stationMissing, setStationMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [, startTransition] = useTransition();
  /** Synchronous guard: a double click / double Ctrl+Enter in the same tick must reach the server once. */
  const inFlight = useRef(false);
  const keyHolder = useRef<ReturnType<typeof createKeyHolder> | null>(null);

  const pager = pagerValue(pagerText);
  const holder = holderOf(pagers, pager);
  const conflict = holder && pager !== null ? conflictMessage(pager, holder) : pagerError;
  const totals = useMemo(() => ticketTotals(cart.lines, index), [cart.lines, index]);
  const received = parsePesosInput(receivedText);
  const change = payment === "cash" ? changeFor(totals.total, received) : changeFor(totals.total, null);
  const charge = chargeState({
    lineCount: cart.count,
    payment,
    pager,
    pagerHolder: holder,
    inFlight: busy,
    hasStation: stationId !== null,
  });
  const nextFree = suggestPager(pagers);

  // The latest values for the stable callbacks below (read at call time, never stale).
  const latest = useRef({ charge, payment, pager, name, cart, index });
  useEffect(() => {
    latest.current = { charge, payment, pager, name, cart, index };
  });

  function typePagerKey(key: PagerKey) {
    setPagerError(null);
    setPagerText((t) => pagerKey(t, key));
  }
  function typePagerText(text: string) {
    setPagerError(null);
    setPagerText(text.split("").reduce((acc, ch) => (/^[0-9]$/.test(ch) ? pagerKey(acc, ch as PagerKey) : acc), ""));
  }
  function pickNextFree() {
    if (nextFree === null) return;
    setPagerError(null);
    setPagerText(String(nextFree));
  }

  function submit() {
    const cur = latest.current;
    if (inFlight.current || !cur.charge.canCharge || cur.payment === null || cur.pager === null) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    setUnitMessages(null);
    setStationMissing(false);

    const sentLines = cur.cart.lines;
    const units = toOrderUnits(sentLines);
    keyHolder.current ??= createKeyHolder(sessionStore(), undefined, `${KEY_STORAGE_PREFIX}${stationId ?? "none"}`);
    const key = keyHolder.current.get(posSignature({ units, payment: cur.payment, pager: cur.pager, name: cur.name }));
    const sent = { payment: cur.payment, pager: cur.pager };

    startTransition(async () => {
      try {
        const r = await createCounterOrderAction({
          idempotencyKey: key,
          units,
          paymentMethod: sent.payment,
          pagerNumber: sent.pager,
          customerName: cur.name.trim() || undefined,
        });
        if (r.ok) {
          // Paid. The overlay is up; `inFlight` stays true until "Nuevo pedido" (no second charge).
          keyHolder.current?.clear();
          cur.cart.clear();
          setConfirmation({
            orderId: r.data.orderId,
            number: r.data.number,
            pager: r.data.pagerNumber,
            total: r.data.total,
            payment: r.data.paymentMethod,
          });
          void refreshPagers();
          return;
        }
        inFlight.current = false;
        setBusy(false);
        switch (r.code) {
          case "PAGER_IN_USE":
            setPagerError(r.message.replace(/^El llamador (\d+) ya está en uso/, "Llamador $1 en uso"));
            void refreshPagers();
            break;
          case "UNITS_INVALID": {
            const names = new Map([...cur.index.products].map(([id, p]) => [id, p.name]));
            const issues = r.unitIssues ?? [];
            setUnitMessages(describeUnitIssues(issues, units, names));
            // Same approach as the checkout: the indexes refer to the snapshot of lines that was SENT.
            const ids = new Set(unavailableLineIds(issues, sentLines));
            for (const i of issues) {
              const line = sentLines[i.unitIndex];
              if (line) ids.add(line.id);
            }
            if (ids.size > 0) cur.cart.removeLines([...ids]);
            router.refresh();
            break;
          }
          case "STATION_REQUIRED":
            setStationMissing(true);
            break;
          default:
            setMessage(r.message || "No se pudo cobrar. Probá de nuevo.");
        }
      } catch {
        inFlight.current = false;
        setBusy(false);
        setMessage(NETWORK_MESSAGE);
      }
    });
  }

  /** "Nuevo pedido": forget the finished sale and reset every per-sale input. */
  function newSale() {
    setConfirmation(null);
    setPayment(null);
    setPagerText("");
    setName("");
    setReceivedText("");
    setPagerError(null);
    setMessage(null);
    setUnitMessages(null);
    keyHolder.current?.clear();
    inFlight.current = false;
    setBusy(false);
    void refreshPagers();
  }

  function choosePayment(method: PaymentMethod) {
    setPayment(method);
    if (method !== "cash") setReceivedText("");
  }

  return {
    payment,
    choosePayment,
    pagerText,
    pager,
    conflict,
    nextFree,
    typePagerKey,
    typePagerText,
    pickNextFree,
    name,
    setName,
    receivedText,
    setReceivedText,
    change,
    totals,
    charge,
    busy,
    message,
    unitMessages,
    dismissUnitMessages: () => setUnitMessages(null),
    stationMissing,
    confirmation,
    submit,
    newSale,
  };
}
