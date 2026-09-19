import { afterEach, expect, test } from "bun:test";
import worker, { type Env } from "../src/index";
import { parseFeedback, LIMITS } from "../src/feedback";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const report = { signal: { category: "bug" }, content: { title: "Example report" } };

test("missing or malformed confidence stays unknown", () => {
  for (const confidence of [undefined, null, "", false, { toString: null }]) {
    expect(parseFeedback({ ...report, signal: { category: "bug", confidence } }).signal.confidence).toBeNull();
  }
  expect(parseFeedback({ ...report, signal: { category: "bug", confidence: 0 } }).signal.confidence).toBe(0);
});

test("the evidence byte limit counts UTF-8, not characters", () => {
  const content = "界".repeat(Math.floor(LIMITS.max_evidence_content_bytes / 3) + 1);
  expect(() => { parseFeedback({ ...report, evidence: [{ type: "other", content }] }); }).toThrow("too large");
});

test("feedback never persists or emails the caller's bearer credential", async () => {
  const writes: string[] = [];
  const mail: string[] = [];
  const pending: Promise<unknown>[] = [];
  globalThis.fetch = (async (_url, init) => {
    mail.push(String(init?.body));
    return Response.json({ id: "test" });
  }) as typeof fetch;
  const env = {
    RESEND_API_KEY: "mail-test-key", REPORT_TO: "owner@example.test",
    STATS: { get: async () => null, put: async (_key: string, value: string) => { writes.push(value); } },
  } as unknown as Env;
  const response = await worker.fetch(new Request("https://classifier.dev/api/v1/feedback", {
    method: "POST", headers: { authorization: "Bearer s3cr3t" }, body: JSON.stringify(report),
  }), env, { waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as ExecutionContext);
  expect(response.status).toBe(202);
  await Promise.all(pending);
  expect(mail).toHaveLength(1);
  expect(writes.join("\n") + mail.join("\n")).not.toContain("s3cr3t");
});
