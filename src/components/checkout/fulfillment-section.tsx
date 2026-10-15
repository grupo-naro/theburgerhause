"use client";

import { ClockIcon, PinIcon } from "@/components/menu/icons";
import { Field, Input, Textarea } from "@/components/ui/field";
import { fieldId, type CheckoutForm, type FieldErrors, type Fulfillment } from "@/lib/checkout/form";
import type { CheckoutInfo } from "@/lib/settings/checkout-info";
import { CheckoutSection } from "./section";

type Props = {
  form: CheckoutForm;
  errors: FieldErrors;
  info: CheckoutInfo;
  onChange: (patch: Partial<CheckoutForm>) => void;
};

const OPTIONS: { value: Fulfillment; label: string }[] = [
  { value: "delivery", label: "Delivery" },
  { value: "takeaway", label: "Retiro en el local" },
];

/** Segmented control (native radios) + the fields of the chosen way to receive the order. */
export function FulfillmentSection({ form, errors, info, onChange }: Props) {
  return (
    <CheckoutSection n={1} title="Entrega" headingId="checkout-h-entrega">
      <fieldset>
        <legend className="sr-only">Cómo querés recibir tu pedido</legend>
        <div className="grid grid-cols-2 gap-1 rounded-full bg-brand-50 p-1">
          {OPTIONS.map((o) => (
            <div key={o.value} className="relative">
              <input
                type="radio"
                name="fulfillment"
                id={`checkout-fulfillment-${o.value}`}
                value={o.value}
                checked={form.fulfillment === o.value}
                onChange={() => onChange({ fulfillment: o.value })}
                className="peer sr-only"
              />
              <label
                htmlFor={`checkout-fulfillment-${o.value}`}
                className="flex min-h-11 cursor-pointer items-center justify-center rounded-full px-2 text-center font-display text-sm font-bold sm:text-base text-brand-700 transition-colors peer-checked:bg-brand-600 peer-checked:text-white peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600"
              >
                {o.label}
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      {form.fulfillment === "delivery" ? (
        <div className="space-y-4" data-testid="delivery-fields">
          <Field
            label="Dirección"
            htmlFor={fieldId("delivery.address")}
            error={errors["delivery.address"]}
            hint="Calle y número (y piso / depto si corresponde)"
          >
            <Input
              id={fieldId("delivery.address")}
              name="address"
              autoComplete="street-address"
              value={form.address}
              onChange={(e) => onChange({ address: e.target.value })}
              error={errors["delivery.address"]}
              hasHint
              maxLength={160}
              className="min-h-12 scroll-mt-28 text-base"
            />
          </Field>
          <Field
            label="Entre calles"
            htmlFor={fieldId("delivery.crossStreets")}
            error={errors["delivery.crossStreets"]}
            hint="Por ejemplo: Rivadavia y Mitre"
          >
            <Input
              id={fieldId("delivery.crossStreets")}
              name="crossStreets"
              autoComplete="off"
              value={form.crossStreets}
              onChange={(e) => onChange({ crossStreets: e.target.value })}
              error={errors["delivery.crossStreets"]}
              hasHint
              maxLength={120}
              className="min-h-12 scroll-mt-28 text-base"
            />
          </Field>
          <Field
            label="Aclaraciones del lugar (opcional)"
            htmlFor={fieldId("delivery.notes")}
            error={errors["delivery.notes"]}
            hint="Timbre, color de la casa, portón, etc."
          >
            <Textarea
              id={fieldId("delivery.notes")}
              name="notes"
              rows={2}
              value={form.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
              error={errors["delivery.notes"]}
              hasHint
              maxLength={300}
              className="scroll-mt-28 text-base"
            />
          </Field>
        </div>
      ) : (
        <div data-testid="takeaway-info" className="space-y-3 rounded-xl bg-brand-50 p-4 text-ink">
          <p className="font-display text-base font-bold">Retirás tu pedido en el local</p>
          {info.storeAddress ? (
            <p className="flex items-start gap-2 text-sm">
              <PinIcon className="mt-0.5 size-4 shrink-0 text-brand-600" />
              <a
                data-testid="takeaway-address"
                className="font-medium text-brand-700 underline underline-offset-2"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info.storeAddress)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {info.storeAddress}
                <span className="sr-only"> (abre el mapa en una pestaña nueva)</span>
              </a>
            </p>
          ) : (
            <p className="text-sm text-ink-muted">Te avisamos la dirección del local por WhatsApp.</p>
          )}
          {info.openingHoursText && (
            <p className="flex items-start gap-2 text-sm">
              <ClockIcon className="mt-0.5 size-4 shrink-0 text-brand-600" />
              <span className="whitespace-pre-line">{info.openingHoursText}</span>
            </p>
          )}
        </div>
      )}
    </CheckoutSection>
  );
}
