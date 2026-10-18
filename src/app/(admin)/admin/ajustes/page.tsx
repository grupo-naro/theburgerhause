import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { centsToPesos } from "@/domain/money";
import { requireSessionOrRedirect } from "@/lib/auth/guards";
import { getSettings } from "@/lib/settings";
import { toggleAcceptingOrdersAction } from "./actions";
import { SettingsForm } from "./_components/settings-form";

export const metadata = { title: "Ajustes · Administración" };

export default async function AdminSettingsPage() {
  await requireSessionOrRedirect(["admin"], "/admin/ajustes");
  const settings = await getSettings(getDb());
  return (
    <section className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-extrabold text-brand-600">Ajustes</h1>
      <Card className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-extrabold">Pedidos online</h2>
          <p className="text-sm text-ink-muted">
            Si los pausás, la tienda muestra el cartel de local cerrado y no se pueden crear pedidos nuevos.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Badge tone={settings.acceptingOrders ? "success" : "danger"}>
            {settings.acceptingOrders ? "Recibiendo pedidos" : "Pedidos pausados"}
          </Badge>
          <ActionButton
            action={toggleAcceptingOrdersAction}
            fields={{ value: String(!settings.acceptingOrders) }}
            label={settings.acceptingOrders ? "Pausar pedidos" : "Reanudar pedidos"}
            variant={settings.acceptingOrders ? "danger" : "primary"}
            size="md"
          >
            {settings.acceptingOrders ? "Pausar pedidos" : "Reanudar pedidos"}
          </ActionButton>
        </div>
      </Card>
      <SettingsForm
        initial={{
          storeName: settings.storeName,
          storeAddress: settings.storeAddress,
          storePhone: settings.storePhone,
          whatsapp: settings.whatsapp,
          bankAlias: settings.bankAlias,
          bankCbu: settings.bankCbu,
          deliveryFeePesos: centsToPesos(settings.deliveryFee),
          acceptingOrders: settings.acceptingOrders,
          openingHoursText: settings.openingHoursText,
          businessDayCutoff: settings.businessDayCutoff,
        }}
      />
    </section>
  );
}
