"use client";

import { Field, Input } from "@/components/ui/field";
import { fieldId, type CheckoutForm, type FieldErrors } from "@/lib/checkout/form";
import { CheckoutSection } from "./section";

type Props = {
  form: CheckoutForm;
  errors: FieldErrors;
  /** True when "bh_customer_v1" holds data from a previous order. */
  remembered: boolean;
  onChange: (patch: Partial<CheckoutForm>) => void;
  onForget: () => void;
};

export function CustomerSection({ form, errors, remembered, onChange, onForget }: Props) {
  return (
    <CheckoutSection n={2} title="Tus datos" headingId="checkout-h-datos">
      <Field label="Nombre y apellido" htmlFor={fieldId("customer.name")} error={errors["customer.name"]}>
        <Input
          id={fieldId("customer.name")}
          name="name"
          autoComplete="name"
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          error={errors["customer.name"]}
          maxLength={80}
          className="min-h-12 scroll-mt-28 text-base"
        />
      </Field>
      <Field
        label="WhatsApp"
        htmlFor={fieldId("customer.whatsapp")}
        error={errors["customer.whatsapp"]}
        hint="Con característica, sin 0 ni 15. Ej: 11 5555-1234"
      >
        <Input
          id={fieldId("customer.whatsapp")}
          name="whatsapp"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={form.whatsapp}
          onChange={(e) => onChange({ whatsapp: e.target.value })}
          error={errors["customer.whatsapp"]}
          hasHint
          maxLength={40}
          className="min-h-12 scroll-mt-28 text-base"
        />
      </Field>
      <p className="text-sm text-ink-muted">
        Guardamos estos datos en este dispositivo para tu próximo pedido.
        {remembered && (
          <>
            {" "}
            <button
              type="button"
              data-testid="forget-customer"
              onClick={onForget}
              className="inline-flex min-h-11 items-center font-bold text-brand-600 underline underline-offset-2"
            >
              Borrar mis datos
            </button>
          </>
        )}
      </p>
    </CheckoutSection>
  );
}
