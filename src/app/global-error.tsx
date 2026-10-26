"use client";

import { useEffect } from "react";
import { shouldAutoReload, TV_RELOAD_INTERVAL_MS } from "@/lib/pantalla/auto-reload";

/**
 * Last-resort net (errors in the root layout). Renders its own document, so it carries minimal inline styles.
 * The counter TV (/pantalla) is unattended: there it reloads the whole page every 15 s (a plain reload, not retry())
 * so a 500 before streaming never strands it on a manual button. Other routes keep "Reintentar".
 */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    const id = window.setInterval(() => {
      if (shouldAutoReload(window.location.pathname, navigator.onLine)) window.location.reload();
    }, TV_RELOAD_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <html lang="es-AR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f5f8fc",
          color: "#0b1f3a",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "1rem",
        }}
      >
        <main role="alert">
          <h1 style={{ fontSize: "1.5rem" }}>The Burger House 828</h1>
          <p>Se nos quemó la parrilla. No pudimos cargar la página.</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              background: "#0557a9",
              color: "#fff",
              border: 0,
              borderRadius: 999,
              padding: "0.7rem 1.5rem",
              fontSize: "1rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
