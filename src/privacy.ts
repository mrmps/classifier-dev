/**
 * Day-scoped caller pseudonyms and stable classifier fingerprints.
 *
 * Caller addresses and label sets go through keyed hashes before they reach
 * per-request analytics. The address never lands in storage. Successful
 * classifier label names are also kept in a separate, bounded KV registry so
 * operators can understand aggregate use. It expires after 90 days and has no
 * caller or input fields, but its shared fingerprint resolves label names in
 * pseudonymous analytics.
 *
 * The key is a secret, because an unkeyed hash of either one is not a
 * pseudonym. The whole IPv4 space hashes in seconds on a laptop, and common
 * label sets are a short word list, so anyone holding only the analytics
 * dataset and this public source could invert an unkeyed hash. The separate
 * label registry intentionally resolves fingerprints for operators.
 *
 * A caller pseudonym also takes the UTC day, so it is a different value
 * tomorrow and nothing accumulates into a profile of one person over 90 days of
 * retention. Label fingerprints are stable instead, because counting distinct
 * label sets across a 30-day window is the entire point of that number.
 */

/** The fields of Env this module reads. Kept narrow so tests can pass a literal. */
export interface PrivacyEnv {
  /** Preferred. `npx wrangler secret put PRIVACY_SALT` with 32 random bytes. */
  PRIVACY_SALT?: string;
  ADMIN_SIGNING_KEY?: string;
  REPORT_KEY?: string;
}

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer, bytes: number) =>
  [...new Uint8Array(buf).slice(0, bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * With nothing configured — a local run, mostly — the salt is random per
 * isolate. That inflates distinct counts, which is the harmless way to be
 * wrong; the alternative is a hash anyone can invert.
 */
let random = "";
function salt(env: PrivacyEnv) {
  const configured = env.PRIVACY_SALT || env.ADMIN_SIGNING_KEY || env.REPORT_KEY || "";
  if (configured) return configured;
  if (!random) random = hex(crypto.getRandomValues(new Uint8Array(32)).buffer, 32);
  return random;
}

// One key per salt, so the day belongs in the message and not in this map:
// a deployment holds one salt, and the map cannot grow with traffic.
const keys = new Map<string, Promise<CryptoKey>>();
function key(material: string) {
  let k = keys.get(material);
  if (!k) {
    k = crypto.subtle.importKey("raw", enc.encode(material), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    keys.set(material, k);
  }
  return k;
}

async function digest(env: PrivacyEnv, message: string, bytes = 8) {
  return hex(await crypto.subtle.sign("HMAC", await key(salt(env)), enc.encode(message)), bytes);
}

const utcDay = () => new Date().toISOString().slice(0, 10);

/**
 * A stand-in for the caller, good for one UTC day. Counting rows of these gives
 * the number of distinct callers in a day; over a longer window it counts each
 * of their days, which is the price of not keeping the address.
 */
export async function callerId(env: PrivacyEnv, ip: string): Promise<string> {
  if (!ip || ip === "anon") return "anon";
  return `c_${await digest(env, `ip:${utcDay()}:${ip}`)}`;
}

/** Order and case never distinguished two classifiers, so neither does this. */
export function normalizeLabels(labels: string[]): string {
  return [...new Set(labels
    .filter((l) => typeof l === "string")
    .map((l) => l.toLowerCase().trim())
    .filter(Boolean))]
    .sort()
    // Keep existing fingerprints for ordinary labels; escape delimiter-bearing
    // labels so ["a|b", "c"] and ["a", "b|c"] are different classifiers.
    .map((l) => l.replace(/\\/g, "\\\\").replace(/\|/g, "\\|"))
    .join("|");
}

/**
 * A stable, opaque name for one label set. Same set, same fingerprint, for as
 * long as the salt lives. Analytics contains only this value; the separate
 * short-lived registry may resolve it to aggregate label names.
 */
export async function labelFingerprint(env: PrivacyEnv, labels: string[]): Promise<string> {
  const normalized = normalizeLabels(labels);
  if (!normalized) return "";
  return `ls_${await digest(env, `labels:${normalized}`)}`;
}

/** Read a current registry record; legacy timestamp-only entries stay opaque. */
export async function recordedClassifierLabels(
  stats: { get(key: string): Promise<string | null> },
  fingerprint: string,
): Promise<string[]> {
  if (!fingerprint) return [];
  try {
    const raw = await stats.get(`cls:${fingerprint}`);
    if (!raw) return [];
    const labels = (JSON.parse(raw) as { labels?: unknown }).labels;
    return Array.isArray(labels) && labels.every((label) => typeof label === "string")
      ? labels as string[]
      : [];
  } catch {
    return [];
  }
}
