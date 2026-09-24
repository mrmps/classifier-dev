import type { AdminData } from "../src/admin";

/** Deterministic synthetic telemetry for visual review, never served in production. */
export function adminFixture(): AdminData {
  const generatedAt = "2026-09-20T20:30:00.000Z";
  const series = Array.from({ length: 25 }, (_, i) => {
    const requests = Math.round(
      900 + Math.sin(i / 3) * 420 + i * 88 + (i === 16 ? 1900 : 0),
    );
    return {
      t: new Date(
        Date.parse(generatedAt) - 24 * 3600000 - 30 * 60000 + i * 3600000,
      ).toISOString(),
      requests,
      classifications: requests * 8,
      usd: requests * 0.000021,
    };
  });
  const requests = series.reduce((a, r) => a + r.requests, 0),
    classifications = requests * 8,
    usd = requests * 0.000021;
  const totals = [{ requests, classifications, usd, avg_ms: 142 }];
  return {
    generatedAt,
    chatOutcomes: [
      { outcome: "completed", turns: 428, ms: 3424000, modelCalls: 720, inputTokens: 504000, outputTokens: 129600, usd: 1.42, unknownTokenCalls: 3, unknownCostCalls: 3, toolCalls: 292, classifyCalls: 211, webSearches: 42, pageReads: 21, clockCalls: 18, toolErrors: 7, starts: 186 },
      { outcome: "failed", turns: 8, ms: 120000, modelCalls: 8, unknownTokenCalls: 8, unknownCostCalls: 8, toolCalls: 0, starts: 5 },
      { outcome: "stopped", turns: 12, ms: 24000, modelCalls: 12, unknownTokenCalls: 12, unknownCostCalls: 12, toolCalls: 0, starts: 3 },
      { outcome: "rate_limited", turns: 17, modelCalls: 0 },
    ],
    chatSeries: series.map((row, i) => ({ t: row.t, turns: 4 + i, usd: (4 + i) * 0.003, avg_ms: 6000 + i * 100 })),
    chatCallers: 86,
    totals,
    series,
    previous: [
      {
        requests: requests * 0.72,
        classifications: classifications * 0.69,
        usd: usd * 0.81,
        avg_ms: 180,
      },
    ],
    byTier: [
      {
        tier: "fast",
        requests: requests * 0.92,
        classifications: classifications * 0.92,
        usd: usd * 0.34,
        avg_ms: 93,
      },
      {
        tier: "smart",
        requests: requests * 0.08,
        classifications: classifications * 0.08,
        usd: usd * 0.66,
        avg_ms: 706,
      },
    ],
    modelSeries: [],
    modelFailures: [],
    byModel: [
      {
        model: "jev-4.1",
        requests: requests * 0.92,
        classifications: classifications * 0.92,
        usd: usd * 0.34,
        avg_ms: 93,
      },
      {
        model: "gemini-2.5-flash",
        requests: requests * 0.06,
        classifications: classifications * 0.06,
        usd: usd * 0.45,
        avg_ms: 621,
      },
      {
        model: "gpt-4.1-mini",
        requests: requests * 0.02,
        classifications: classifications * 0.02,
        usd: usd * 0.21,
        avg_ms: 961,
      },
    ],
    byCountry: [
      { country: "US", requests: requests * 0.55 },
      { country: "GB", requests: requests * 0.19 },
      { country: "DE", requests: requests * 0.13 },
      { country: "IN", requests: requests * 0.08 },
      { country: "CA", requests: requests * 0.05 },
    ],
    byStatus: [
      { status: "200", requests: requests - 112 },
      { status: "429", requests: 80 },
      { status: "400", requests: 20 },
      { status: "502", requests: 12 },
    ],
    byClient: [
      {
        client: "public",
        requests: requests * 0.72,
        classifications: classifications * 0.72,
        usd: usd * 0.72,
      },
      {
        client: "enterprise",
        requests: requests * 0.28,
        classifications: classifications * 0.28,
        usd: usd * 0.28,
      },
    ],
    byAgent: [
      {
        agent: "python",
        requests: requests * 0.4,
        classifications: classifications * 0.4,
      },
      {
        agent: "node",
        requests: requests * 0.3,
        classifications: classifications * 0.3,
      },
      {
        agent: "mcp",
        requests: requests * 0.2,
        classifications: classifications * 0.2,
      },
      {
        agent: "curl",
        requests: requests * 0.1,
        classifications: classifications * 0.1,
      },
    ],
    topLabels: [
      {
        label_names: "billing · product question · technical support",
        labels: "ls_9f3c7a8d",
        requests: 19002,
        classifications: 152016,
        usd: 0.4,
      },
      {
        label_names: "ham · spam",
        labels: "ls_64b1e7af",
        requests: 9211,
        classifications: 73688,
        usd: 0.18,
      },
    ],
    visitors: 284,
    labelSets: 92,
    byReason: [
      {
        reason: "rate_limit_minute",
        status: "429",
        agent: "python",
        requests: 80,
        avg_inputs: 32,
      },
      {
        reason: "too_few_labels",
        status: "400",
        agent: "node",
        requests: 20,
        avg_inputs: 1,
      },
      {
        reason: "timeout",
        status: "502",
        agent: "mcp",
        requests: 12,
        avg_inputs: 8,
      },
    ],
    failLabels: [
      { label_names: "billing · product question · technical support", labels: "ls_9f3c7a8d", reason: "label_set_limit", requests: 80 },
    ],
    dimensionTraffic: [
      {
        status: "200",
        reason: "",
        requests: 8200,
        classifications: 98400,
        items: 32800,
        dimensions: 24600,
        uncertain: 1900,
        fallback: 402,
        usd: 0.38,
        ms_sum: 1500600,
      },
      {
        status: "502",
        reason: "timeout",
        requests: 4,
        classifications: 0,
        items: 0,
        dimensions: 0,
        uncertain: 0,
        fallback: 0,
        usd: 0,
        ms_sum: 32000,
      },
    ],
    dimensionCallers: 78,
    dimensionSeries: series.map((r) => ({
      t: r.t,
      requests: Math.round(r.requests * 0.16),
      classifications: Math.round(r.classifications * 0.23),
    })),
    performance: series.map((r, i) => ({
      t: r.t,
      avg_ms: 110 + Math.sin(i / 3) * 35 + (i === 16 ? 270 : 0),
      batch_size: 7 + Math.sin(i / 4) * 3,
      requests: r.requests,
    })),
    outcomes: series.flatMap((r, i) => [
      { t: r.t, status: "200", requests: r.requests - (i === 16 ? 112 : 0) },
      { t: r.t, status: "502", requests: i === 16 ? 12 : 0 },
      { t: r.t, status: "429", requests: i === 16 ? 80 : 0 },
      { t: r.t, status: "400", requests: i === 16 ? 20 : 0 },
    ]),
    errors: [],
    unavailable: [],
  };
}
