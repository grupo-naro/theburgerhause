"use client";

/** Last-resort net (errors in the root layout). Renders its own document, so it carries minimal inline styles. */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
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
        <main>
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
