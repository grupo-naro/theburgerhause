import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Target cost (Task 9.3): N=2^15, r=8, p=3 is one of the OWASP-equivalent scrypt configurations
// (N=2^17,r=8,p=1 needs 128 MiB per attempt; this one needs 32 MiB and ~180 ms on a 2019 desktop CPU).
// Node runs scrypt on the libuv pool (4 threads), so concurrent derivations are bounded by it as well.
const TARGET = { N: 32768, r: 8, p: 3 } as const;
/** Hashes created before Task 9.3. Still accepted; rewritten with TARGET on the next successful login. */
const LEGACY = { N: 16384, r: 8, p: 1 } as const;
const ACCEPTED: ReadonlyArray<{ N: number; r: number; p: number }> = [TARGET, LEGACY];
const SALT_BYTES = 16;
const KEY_BYTES = 64;
// Node's default maxmem (32 MiB) is exactly what TARGET needs before overhead; 64 MiB leaves headroom and stays a hard cap.
const MAXMEM = 64 * 1024 * 1024;

function derive(plain: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const options: ScryptOptions = { N: n, r, p, maxmem: MAXMEM };
  return new Promise((resolve, reject) => {
    scrypt(plain, salt, KEY_BYTES, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Stored format: `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>` (the parameters travel with the hash, which is what makes upgrades possible). */
export async function hashPassword(plain: string): Promise<string> {
  if (plain.length === 0) throw new Error("Password must not be empty");
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(plain, salt, TARGET.N, TARGET.r, TARGET.p);
  return `scrypt$${TARGET.N}$${TARGET.r}$${TARGET.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** True when `stored` is a valid hash made with parameters weaker than the current target (rehash it after a successful login). */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  return !(Number(parts[1]) === TARGET.N && Number(parts[2]) === TARGET.r && Number(parts[3]) === TARGET.p);
}

/** Never throws: any malformed or unknown stored value yields false. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [n, r, p] = [parts[1], parts[2], parts[3]].map((v) => (/^\d+$/.test(v) ? Number(v) : NaN));
    if (![n, r, p].every((v) => Number.isSafeInteger(v) && v > 0)) return false;
    // Only parameters we produce (now or before) are accepted: this also bounds memory/CPU use.
    if (!ACCEPTED.some((a) => a.N === n && a.r === r && a.p === p)) return false;
    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
    const actual = await derive(plain, salt, n, r, p);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Parameter sets whose cost a verification of `stored` does NOT pay on its own (see verifyPasswordUniformCost). */
export function paddingSets(stored: string): ReadonlyArray<{ N: number; r: number; p: number }> {
  const parts = stored.split("$");
  const own = parts.length === 6 && parts[0] === "scrypt" ? ACCEPTED.find((a) => a.N === Number(parts[1]) && a.r === Number(parts[2]) && a.p === Number(parts[3])) : undefined;
  return ACCEPTED.filter((a) => a !== own);
}

/**
 * `verifyPassword` plus a throwaway derivation with every OTHER accepted parameter set, run concurrently. A
 * login for an unknown user (target-cost dummy hash), a current hash and a legacy hash therefore all take about
 * the cost of the most expensive set, so response time does not reveal which usernames still have legacy hashes.
 */
export async function verifyPasswordUniformCost(plain: string, stored: string): Promise<boolean> {
  const pad = paddingSets(stored).map((a) => derive(plain, Buffer.alloc(SALT_BYTES), a.N, a.r, a.p).catch(() => null));
  const [ok] = await Promise.all([verifyPassword(plain, stored), ...pad]);
  return ok;
}
