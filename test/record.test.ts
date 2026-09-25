import { describe, expect, test } from "bun:test";

import { countUncertain, record } from "../src/index";
import type { Env } from "../src/index";

const IP = "203.0.113.47";
const LABELS = ["invoice", "receipt", "payslip"];

/** Collects what the request would have written, and waits for it to be written. */
function spy() {
  const points: { blobs: string[]; indexes: string[] }[] = [];
  const kv: { key: string; value: string }[] = [];
  const pending: Promise<unknown>[] = [];
  const env = {
    PRIVACY_SALT: "salt-under-test-0000000000000000",
    AE: { writeDataPoint: (p: { blobs: string[]; indexes: string[] }) => points.push(p) },
    STATS: { get: async () => null, put: async (key: string, value: string) => void kv.push({ key, value }) },
  } as unknown as Env;
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as ExecutionContext;
  return { env, ctx, points, kv, settled: () => Promise.all(pending) };
}

const write = async (s: ReturnType<typeof spy>) => {
  record(s.env, s.ctx, {
    tier: "fast", n: 3, ms: 120, labels: LABELS, ip: IP, country: "US", status: 200,
    client: "public", model: "jev-1.13.0", usd: 0.0001, attempted: 3, escalationFailed: 0,
    reason: "", agent: "curl",
  } as Parameters<typeof record>[2]);
  await s.settled();
};

describe("what a request leaves behind", () => {
  test("is never the caller's address", async () => {
    const s = spy();
    await write(s);
    const written = JSON.stringify(s.points) + JSON.stringify(s.kv);
    expect(written).not.toContain(IP);
    expect(written).not.toContain("203.0.113");
    expect(s.points[0].indexes[0]).toMatch(/^c_[0-9a-f]{16}$/);
  });

  test("keeps labels only in the separate aggregate registry", async () => {
    const s = spy();
    await write(s);
    const analytics = JSON.stringify(s.points);
    for (const label of LABELS) expect(analytics).not.toContain(label);
    expect(s.points[0].blobs[1]).toMatch(/^ls_[0-9a-f]{16}$/);
    expect(s.kv[0].key).toMatch(/^cls:ls_[0-9a-f]{16}$/);
    expect(JSON.parse(s.kv[0].value)).toMatchObject({ labels: ["invoice", "payslip", "receipt"] });
  });

  test("still carries everything the dashboard counts", async () => {
    const s = spy();
    await write(s);
    expect(s.points[0].blobs[0]).toBe("fast");
    expect(s.points[0].blobs[2]).toBe("US");
    expect(s.points[0].blobs[3]).toBe("200");
    expect(s.points[0].blobs[5]).toBe("jev-1.13.0");
  });
});

/**
 * The digest's "uncertain" column mixes scales unless it stays on the one
 * scale ESCALATE_BELOW was tuned for: choice confidence. A null confidence
 * means "no comparable estimate" — a multi-label answer whose nouls are all
 * near zero is a confident "none apply", not an uncertain answer.
 */
describe("the uncertain counter", () => {
  test("counts low choice confidence and escalations, never the absence of an estimate", () => {
    expect(countUncertain([
      { confidence: 0.95 },                      // confident choice
      { confidence: 0.4 },                       // uncertain choice
      { confidence: null, escalated: true },     // was uncertain, re-asked
      { confidence: null },                      // multi-label or unscored fallback: no comparable estimate
    ])).toBe(2);
  });
});
