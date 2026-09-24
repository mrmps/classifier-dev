import type { Meter } from "./cost";

type Row = Record<string, unknown>;
const n = (value: unknown) => Number(value) || 0;

export function requestTokens(meter?: Meter) {
  const rows = meter?.tokens ?? [];
  const known = rows.length > 0 && rows.every(r => r.inputTokens !== null && r.outputTokens !== null);
  return {
    input: rows.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0),
    output: rows.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0),
    known: Number(known),
    calls: rows.reduce((sum, r) => sum + r.calls, 0),
    providers: [...new Set(rows.map(r => r.provider))].sort().join(","),
  };
}

export function modelUsageQuery(since: string) {
  return `SELECT blob6 AS model, blob4 AS status, blob10 AS modality, blob11 AS provider,
    sum(_sample_interval) AS requests, sum(double1 * _sample_interval) AS classifications,
    sum(double2 * _sample_interval) AS ms_sum, sum(double3 * _sample_interval) AS usd,
    sum(double10 * _sample_interval) AS input_tokens, sum(double11 * _sample_interval) AS output_tokens,
    sum(double12 * _sample_interval) AS token_requests, sum(double13 * _sample_interval) AS images,
    sum(double14 * _sample_interval) AS calls
    FROM classifier_events WHERE timestamp > ${since}
    GROUP BY model, status, modality, provider ORDER BY requests DESC`;
}

/** Request model combinations stay together: splitting them would duplicate spend and decisions. */
export function modelUsage(rows: Row[]) {
  const grouped = new Map<string, {
    model: string; requests: number; classifications: number; usd: number; ms_sum: number;
    ok: number; failures: number; rejected: number; input_tokens: number; output_tokens: number;
    token_requests: number; images: number; image_requests: number; modality_requests: number; calls: number; providers: Set<string>;
  }>();
  for (const r of rows) {
    const model = String(r.model || "Unattributed");
    const row = grouped.get(model) ?? {model, requests: 0, classifications: 0, usd: 0, ms_sum: 0,
      ok: 0, failures: 0, rejected: 0, input_tokens: 0, output_tokens: 0, token_requests: 0,
      images: 0, image_requests: 0, modality_requests: 0, calls: 0, providers: new Set<string>()};
    for (const key of ["requests", "classifications", "usd", "input_tokens", "output_tokens", "token_requests", "images", "calls"] as const) row[key] += n(r[key]);
    const status = String(r.status);
    if (status === "200") row.ok += n(r.requests);
    if (status.startsWith("5")) row.failures += n(r.requests);
    if (status.startsWith("4")) row.rejected += n(r.requests);
    if (status === "200" || status.startsWith("5")) row.ms_sum += n(r.ms_sum);
    if (r.modality === "image" || r.modality === "text") row.modality_requests += n(r.requests);
    if (r.modality === "image") row.image_requests += n(r.requests);
    for (const provider of String(r.provider || "").split(",").filter(Boolean)) row.providers.add(provider);
    grouped.set(model, row);
  }
  return [...grouped.values()].map(({providers, ms_sum, ...r}) => ({...r,
    provider: [...new Set([...providers].map(provider => ({typesafe: "TypeSafe", beam: "Beam", vercel: "Vercel Gateway", openrouter: "OpenRouter", dgemma: "RunPod", chunklaya: "RunPod"})[provider] ?? provider))].join(", ") || "Not recorded",
    avg_ms: r.ok + r.failures ? ms_sum / (r.ok + r.failures) : null,
    image_requests: r.modality_requests ? r.image_requests : null,
    images: r.modality_requests ? r.images : null,
    calls: r.modality_requests ? r.calls : null,
    input_tokens: r.token_requests || r.input_tokens ? r.input_tokens : null,
    output_tokens: r.token_requests || r.output_tokens ? r.output_tokens : null,
    cost_basis: providers.has("dgemma") || providers.has("chunklaya") || /(^|,)(dgemma|chunklaya\/)/.test(r.model)
      ? "Hourly GPU excluded" : "Recorded API cost",
  })).sort((a, b) => b.requests - a.requests);
}
