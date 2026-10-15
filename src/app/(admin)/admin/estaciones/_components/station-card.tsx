"use client";

import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import type { ActionState } from "@/lib/menu/action-state";
import { renameStationAction, rotateStationTokenAction, type StationActionState } from "../actions";
import { TokenPanel } from "./token-panel";

export type StationCardData = {
  id: number;
  name: string;
  kind: "mostrador" | "delivery";
  hasToken: boolean;
  connection: "online" | "offline" | "never";
  /** Preformatted on the server (es-AR, Buenos Aires time). */
  lastSeenLabel: string | null;
};

const KIND_LABEL = { mostrador: "Mostrador", delivery: "Delivery" } as const;
const CONNECTION = {
  online: { tone: "success", label: "Conectada" },
  offline: { tone: "warning", label: "Sin conexión" },
  never: { tone: "muted", label: "Nunca conectada" },
} as const;

function RenameForm({ station, onDone }: { station: StationCardData; onDone: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(async (p, fd) => {
    const next = await renameStationAction(p, fd);
    if (next.message) onDone();
    return next;
  }, {});
  return (
    <form action={action} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="id" value={station.id} />
      <div className="flex flex-col gap-1">
        <Input
          aria-label={`Nombre de ${station.name}`}
          name="name"
          required
          maxLength={60}
          defaultValue={state.values?.name ?? station.name}
          error={state.fieldErrors?.name}
          className="w-64 max-w-full"
        />
        {state.fieldErrors?.name ? (
          <p role="alert" className="text-sm font-medium text-state-error">
            {state.fieldErrors.name}
          </p>
        ) : null}
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        Guardar nombre
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        Cancelar
      </Button>
      <FormMessage>{state.error}</FormMessage>
    </form>
  );
}

export function StationCard({ station }: { station: StationCardData }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<StationActionState, FormData>(
    async (p, fd) => {
      // Close the confirmation only after the action ran: unmounting the submit
      // button from its own onClick would cancel the form submission.
      const next = await rotateStationTokenAction(p, fd);
      setConfirming(false);
      return next;
    },
    {},
  );
  const [renaming, setRenaming] = useState(false);
  const conn = CONNECTION[station.connection];
  const hasToken = station.hasToken || Boolean(state.token);

  return (
    <Card className="flex flex-col gap-3" aria-label={station.name}>
      <div className="flex flex-wrap items-center gap-3">
        {renaming ? (
          <RenameForm station={station} onDone={() => setRenaming(false)} />
        ) : (
          <>
            <h2 className="font-display text-2xl font-extrabold">{station.name}</h2>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(true)}>
              Renombrar
            </Button>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge>{KIND_LABEL[station.kind]}</Badge>
        <Badge tone={conn.tone}>{conn.label}</Badge>
        <Badge tone={hasToken ? "success" : "danger"}>{hasToken ? "Token activo" : "Sin token — generá uno"}</Badge>
        {station.lastSeenLabel ? <span className="text-ink-muted">Última conexión: {station.lastSeenLabel}</span> : null}
      </div>
      <FormMessage>{state.error}</FormMessage>
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={station.id} />
        {confirming ? (
          <>
            <p className="text-sm">
              {station.hasToken
                ? "El token actual deja de funcionar al instante: el Print Agent de esta estación se desconecta hasta cargar el nuevo."
                : "Se genera el primer token de esta estación."}
            </p>
            <Button type="submit" size="sm" variant="danger" disabled={pending}>
              {station.hasToken ? "Confirmar rotación" : "Confirmar"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="secondary" onClick={() => setConfirming(true)} disabled={pending}>
            {station.hasToken || state.token ? "Rotar token" : "Generar token"}
          </Button>
        )}
      </form>
      {state.token ? <TokenPanel token={state.token} title="Token nuevo" /> : null}
    </Card>
  );
}
