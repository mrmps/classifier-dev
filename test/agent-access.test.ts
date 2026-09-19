import { describe, expect, test } from "bun:test";
import worker, { type Env } from "../src/index";

const env = { AGENT_API_KEY: "operator-test-secret", ENTERPRISE_API_KEY: "enterprise-test-secret" } as Env;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

async function request(authorization?: string) {
  return worker.fetch(new Request("https://classifier.dev", {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: JSON.stringify({ inputs: ["example"], labels: ["only-one-label"] }),
  }), env, ctx);
}

describe("operator agent access", () => {
  test.each(["operator-test-secret", "enterprise-test-secret"])("accepts an independently configured credential: %s", async (key) => {
    const response = await request(`Bearer ${key}`);
    expect(response.status).toBe(400);
    expect(response.headers.get("ratelimit-policy")).toBe("unlimited");
  });
  test.each([undefined, "Bearer wrong-secret", "Basic operator-test-secret", "Bearer operator-test-secret extra"])("keeps public quotas for missing or malformed auth: %s", async (authorization) => {
    const response = await request(authorization);
    expect(response.status).toBe(400);
    expect(response.headers.get("ratelimit-policy")).not.toBe("unlimited");
  });
  test("does not grant access to the private operator report", async () => {
    const response = await worker.fetch(new Request("https://classifier.dev/report", {
      headers: { authorization: "Bearer operator-test-secret" },
    }), { ...env, REPORT_KEY: "different-report-secret" }, ctx);
    expect(response.status).toBe(404);
  });
});
