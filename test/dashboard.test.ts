import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { adminResponse } from "../src/admin";
import type { Env } from "../src/index";

const PASSWORD = "correct horse battery staple";
const env = { ADMIN_PASSWORD: PASSWORD, ADMIN_SIGNING_KEY: "signing-key-under-test" } as unknown as Env;
const IP = "203.0.113.47";
const FINGERPRINT = "ls_a1b2c3d4e5f60718";

/**
 * One fat row answers every query the page makes: each panel reads the columns
 * it asked for by name and ignores the rest.
 */
const ROW = {
  t: "2026-09-19 08:00:00", requests: 412, classifications: 1286, usd: 0.0431, avg_ms: 143,
  tier: "fast", model: "jev-1.13.0", country: "US", status: "200", client: "public",
  labels: FINGERPRINT, reason: "rate_limit_minute", agent: "curl", avg_inputs: 3, n: 7,
};

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: [ROW, { ...ROW, t: "2026-09-19 09:00:00", requests: 908 }] }), {
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

async function dashboard() {
  const body = new FormData();
  body.set("password", PASSWORD);
  const login = (await adminResponse(
    new Request("https://classifier.dev/admin", { method: "POST", body, headers: { origin: "https://classifier.dev" } }),
    env, "admin", IP,
  ))!;
  const set = login.headers.get("set-cookie")!;
  const cookie = set.slice(0, set.indexOf(";"));
  const res = (await adminResponse(
    new Request("https://classifier.dev/admin?range=7d", { headers: { cookie } }), env, "admin", IP,
  ))!;
  return { res, body: await res.text() };
}

describe("a dashboard with data on it", () => {
  test("renders the report and supplies authenticated chart data", async () => {
    const { res, body } = await dashboard();
    expect(res.status).toBe(200);
    expect(body).toContain("API analytics");
    expect(body).toContain("jev-1.13.0");
    expect(body).toContain('src="/admin-assets/admin.js"');
    expect(body).toContain('&quot;series&quot;:');
    expect(body).toContain("last 7 days");
    expect(body).not.toContain("no data in this range yet");
    expect(body).not.toContain("some panels are empty");
  });

  test("shows classifiers as fingerprints, and calls callers callers", async () => {
    const { body } = await dashboard();
    expect(body).toContain(FINGERPRINT);
    expect(body).toContain("observed caller-days");
    expect(body).not.toContain("unique IPs");
    expect(body).not.toContain("Top label sets");
  });

  test("escapes what it puts on the page", async () => {
    const { body } = await dashboard();
    expect(body).not.toContain("<script>alert");
    // The one script is ours, and the policy names it.
    const csp = (await dashboard()).res.headers.get("content-security-policy")!;
    expect(csp).toMatch(/script-src 'nonce-[A-Za-z0-9+/]+'/);
  });
});
