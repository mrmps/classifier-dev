import { describe, expect, test } from "bun:test";

import { record } from "../src/index";
import type { Env } from "../src/index";

const IP = "203.0.113.47";
const LABELS = ["invoice", "receipt", "payslip"];

/** Collects what the request would have written, and waits for it to be written. */
function spy() {
  const points: { blobs: string[]; indexes: string[] }[] = [];
  const kv: string[] = [];
  const pending: Promise<unknown>[] = [];
  const env = {
    PRIVACY_SALT: "salt-under-test-0000000000000000",
    AE: { writeDataPoint: (p: { blobs: string[]; indexes: string[] }) => points.push(p) },
    STATS: { get: async () => null, put: async (k: string) => void kv.push(k) },
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
    const written = JSON.stringify(s.points) + s.kv.join(" ");
    expect(written).not.toContain(IP);
    expect(written).not.toContain("203.0.113");
    expect(s.points[0].indexes[0]).toMatch(/^c_[0-9a-f]{16}$/);
  });

  test("is never the caller's labels", async () => {
    const s = spy();
    await write(s);
    const written = JSON.stringify(s.points) + s.kv.join(" ");
    for (const label of LABELS) expect(written).not.toContain(label);
    expect(s.points[0].blobs[1]).toMatch(/^ls_[0-9a-f]{16}$/);
    expect(s.kv[0]).toMatch(/^cls:ls_[0-9a-f]{16}$/);
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
