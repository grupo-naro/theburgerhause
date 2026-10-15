import { createHash, randomBytes } from "node:crypto";

/**
 * Print-agent station tokens (spec §7/§8). The plain token is shown to the
 * admin once; only its sha256 is stored (`stations.token_hash`). The token has
 * 256 bits of entropy, so a fast unsalted hash is appropriate (and lets the
 * agent endpoint look a station up by hash, Task 6.1).
 */

export const STATION_TOKEN_PREFIX = "bhst_";
const BODY_LENGTH = 43; // 32 bytes as unpadded base64url

export function generateStationToken(): string {
  return `${STATION_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** sha256 hex (64 chars) of the plain token: the only form that is persisted. */
export function hashStationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cheap shape check to reject garbage before touching the database. */
export function isWellFormedStationToken(value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^${STATION_TOKEN_PREFIX}[A-Za-z0-9_-]{${BODY_LENGTH}}$`).test(value);
}
