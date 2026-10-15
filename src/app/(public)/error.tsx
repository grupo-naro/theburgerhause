"use client";

import { useEffect } from "react";
import { StatePanel } from "@/components/menu/state-panel";
import { Button } from "@/components/ui/button";

export default function PublicError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatePanel
      title="Se nos quemó la parrilla"
      actions={<Button onClick={() => retry()}>Reintentar</Button>}
    >
      No pudimos cargar la carta. Probá de nuevo en unos segundos.
    </StatePanel>
  );
}
