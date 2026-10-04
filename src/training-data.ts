import type { Env } from "./index";

export const SHARING_VERSION = "2026-10-04-opt-out";
export const SHARING_DESCRIPTION = "Synchronous classification request text, labels, instructions and model results are retained for model training and operator review in private Cloudflare storage by default. Shared requests receive double per-minute and daily classification quotas. Set share_data: false or X-Classifier-Share-Data: false to opt out and use standard limits. Share only data you have permission to contribute; do not include confidential or personal information. Redaction is best effort. Billing, spending caps and input-size limits still apply.";
export const SHARING_SCHEMA = { type: "boolean", default: true, description: SHARING_DESCRIPTION };
export const SHARING_NOTICE = "Shared for model training by default; opt out with share_data=false or X-Classifier-Share-Data: false; https://classifier.dev/privacy";
export const SHARING_HINT = 'For double classification limits, enable training-data sharing with "share_data": true in the JSON body (MCP: tool arguments), or X-Classifier-Share-Data: true. This retains your text, labels, instructions and results for training and operator review. Share only with permission. See https://classifier.dev/privacy.';

export class SharingError extends Error {
  constructor(message: string, readonly status: 400 | 503, readonly code: "bad_share_data" | "data_sharing_unavailable") { super(message); }
}

export function sharingPreference(req: Request, body?: Record<string, unknown>): boolean | undefined {
  const values: boolean[] = [];
  if (body && Object.hasOwn(body, "share_data")) {
    if (typeof body.share_data !== "boolean") throw new SharingError("share_data must be the JSON boolean true or false.", 400, "bad_share_data");
    values.push(body.share_data);
  }
  for (const value of [req.headers.get("x-classifier-share-data"), ...new URL(req.url).searchParams.getAll("share_data")]) {
    if (value === null) continue;
    if (value !== "true" && value !== "false") throw new SharingError("Data sharing must be explicitly true or false.", 400, "bad_share_data");
    values.push(value === "true");
  }
  if (values.some(v => v !== values[0])) throw new SharingError("Conflicting data-sharing choices. Use one consistent sharing value.", 400, "bad_share_data");
  return values[0];
}

export function requireSharingStorage(env: Pick<Env, "TRAINING_DATA">, enabled: boolean) {
  if (enabled && !env.TRAINING_DATA) throw new SharingError("Training-data sharing is temporarily unavailable. Retry later or set share_data: false to use standard limits without collection.", 503, "data_sharing_unavailable");
}

function cleanText(value: string): string {
  return value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[redacted private key]")
    .replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [redacted]")
    .replace(/\b(?:classifier_(?:agent|pro)_|sk[_-]|ck_|ctxt_secret_|smry_|ibt_|gh[pousr]_|xox[baprs]-)[A-Za-z0-9_.-]+/g, "[redacted credential]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted token]")
    .replace(/\b(?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]\s*["']?[^\s,"'<>]+/gi, "[redacted credential]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted IP]");
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 30) return "[nested content omitted]";
  if (typeof value === "string") return cleanText(value);
  if (Array.isArray(value)) return value.map(item => sanitize(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    cleanText(key), /^(?:authorization|cookie|password|api[_-]?key|access[_-]?token|secret)$/i.test(key) ? "[redacted]" : sanitize(entry, depth + 1),
  ]));
  return value;
}

export type TrainingRecord = {
  schema_version: 1 | 2 | 3;
  label_source: "model_prediction" | null;
  redaction: { version: 1; applied: boolean };
  id: string;
  created_at: string;
  sharing: { policy_version: string; mode: "default" | "explicit"; purpose: "model_training" };
  endpoint: "classify" | "systemone";
  status: number;
  request: Record<string, unknown>;
  response: unknown;
  usage: unknown;
};

export async function saveTrainingData(env: Pick<Env, "TRAINING_DATA">, data: Pick<TrainingRecord, "endpoint" | "status" | "request" | "response" | "usage">, mode: "default" | "explicit"): Promise<"saved" | "failed"> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const record: TrainingRecord = {
    schema_version: 3, label_source: data.status < 400 ? "model_prediction" : null, redaction: { version: 1, applied: false }, id, created_at: new Date(now).toISOString(),
    sharing: { policy_version: SHARING_VERSION, mode, purpose: "model_training" },
    ...data, request: sanitize(data.request) as Record<string, unknown>, response: sanitize(data.response), usage: sanitize(data.usage),
  };
  record.redaction.applied = JSON.stringify([data.request, data.response]) !== JSON.stringify([record.request, record.response]);
  // Reverse timestamps let R2's ordered listing show recent contributions first.
  const key = `requests/${String(9_999_999_999_999 - now).padStart(13, "0")}-${id}.json`;
  const inputs = record.request.inputs;
  const preview = Array.isArray(inputs) ? inputs[0] : typeof record.request.state === "string" ? record.request.state : "System One request";
  const bytes = new TextEncoder().encode(String(preview ?? "").slice(0, 160));
  try {
    if (!env.TRAINING_DATA) return "failed";
    await env.TRAINING_DATA.put(key, JSON.stringify(record), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { created: record.created_at, endpoint: record.endpoint, status: String(record.status),
        items: String(Array.isArray(inputs) ? inputs.length : 1), model: String(record.request.model ?? "jev"), preview: btoa(String.fromCharCode(...bytes)) },
    });
    return "saved";
  } catch {
    console.error("Training-data write failed");
    return "failed";
  }
}

export function trainingPreview(metadata: Record<string, string>): string {
  try { return new TextDecoder().decode(Uint8Array.from(atob(metadata.preview ?? ""), c => c.charCodeAt(0))); }
  catch { return "Preview unavailable"; }
}

export const TRAINING_KEY = /^requests\/\d{13}-[0-9a-f-]{36}\.json$/;
