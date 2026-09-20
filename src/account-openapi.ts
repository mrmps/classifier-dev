/** Account reads are authenticated, unlike the public classification endpoints. */
const json = (schema: object) => ({ "application/json": { schema } });
const error = (description: string) => ({ description, content: json({
  type: "object", required: ["error"], properties: { error: { type: "string" } },
}) });
const responses = {
  "400": error("Invalid or duplicate query parameter, or unsupported date range."),
  "401": error("Missing, invalid, paused, revoked, or local-only workspace API key."),
  "405": error("Only GET is supported."),
  "503": error("Account access or analytics is not enabled or temporarily unavailable."),
};
const filters = [
  { name: "from", schema: { type: "string", format: "date-time" }, description: "Inclusive start, within the last 90 days. Defaults to 30 days ago." },
  { name: "to", schema: { type: "string", format: "date-time" }, description: "Exclusive end. Defaults to now." },
  { name: "key_id", schema: { type: "string" }, description: "Filter by a workspace API key ID." },
  { name: "agent_id", schema: { type: "string" }, description: "Filter by an agent identifier recorded with the request." },
  { name: "tier", schema: { type: "string", enum: ["fast", "smart"] } },
  { name: "source", schema: { type: "string", enum: ["api", "mcp"] } },
  { name: "status", schema: { type: "string", enum: ["success", "error"] } },
].map((parameter) => ({ ...parameter, in: "query", required: false }));
const analyticsResponse = {
  type: "object", required: ["data", "meta"],
  properties: {
    data: { type: "array", items: { type: "object", additionalProperties: { type: ["string", "number", "null"] } },
      description: "Summary/timeseries/breakdown rows include requests, items, token and cost totals, missing-value counters, latencyMs, errors, sampleInterval and latestEventAt. Timeseries adds bucket; breakdown adds dimension. Activity rows include requestId, keyId, agentId, source, tier, model, status and timestamp. Content is not returned." },
    meta: { type: "object", required: ["queriedAt", "latestEventAt", "sampled", "exact", "retentionDays"], properties: {
      queriedAt: { type: "string", format: "date-time" }, latestEventAt: { type: ["string", "null"] },
      sampled: { type: "boolean" }, exact: { const: false }, retentionDays: { const: 90 },
    } },
  },
};
function analytics(operationId: string, summary: string, description: string, parameters: object[] = []) {
  return { get: {
    operationId, summary, description: `${description} Analytics may be delayed or sampled; use /v1/account/balance for exact spendable funds. Workspace is derived from the API key; an account ID cannot be supplied. Responses are private and not cached.`,
    tags: ["account"], security: [{ accountKey: [] }], parameters: [...filters, ...parameters],
    responses: { ...responses, "429": error("Analytics query budget exhausted. Your balance is unaffected."),
      "200": { description: "Workspace analytics", content: json(analyticsResponse) } },
  } };
}
export const ACCOUNT_PATHS = {
  "/v1/account/balance": { get: {
    operationId: "getAccountBalance", summary: "Read exact available and reserved workspace funds",
    description: "No query parameters. Amounts are USD decimal strings with five fractional digits. Available funds exclude pending reservations. Requires an active workspace API key; legacy Pro and partner keys do not authorize account reads. Responses are private and not cached.",
    tags: ["account"], security: [{ accountKey: [] }], responses: { ...responses,
      "404": error("Workspace no longer exists."),
      "200": { description: "Exact ledger snapshot", content: json({ type: "object", required: ["currency", "available", "reserved", "exact"], properties: {
        currency: { const: "USD" }, available: { type: "string", pattern: "^[0-9]+\\.[0-9]{5}$" },
        reserved: { type: "string", pattern: "^[0-9]+\\.[0-9]{5}$" }, exact: { const: true },
      } }) },
    },
  } },
  "/v1/account/usage/summary": analytics("getAccountUsageSummary", "Read workspace usage totals", "Aggregates the selected period."),
  "/v1/account/usage/timeseries": analytics("getAccountUsageTimeseries", "Read hourly or daily workspace usage", "Returns at most 745 buckets. Hourly ranges cannot exceed 31 days.", [
    { name: "interval", in: "query", required: false, schema: { type: "string", enum: ["hour", "day"], default: "day" } },
  ]),
  "/v1/account/usage/breakdown": analytics("getAccountUsageBreakdown", "Compare workspace usage by key, agent, tier or model", "Returns the top 50 groups ordered by requests.", [
    { name: "group_by", in: "query", required: false, schema: { type: "string", enum: ["key", "agent", "tier", "model"], default: "key" } },
  ]),
  "/v1/account/activity": analytics("getAccountActivity", "Read recent workspace request metadata", "Returns at most 100 recent events, newest first. Sampled activity is not an exhaustive audit log."),
};
