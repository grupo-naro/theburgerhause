import { z } from "zod";

const id = z.number().int().positive();
const name = z.string().trim().min(1, "Ingresá un nombre").max(60, "Máximo 60 caracteres");

export const stationInputSchema = z.object({
  name,
  kind: z.enum(["mostrador", "delivery"], "Elegí un tipo"),
});

export const renameInputSchema = z.object({ id, name });

export type StationInput = z.input<typeof stationInputSchema>;

/** A station counts as connected when its agent was seen within this window. */
export const ONLINE_WINDOW_MS = 90_000;
export type ConnectionState = "online" | "offline" | "never";

export function connectionState(lastSeenAt: Date | null, now: Date): ConnectionState {
  if (!lastSeenAt) return "never";
  return now.getTime() - lastSeenAt.getTime() <= ONLINE_WINDOW_MS ? "online" : "offline";
}
