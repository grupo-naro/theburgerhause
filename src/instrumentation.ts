/**
 * Runs once per server start (and also during `next build` phases, where it must stay inert).
 * Starts the process-wide Postgres LISTEN connection that feeds the SSE endpoint.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` imports this too; opening a DB connection there would hang or fail the build.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startListener } = await import("./lib/events/listener");
  startListener();
}
