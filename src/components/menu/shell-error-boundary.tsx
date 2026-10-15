"use client";

import { useRouter } from "next/navigation";
import { Component, startTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  SHELL_ERROR_LOG,
  initialShellState,
  shellFailed,
  shellRetried,
  type ShellBoundaryState,
} from "./shell-boundary-state";
import { StatePanel } from "./state-panel";
import { StoreHeaderFallback } from "./store-header-fallback";

function ShellError({ onRetry }: { onRetry: () => void }) {
  const router = useRouter();
  return (
    <>
      <StoreHeaderFallback />
      <StatePanel
        title="Se nos quemó la parrilla"
        actions={
          <Button
            onClick={() =>
              // Refresh first so the retry really re-fetches; both land together in one transition.
              startTransition(() => {
                router.refresh();
                onRetry();
              })
            }
          >
            Reintentar
          </Button>
        }
      >
        No pudimos cargar la carta. Probá de nuevo en unos segundos.
      </StatePanel>
    </>
  );
}

/**
 * `error.tsx` does not wrap the layout of its own segment, and the public layout awaits the cached
 * menu, so a data failure there needs its own boundary (UX spec 3.3: network error with retry).
 */
export class ShellErrorBoundary extends Component<{ children: ReactNode }, ShellBoundaryState> {
  state = initialShellState;

  static getDerivedStateFromError(): ShellBoundaryState {
    return shellFailed();
  }

  componentDidCatch() {
    console.error(SHELL_ERROR_LOG);
  }

  private retry = () => this.setState(shellRetried());

  render() {
    return this.state.failed ? <ShellError onRetry={this.retry} /> : this.props.children;
  }
}
