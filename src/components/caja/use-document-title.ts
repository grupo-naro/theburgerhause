"use client";

import { useEffect, useState } from "react";
import { buildTitle } from "@/lib/caja/title";

const FLASH_INTERVAL_MS = 1000;

/**
 * Keeps `document.title` at `(N) Caja`; while `alert` is on it alternates with `¡Nuevo pedido!`.
 * (When the page is unmounted the previous title is restored.)
 */
export function useDocumentTitle(pending: number, alert: boolean, base?: string): void {
  const [phase, setPhase] = useState(false);

  useEffect(() => {
    const previous = document.title;
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    if (!alert) return;
    const id = window.setInterval(() => setPhase((p) => !p), FLASH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [alert]);

  useEffect(() => {
    document.title = buildTitle({ pending, alert: alert && phase, base });
  }, [pending, alert, phase, base]);
}
