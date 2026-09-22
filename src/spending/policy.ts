import type { ModelTokenUsage } from "../cost";
import type { PrivacyEnv } from "../privacy";

export interface SpendingEnv extends PrivacyEnv {
  SPENDING_ENABLED?: string;
  FREE_BUDGET?: DurableObjectNamespace;
  FREE_DAILY_USD?: string;
  FREE_IP_DAILY_USD?: string;
  FREE_REQUEST_USD?: string;
  FREE_IP_CONCURRENCY?: string;
  FREE_CONCURRENCY?: string;
  PAID_REQUEST_USD?: string;
  SPUR_API_KEY?: string;
  INTERNAL_API_KEY?: string;
  SPUR_MONTHLY_LOOKUPS?: string;
}
export class SpendingError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) { super(message); }
}
export function setting(value: string | undefined, fallback: number): number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new SpendingError(503, "spending_configuration", "Spending limits are unavailable.");
  return n;
}
export const nano = (usd: number) => Math.ceil(usd * 1e9);
export function policy(env: SpendingEnv) {
  return {
    request: nano(setting(env.FREE_REQUEST_USD, 0.01)),
    ipDaily: nano(setting(env.FREE_IP_DAILY_USD, 0.5)),
    daily: nano(setting(env.FREE_DAILY_USD, 100)),
    ipConcurrency: Math.floor(setting(env.FREE_IP_CONCURRENCY, 4)),
    concurrency: Math.floor(setting(env.FREE_CONCURRENCY, 128)),
    paidRequest: nano(setting(env.PAID_REQUEST_USD, 10)),
    spurMonthly: Math.floor(setting(env.SPUR_MONTHLY_LOOKUPS, 45000)),
  };
}
export type Provider = ModelTokenUsage["provider"];
// Full provider context windows bound input without relying on token estimates.
const models: Record<string, { context: number; input: number; output: number }> = {
  "typesafe:jev-1.13.0": { context: 65536, input: 0.042, output: 0 },
  "beam:jev/laya": { context: 512, input: 0.021, output: 0 },
  "beam:jev/kev": { context: 8192, input: 0.021, output: 0 },
  "openrouter:google/gemini-3.8-flash": { context: 1048576, input: 0.75, output: 3.75 },
  "openrouter:ibm-granite/granite-4.0-h-micro": { context: 131000, input: 0.017, output: 0.112 },
  "openrouter:deepseek/deepseek-v4-flash": { context: 1048576, input: 0.056, output: 0.111 },
  "openrouter:inclusionai/ling-3.0-flash": { context: 262144, input: 0.021, output: 0.063 },
  "openrouter:inception/mercury-2.5": { context: 260000, input: 0.04, output: 0.15 },
  "openrouter:ibm-granite/granite-4.2-8b": { context: 131072, input: 0.06, output: 0.25 },
  "openrouter:qwen/qwen3.8-flash": { context: 1000000, input: 0.2, output: 0.47 },
  "openrouter:openai/gpt-5.6-luna": { context: 1050000, input: 0.5, output: 1.8 },
};
export function modelPrice(provider: Provider, model: string, output: number, body?: string) {
  const rate = models[`${provider}:${model}`];
  if (!rate || !Number.isSafeInteger(output) || output < 0 || output > 65536)
    throw new SpendingError(400, "unpriced_model", "This model or output limit is not configured for spending.");
  let input = rate.context;
  if (provider === "openrouter" && body) {
    const payload = JSON.parse(body);
    if (Array.isArray(payload.messages) && payload.messages.length === 2 &&
        payload.messages.every((m: { role?: string; content?: unknown }) => ["system", "user"].includes(m.role ?? "") && typeof m.content === "string") &&
        !payload.tools && !payload.plugins && !payload.models) {
      // Text-only byte bound, including Unicode normalization and framing.
      // No character/token average and no images, tools, or remote content.
      const bytes = new TextEncoder().encode(JSON.stringify(payload.messages).normalize("NFKC")).length;
      input = Math.min(input, bytes * 2 + 1024);
    }
  }
  return { ...rate, context: input, bound: Math.ceil((input * rate.input + output * rate.output) * 1000) };
}
export function network(ip: string): string {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.every(p => p <= 255)) return parts.join(".");
  }
  try {
    const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const [a, b] = canonical.split("::");
    const left = a ? a.split(":") : [];
    const right = b ? b.split(":") : [];
    const words = canonical.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
    if (words.length !== 8) throw new Error();
    const n = words.map(w => parseInt(w, 16));
    if (n.slice(0, 5).every(v => v === 0) && n[5] === 65535) return [n[6] >> 8, n[6] & 255, n[7] >> 8, n[7] & 255].join(".");
    return n.slice(0, 4).map(w => w.toString(16)).join(":") + "::/64";
  } catch { throw new SpendingError(400, "caller_identity", "A trusted client IP is required for free inference."); }
}
export async function fingerprint(env: SpendingEnv, value: string): Promise<string> {
  const salt = env.PRIVACY_SALT || env.ADMIN_SIGNING_KEY || env.REPORT_KEY;
  if (!salt) throw new SpendingError(503, "spending_configuration", "Private spending identity is unavailable.");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value)))].map(v => v.toString(16).padStart(2, "0")).join("");
}
export const SPENDING_ERROR_CODES = ["free_daily_budget", "free_ip_daily_budget", "free_ip_concurrency", "free_capacity", "request_spending_limit", "request_finished", "unpriced_model", "caller_identity", "spending_configuration", "spending_unavailable", "reputation_unavailable", "reputation_budget", "proxy_requires_payment", "duplicate_request", "invalid_settlement", "payload_too_large", "invalid_request", "insufficient_balance", "invalid_api_key", "inactive_api_key"] as const;
export function errorResponse(error: SpendingError): Response {
  const retryable = (error.status === 429 || error.status === 503) && !["reputation_budget", "spending_configuration", "unpriced_model"].includes(error.code);
  const retryAfter = retryable ? Number(error.details.retryAfter ?? 60) : undefined;
  const action = error.code === "duplicate_request" ? "Do not repeat this operation with a new key: it may already have run. Use the original response or request ID. Cached responses are not stored."
    : error.code === "payload_too_large" || error.code === "request_spending_limit" ? "Split the batch, shorten input text, labels or instructions, or use a funded workspace API key. Repeating the same request will not increase its allowance."
    : error.code === "insufficient_balance" ? "Wait for in-flight reservations to settle, add funds at https://classifier.dev/app/billing, or contact support with the request ID if billing is under review."
    : error.code === "caller_identity" ? "Send the request directly to https://classifier.dev, or use a funded workspace key. Caller-supplied forwarding headers cannot establish a free allowance."
    : error.code === "invalid_api_key" || error.code === "inactive_api_key" ? "Use an active workspace key from https://classifier.dev/app/keys in the Authorization: Bearer header."
    : error.code === "unpriced_model" ? "Choose a documented model. The TypeSafe-compatible endpoint accepts jev-1.13.0 and jev-latest."
    : error.code === "free_ip_concurrency" || error.code === "free_capacity" ? "Wait for in-flight requests to finish, then retry with backoff. Use a funded workspace key for a separate paid allowance."
    : "Use a funded workspace API key to continue outside the shared free allowance.";
  return Response.json({ error: error.message, code: error.code, retryable, action, docs: "https://classifier.dev/developers", ...error.details }, {
    status: error.status, headers: { "cache-control": "no-store", "access-control-allow-origin": "*", ...(retryAfter === undefined ? {} : { "retry-after": String(Math.max(1, Math.ceil(retryAfter))) }) },
  });
}
