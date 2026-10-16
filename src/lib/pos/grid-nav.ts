export type Rect = { x: number; y: number; w: number; h: number };
export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/**
 * Roving focus over a wrapped grid of tiles, from their bounding boxes (DOM order). Left/right walk
 * the order; up/down go to the nearest row above/below and, inside it, to the closest column.
 * Returns the same index when there is nowhere to go.
 */
export function nextTileIndex(rects: readonly Rect[], from: number, key: ArrowKey): number {
  const cur = rects[from];
  if (!cur) return from;
  if (key === "ArrowRight") return Math.min(from + 1, rects.length - 1);
  if (key === "ArrowLeft") return Math.max(from - 1, 0);

  const cy = cur.y + cur.h / 2;
  const cx = cur.x + cur.w / 2;
  const dir = key === "ArrowDown" ? 1 : -1;
  let rowY: number | null = null;
  for (const r of rects) {
    const ry = r.y + r.h / 2;
    if ((ry - cy) * dir > cur.h / 2 && (rowY === null || Math.abs(ry - cy) < Math.abs(rowY - cy))) rowY = ry;
  }
  if (rowY === null) return from;
  let best = from;
  let bestDist = Infinity;
  rects.forEach((r, i) => {
    if (Math.abs(r.y + r.h / 2 - rowY!) > 1) return;
    const d = Math.abs(r.x + r.w / 2 - cx);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  });
  return best;
}
