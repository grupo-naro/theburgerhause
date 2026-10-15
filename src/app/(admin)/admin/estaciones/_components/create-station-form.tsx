"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { createStationAction, type StationActionState } from "../actions";
import { TokenPanel } from "./token-panel";

export function CreateStationForm() {
  const [state, action, pending] = useActionState<StationActionState, FormData>(createStationAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-display text-xl font-extrabold">Nueva estación</h2>
      <form action={action} className="flex flex-col gap-4 sm:max-w-xl">
        <FormMessage>{state.error}</FormMessage>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" htmlFor="station-name" error={fe.name}>
            <Input
              id="station-name"
              name="name"
              required
              maxLength={60}
              defaultValue={state.values?.name ?? ""}
              error={fe.name}
            />
          </Field>
          <Field label="Tipo" htmlFor="station-kind" error={fe.kind}>
            <Select id="station-kind" name="kind" defaultValue={state.values?.kind ?? "mostrador"} error={fe.kind}>
              <option value="mostrador">Mostrador</option>
              <option value="delivery">Delivery</option>
            </Select>
          </Field>
        </div>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Creando…" : "Crear estación"}
          </Button>
        </div>
      </form>
      {state.token ? (
        <TokenPanel token={state.token} title={`Token de “${state.stationName ?? "la estación"}”`} />
      ) : null}
    </Card>
  );
}
