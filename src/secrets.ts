/**
 * Comparing and deriving from secrets.
 *
 * Two rules here. A secret is never compared with `===`, which returns as soon
 * as it finds a wrong byte and so tells an attacker how much of a guess was
 * right. And a secret is never used directly as a signing key, which would let
 * anyone holding a signature grind the secret offline.
 */

const enc = new TextEncoder();

// Generated once per isolate. An attacker cannot precompute against it, so the
// digests below are safe to compare byte by byte.
let comparisonKey: Promise<CryptoKey> | null = null;
function cmpKey() {
  if (!comparisonKey) {
    comparisonKey = crypto.subtle.importKey(
      "raw",
      crypto.getRandomValues(new Uint8Array(32)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }
  return comparisonKey;
}

/**
 * Constant-time secret comparison, by way of HMACing both sides first: the
 * comparison then runs over two fixed-length digests, so neither the contents
 * nor the *length* of the guess changes how long it takes.
 */
export async function secretEquals(a: string, b: string): Promise<boolean> {
  const key = await cmpKey();
  const [x, y] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(a)),
    crypto.subtle.sign("HMAC", key, enc.encode(b)),
  ]);
  const xs = new Uint8Array(x);
  const ys = new Uint8Array(y);
  let diff = xs.length ^ ys.length;
  for (let i = 0; i < xs.length; i++) diff |= xs[i] ^ ys[i];
  return diff === 0;
}

/**
 * Stretch key material into an HMAC key. When the material is a dedicated
 * random secret the stretching is merely harmless; when it is a password it is
 * the point, because it makes each offline guess expensive.
 *
 * Derivation is cached: it depends only on the deployment's configuration, and
 * 100k iterations is far too slow to repeat per request.
 */
const SALT = "classifier.dev/admin/v1";
const ITERATIONS = 100_000;
let derived: { material: string; key: Promise<CryptoKey> } | null = null;

export function deriveSigningKey(material: string): Promise<CryptoKey> {
  if (derived?.material === material) return derived.key;
  const key = (async () => {
    const base = await crypto.subtle.importKey("raw", enc.encode(material), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: enc.encode(SALT), iterations: ITERATIONS, hash: "SHA-256" },
      base,
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign"],
    );
  })();
  derived = { material, key };
  return key;
}

export async function hmacHex(key: CryptoKey, msg: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
