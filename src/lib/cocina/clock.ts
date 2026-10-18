/**
 * The kitchen clock must not depend on the device's wall clock (a tablet minutes behind the server would freeze the
 * ages): "now" = the server time of the last render + the monotonic time elapsed locally since that render.
 */
export function serverClockNow(baseServerMs: number, basePerfMs: number, perfNowMs: number): number {
  return baseServerMs + Math.max(0, perfNowMs - basePerfMs);
}
