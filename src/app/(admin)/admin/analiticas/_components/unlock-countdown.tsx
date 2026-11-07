"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionButton } from "@/components/ui/action-button";
import { lockAnalyticsAction } from "../actions";

const mmss = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/** "🔓 14:32 · Bloquear ya". At 0 it refreshes: the server then renders the locked page. */
export function UnlockCountdown({ untilIso }: { untilIso: string }) {
  const router = useRouter();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const until = new Date(untilIso).getTime();
    let refreshed = false;
    const tick = () => {
      const ms = until - Date.now();
      setLeft(ms);
      if (ms <= 0 && !refreshed) {
        refreshed = true;
        router.refresh();
      }
    };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [untilIso, router]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold tabular-nums" aria-live="off">
        🔓 {left === null ? "--:--" : mmss(left)}
      </span>
      <ActionButton action={lockAnalyticsAction} fields={{}} label="Bloquear ya" variant="secondary" size="sm">
        Bloquear ya
      </ActionButton>
    </div>
  );
}
