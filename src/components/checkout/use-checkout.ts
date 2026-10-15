"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { createOrderAction, type ActionResult } from "@/app/(public)/checkout/actions";
import { useCart } from "@/components/cart/cart-provider";
import { useMenuIndex } from "@/components/menu/menu-provider";
import { useOrdersOpen } from "@/components/menu/store-status";
import { useToast } from "@/components/ui/toast";
import { toOrderUnits } from "@/lib/cart/order-input";
import type { CartIssue, CartLine, OrderUnitInput } from "@/lib/cart/types";
import { forgetCustomer, loadCustomer, saveCustomer } from "@/lib/checkout/customer-memory";
import {
  EMPTY_FORM,
  fieldId,
  firstInvalidField,
  humanizeErrors,
  splitFieldErrors,
  toCreateOrderInput,
  validateForm,
  type CheckoutForm,
  type FieldErrors,
  type FieldKey,
} from "@/lib/checkout/form";
import { createKeyHolder, orderSignature } from "@/lib/checkout/idempotency";
import { checkoutPreview } from "@/lib/checkout/preview";
import { failureMessage } from "@/lib/checkout/results";
import { describeUnitIssues, unavailableLineIds } from "@/lib/checkout/unit-issues";

const NETWORK_MESSAGE = "No pudimos conectarnos. Revisá tu conexión y probá de nuevo.";

function local(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Cart-page notices for units we dropped because their product is gone (one per product). */
function removedIssues(ids: readonly string[], sentLines: readonly CartLine[], names: ReadonlyMap<number, string>): CartIssue[] {
  const byProduct = new Map<number, number>();
  for (const id of ids) {
    const line = sentLines.find((l) => l.id === id);
    if (line) byProduct.set(line.productId, (byProduct.get(line.productId) ?? 0) + 1);
  }
  return [...byProduct].map(([productId, quantity]) => ({ type: "product_unavailable", productId, name: names.get(productId), quantity }));
}

/** Which inline error each form field clears when it is edited. */
const CLEARS: Record<keyof CheckoutForm, readonly FieldKey[]> = {
  fulfillment: ["delivery.address", "delivery.crossStreets", "delivery.notes"],
  name: ["customer.name"],
  whatsapp: ["customer.whatsapp"],
  address: ["delivery.address"],
  crossStreets: ["delivery.crossStreets"],
  notes: ["delivery.notes"],
  paymentMethod: ["paymentMethod"],
  bh_ref: [],
};

function focusField(key: FieldKey | null): void {
  if (key) document.getElementById(fieldId(key))?.focus();
}

/**
 * All the checkout behavior: form state, remember-me, client validation (same zod schema as the
 * server), the idempotent submit and the mapping of every server answer to something the customer
 * can act on. The server is the authority; totals shown here are only a preview.
 */
export function useCheckout(deliveryFee: number) {
  const cart = useCart();
  const index = useMenuIndex();
  const ordersOpen = useOrdersOpen();
  const router = useRouter();
  const toast = useToast();

  // Only ever mounted on the client (see CheckoutView), so reading localStorage here cannot mismatch hydration.
  const [saved] = useState(() => loadCustomer(local()));
  const [form, setForm] = useState<CheckoutForm>(() => (saved ? { ...EMPTY_FORM, ...saved } : EMPTY_FORM));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [other, setOther] = useState<string[]>([]);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [unitMessages, setUnitMessages] = useState<string[] | null>(null);
  const [unitsRemoved, setUnitsRemoved] = useState(false);
  const [remembered, setRemembered] = useState(saved !== null);
  const [placed, setPlaced] = useState(false);
  const [pending, startTransition] = useTransition();
  /** Synchronous guard: two Enter presses in the same tick must not both reach the server. */
  const inFlight = useRef(false);
  const keyHolder = useRef<ReturnType<typeof createKeyHolder> | null>(null);

  const preview = useMemo(
    () => checkoutPreview(cart.lines, index, form.fulfillment, deliveryFee),
    [cart.lines, index, form.fulfillment, deliveryFee],
  );

  function update(patch: Partial<CheckoutForm>) {
    setForm((f) => ({ ...f, ...patch }));
    const cleared = (Object.keys(patch) as (keyof CheckoutForm)[]).flatMap((k) => CLEARS[k]);
    if (cleared.length > 0 && cleared.some((k) => errors[k])) {
      setErrors((prev) => {
        const next = { ...prev };
        for (const k of cleared) delete next[k];
        return next;
      });
    }
  }

  function forget() {
    forgetCustomer(local());
    setRemembered(false);
    setForm((f) => ({ ...f, name: "", whatsapp: "", address: "", crossStreets: "", notes: "" }));
    toast.show({ message: "Borramos tus datos de este dispositivo" });
  }

  function remember(f: CheckoutForm) {
    const previous = loadCustomer(local());
    saveCustomer(local(), {
      name: f.name,
      whatsapp: f.whatsapp,
      address: f.fulfillment === "delivery" ? f.address : (previous?.address ?? ""),
      crossStreets: f.fulfillment === "delivery" ? f.crossStreets : (previous?.crossStreets ?? ""),
      notes: f.fulfillment === "delivery" ? f.notes : (previous?.notes ?? ""),
    });
  }

  function showFieldErrors(fields: FieldErrors, rest: string[]) {
    setErrors(fields);
    setOther(rest);
    focusField(firstInvalidField(fields));
  }

  function handleResult(result: ActionResult, units: OrderUnitInput[], sent: CheckoutForm, sentLines: readonly CartLine[]) {
    if (result.ok) {
      // Order created: from here on the cart is empty ON PURPOSE (no redirect to /carrito).
      setPlaced(true);
      keyHolder.current?.clear();
      remember(sent);
      cart.clear();
      router.replace(`/pedido/${result.publicToken}?nuevo=1`);
      return; // stays "in flight": the button remains disabled until the navigation
    }
    inFlight.current = false;
    if (result.code === "VALIDATION") {
      const { fields, other: rest } = splitFieldErrors(result.fieldErrors);
      const human = humanizeErrors(fields, sent);
      if (Object.keys(human).length > 0 || rest.length > 0) showFieldErrors(human, rest);
      else setServerMessage(result.message);
    } else if (result.code === "UNITS_INVALID") {
      const names = new Map([...index.products].map(([id, p]) => [id, p.name]));
      const issues = result.unitIssues ?? [];
      setUnitMessages(describeUnitIssues(issues, units, names));
      // Products the server says are gone: drop exactly the units that were SENT (snapshot, so an edit
      // in flight cannot shift indexes), without waiting for a fresh menu, and tell the cart page why.
      const ids = unavailableLineIds(issues, sentLines);
      setUnitsRemoved(ids.length > 0);
      if (ids.length > 0) {
        cart.removeLines(ids);
        cart.addIssues(removedIssues(ids, sentLines, names));
      }
      // Options / combinations need the reconcile against a fresh menu.
      if (issues.some((i) => i.code !== "PRODUCT_UNAVAILABLE")) router.refresh();
    } else {
      // A tripped honeypot (autofilled by a form-filler) must never lock the customer out: clear it.
      if (result.code === "HONEYPOT") setForm((f) => ({ ...f, bh_ref: "" }));
      setServerMessage(failureMessage(result));
    }
  }

  function submit() {
    if (inFlight.current || !cart.ready || !ordersOpen || cart.count === 0) return;
    setServerMessage(null);
    setUnitMessages(null);
    const sentLines = cart.lines;
    const units = toOrderUnits(sentLines);
    keyHolder.current ??= createKeyHolder(session());
    const key = keyHolder.current.get(orderSignature(units, form));
    const check = validateForm(form, units, key);
    if (!check.ok) {
      showFieldErrors(check.fields, check.other);
      return;
    }
    setErrors({});
    setOther([]);
    inFlight.current = true;
    const sent = form;
    const input = toCreateOrderInput(sent, units, key);
    startTransition(async () => {
      try {
        handleResult(await createOrderAction(input), units, sent, sentLines);
      } catch {
        inFlight.current = false;
        setServerMessage(NETWORK_MESSAGE);
      }
    });
  }

  return {
    cart,
    ordersOpen,
    form,
    errors,
    other,
    serverMessage,
    unitMessages,
    unitsRemoved,
    remembered,
    placed,
    pending,
    preview,
    update,
    forget,
    submit,
  };
}
