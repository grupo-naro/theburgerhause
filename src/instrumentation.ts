/**
 * Runs once per server start (and also during `next build` phases, where it must stay inert).
 * Starts the process-wide Postgres LISTEN connection that feeds the SSE endpoint.
 */
export async function register(): Promise<void> {
  // The literal NEXT_RUNTIME check must wrap the import: bundlers use it to drop the Node-only
  // code (pg needs `fs`/`net`) from the edge bundle of this file.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // `next build` also runs register(); opening a DB connection there would hang or fail the build.
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    const { startListener } = await import("./lib/events/listener");
    startListener();
  }
}
