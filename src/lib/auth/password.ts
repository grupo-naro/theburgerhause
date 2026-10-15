import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

function derive(plain: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const options: ScryptOptions = { N: n, r, p };
  return new Promise((resolve, reject) => {
    scrypt(plain, salt, KEY_BYTES, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Stored format: `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>`. */
export async function hashPassword(plain: string): Promise<string> {
  if (plain.length === 0) throw new Error("Password must not be empty");
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(plain, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** Never throws: any malformed or unknown stored value yields false. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [n, r, p] = [parts[1], parts[2], parts[3]].map((v) => (/^\d+$/.test(v) ? Number(v) : NaN));
    if (![n, r, p].every((v) => Number.isSafeInteger(v) && v > 0)) return false;
    // Only the parameters we produce are accepted (also bounds memory/CPU use).
    if (n !== N || r !== R || p !== P) return false;
    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
    const actual = await derive(plain, salt, n, r, p);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
