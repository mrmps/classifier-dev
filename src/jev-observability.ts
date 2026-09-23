/** Provider attempts are separate from request analytics: a recovered failure
 * must remain visible without inflating request counts. Never record payloads,
 * provider messages, keys, caller identifiers or label sets here. */
export type JevAttempt = {
  provider: "gateway" | "typesafe" | "beam" | "chunklaya" | "dgemma";
  outcome: "success" | "failure" | "skipped";
  reason: string;
  status: number;
  ms: number;
  items: number;
  attempt: number;
};

export function recordJevAttempt(analytics: AnalyticsEngineDataset | undefined, event: JevAttempt) {
  try {
    analytics?.writeDataPoint({
      blobs: [event.provider, event.outcome, event.reason],
      doubles: [event.status, event.ms, event.items, event.attempt],
      indexes: [event.provider],
    });
  } catch {
    // A telemetry outage must not prevent classification.
    console.warn("jev_analytics_write_failed");
  }
}

/** Weighted counts remain valid when Analytics Engine samples events. */
export function jevAttemptsQuery(minutes: number) {
  return `SELECT blob1 AS provider, blob2 AS outcome, blob3 AS reason,
    double1 AS status, sum(_sample_interval) AS attempts,
    sum(double2 * _sample_interval) / sum(_sample_interval) AS avg_ms
    FROM classifier_jev_attempts
    WHERE timestamp > toDateTime(now()) - INTERVAL '${minutes}' MINUTE
    GROUP BY provider, outcome, reason, status ORDER BY attempts DESC`;
}
