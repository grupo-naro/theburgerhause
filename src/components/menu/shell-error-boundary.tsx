"use client";

import { catchError, type ErrorInfo } from "next/error";
import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StatePanel } from "./state-panel";
import { StoreHeaderFallback } from "./store-header-fallback";

function ShellError(_props: { children?: ReactNode }, { retry }: ErrorInfo) {
  useEffect(() => {
    // Fixed string only: the error object can carry DB details.
    console.error("[storefront] the shell failed to load");
  }, []);
  return (
    <>
      <StoreHeaderFallback />
      <div role="alert">
        <StatePanel title="Se nos quemó la parrilla" actions={<Button onClick={() => retry()}>Reintentar</Button>}>
          No pudimos cargar la carta. Probá de nuevo en unos segundos.
        </StatePanel>
      </div>
    </>
  );
}

/**
 * `error.tsx` does not wrap the layout of its own segment, and the public layout awaits the cached
 * menu, so a data failure there needs its own boundary (UX spec 3.3: network error with retry).
 * `catchError` lets redirect()/notFound() through and its `retry()` re-fetches the route in a transition.
 */
export const ShellErrorBoundary = catchError(ShellError);
