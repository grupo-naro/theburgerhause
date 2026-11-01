import { getDb } from "@/db/client";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { getPromo } from "@/lib/promo/admin";
import { toBaInput } from "@/lib/promo/window";
import { thumbUrl } from "@/lib/uploads/storage";
import { PromoForm } from "./_components/promo-form";

export const metadata = { title: "Promoción · Administración" };

export default async function AdminPromoPage() {
  await requireSessionOrRedirect(["admin"], "/admin/promocion");
  const promo = await getPromo(getDb());
  const imagePath = promo?.imagePath ?? null;
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Promoción</h1>
      <p className="text-sm text-ink-muted">
        Una imagen publicitaria que se abre una vez, al entrar a la tienda. Los horarios son de Buenos Aires.
      </p>
      <PromoForm
        initial={{
          imagePath,
          title: promo?.title ?? "",
          active: promo?.active ?? false,
          startsAt: toBaInput(promo?.startsAt ?? null),
          endsAt: toBaInput(promo?.endsAt ?? null),
        }}
        previewUrl={imagePath ? thumbUrl(imagePath) : null}
      />
    </section>
  );
}
