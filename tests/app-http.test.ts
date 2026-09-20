import { afterEach, beforeEach, expect, test } from "bun:test";
import { database } from "./support/postgres";
import { demoLogin } from "../src/server/auth";
import { performAction } from "../src/server/agents";
import { getSnapshot } from "../src/server/accounts";
import { accountClassification } from "../src/http/classification";
import { accountMcp } from "../src/http/mcp";
import { isAppRequest } from "../src/http/dispatch";
import type { AppEnv } from "../src/server/db";
import type { Env } from "../src/index";

let env: AppEnv & Partial<Env>;
let token: string;
let agentId: string;
const originalFetch = globalThis.fetch;
const request = (body: unknown) =>
  new Request("http://localhost/v1/classify", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
beforeEach(async () => {
  env = { APP_DB: database(), APP_DEMO: "true", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters", TYPESAFE_API_KEY: "provider-fixture", STATS: { get: async () => null, put: async () => {} } as unknown as KVNamespace };
  await demoLogin(
    new Request("http://localhost/auth/demo", {
      headers: { Origin: "http://localhost" },
    }),
    env,
  );
  const result = await performAction(
    "local-demo",
    { type: "enroll", client: "Codex" },
    env,
  );
  token = result.secret!;
  agentId = result.agentId!;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test.skipIf(process.env.LIVE_TOKEN_BILLING !== "true")("real pinned TypeSafe request runs the account HTTP reservation and settlement path", async () => {
  expect(Boolean(process.env.TYPESAFE_API_KEY)).toBe(true);
  env.TYPESAFE_API_KEY = process.env.TYPESAFE_API_KEY;
  const response = await accountClassification(request({ inputs: ["Please send my invoice"], labels: ["billing", "support"] }), env);
  expect(response?.status).toBe(200);
  expect(response?.headers.get("x-billing-status")).toBe("settled");
  const row = await env.APP_DB.prepare("SELECT status,input_tokens,actual_nano::text AS nano,credits,reserved_credits FROM app_usage WHERE id=?")
    .bind(response!.headers.get("x-request-id")).first<{status:string;input_tokens:number;nano:string;credits:number;reserved_credits:number}>();
  expect(row?.status).toBe("completed");
  expect(row!.input_tokens).toBeGreaterThan(0);
  expect(BigInt(row!.nano)).toBe(BigInt(row!.input_tokens) * 42n);
  expect(row!.credits).toBeLessThan(row!.reserved_credits);
  console.info(JSON.stringify({ proof: "live account HTTP", inputTokens: row!.input_tokens, actualNanodollars: row!.nano, chargedCredits: row!.credits }));
}, 30000);

test("application namespaces do not capture legacy API, docs, or classification URLs", () => {
  for (const path of [
    "/app",
    "/app/agents",
    "/_server/function",
    "/auth/callback",
    "/login",
  ])
    expect(isAppRequest(new Request(`http://localhost${path}`))).toBe(true);
  for (const path of [
    "/",
    "/v1/classify",
    "/mcp",
    "/pro",
    "/developers",
    "/spam,ham/message",
    "/application",
  ])
    expect(isAppRequest(new Request(`http://localhost${path}`))).toBe(false);
});

function jevResponse(init?: RequestInit, inputTokens?: number) {
  const body = JSON.parse(String(init?.body));
  return Response.json({ model: "jev-1.13.0", usage: { input_tokens: inputTokens }, answers: Object.fromEntries(
    Object.entries(body.questions).map(([id, question]) => {
      const q = question as { criteria?: Record<string, unknown> };
      const labels = Object.keys(q.criteria ?? {});
      return [id, labels.length ? { choice: labels[0], confidence: 0.99, probabilities: Object.fromEntries(labels.map((label, i) => [label, i ? 0.01 : 0.99])) } : { noul: 0.99 }];
    })) });
}

test("classification adapter uses provider credential, meters actual tokens, and enforces revoked access", async () => {
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls++;
    expect(String(url)).toBe("https://api.typesafe.ai/v1/systemone");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer provider-fixture");
    expect(JSON.parse(String(init?.body)).model).toBe("jev-1.13.0");
    return jevResponse(init, 41);
  }) as typeof fetch;
  const response = await accountClassification(
    request({
      items: ["Help with my invoice"],
      dimensions: { team: ["billing", "sales"], kind: ["bug", "request"] },
    }),
    env,
  );
  expect(response?.status).toBe(200);
  const snapshot = await getSnapshot("local-demo", env);
  expect(snapshot.credits.balance).toBe(499999);
  expect(snapshot.usage[0].items).toBe(1);
  expect(snapshot.usage[0].credits).toBe(1);
  expect(snapshot.usage[0].type).toBe("API · Dimensions");
  expect(snapshot.usage[0].inputTokens).toBe(41);
  expect(snapshot.usage[0].outputTokens).toBeNull();
  await performAction("local-demo", { type: "revoke", agentId }, env);
  await expect(
    accountClassification(
      request({ inputs: ["Hello"], labels: ["a", "b"] }),
      env,
    ),
  ).rejects.toThrow();
  expect(calls).toBe(1);
});

test.each(["input", "inputs"])("account billing accepts the public API's scalar %s field", async (field) => {
  globalThis.fetch = (async (_url, init) => jevResponse(init, 41)) as typeof fetch;
  const response = await accountClassification(request({ [field]: "Help with my invoice", labels: ["billing", "sales"] }), env);
  expect(response?.status).toBe(200);
  expect(response?.headers.get("x-billing-status")).toBe("settled");
  const snapshot = await getSnapshot("local-demo", env);
  expect(snapshot.usage[0].items).toBe(1);
  expect(snapshot.usage[0].inputTokens).toBe(41);
});

test("settlement failure returns the held request ID for reconciliation", async () => {
  globalThis.fetch = (async (_url, init) => jevResponse(init, 41)) as typeof fetch;
  const db = env.APP_DB;
  env.APP_DB = { ...db, prepare(sql) {
    if (sql.includes("settle_token_reservation(")) throw new Error("Database unavailable");
    return db.prepare(sql);
  } };
  const response = await accountClassification(request({ inputs: ["Invoice"], labels: ["billing", "sales"] }), env);
  expect(response?.status).toBe(503);
  const requestId = response?.headers.get("x-request-id");
  expect(requestId).toBeTruthy();
  expect(response?.headers.get("x-billing-status")).toBe("review");
  expect(response?.headers.get("cache-control")).toBe("no-store");
  expect(await response!.json()).toMatchObject({ requestId });
  const usage = await db.prepare("SELECT status,actual_nano FROM app_usage WHERE id=?").bind(requestId).first();
  expect(usage).toEqual({ status: "pending", actual_nano: null });
});

test("invalid inputs do not reserve; upstream errors return reserved credits", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return Response.json({ error: "Unavailable" }, { status: 400 });
  }) as typeof fetch;
  await expect(
    accountClassification(request({ inputs: [] }), env),
  ).rejects.toThrow();
  expect(calls).toBe(0);
  await expect(accountClassification(
    request({ inputs: ["Hello"], labels: ["a", "b"] }),
    env,
  )).rejects.toThrow("not configured for account billing");
  const snapshot = await getSnapshot("local-demo", env);
  expect(snapshot.credits.balance).toBe(500000);
  expect(snapshot.onboarding.completed).toBe(false);
  expect(snapshot.usage[0].status).toBe("refunded");
});

test("local account tokens are never forwarded from a production hostname", async () => {
  globalThis.fetch = (async () => {
    throw new Error("Must not run");
  }) as typeof fetch;
  const req = new Request("https://classifier.dev/v1/classify", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: "{}",
  });
  await expect(accountClassification(req, env)).rejects.toThrow("not enabled");
});

test("MCP tool call uses the same credential and usage accounting as REST", async () => {
  globalThis.fetch = (async (_url, init) => jevResponse(init, 100)) as typeof fetch;
  const req = new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "classify_texts",
        arguments: { inputs: ["test"], labels: ["yes", "no"] },
      },
    }),
  });
  const response = await accountMcp(req, env);
  expect(response?.status).toBe(200);
  const payload = (await response!.json()) as {
    error?: unknown;
    result?: { isError?: boolean };
  };
  expect(payload.error).toBeUndefined();
  expect(payload.result).toBeDefined();
  expect(payload.result?.isError).not.toBe(true);
  const snapshot = await getSnapshot("local-demo", env);
  expect(snapshot.usageTotals.credits).toBe(1);
  expect(snapshot.usage[0].type).toBe("MCP · Single-label");
  expect(snapshot.usage[0].inputTokens).toBe(100);
});

test("missing provider usage keeps a bounded hold for review rather than charging zero", async () => {
  globalThis.fetch = (async (_url, init) => jevResponse(init)) as typeof fetch;
  const response = await accountClassification(request({ inputs: ["Hello"], labels: ["yes", "no"] }), env);
  expect(response?.status).toBe(200);
  expect(response?.headers.get("x-billing-status")).toBe("review");
  const pending = await env.APP_DB.prepare("SELECT status,reporting_status,reserved_credits FROM app_usage WHERE account_id='local-demo'").first();
  expect(pending).toEqual({ status: "pending", reporting_status: "review", reserved_credits: 276 });
});

test("insufficient provider bound and billing hold prevent any inference call", async () => {
  let calls = 0;
  globalThis.fetch = (async (_url, init) => { calls++; return jevResponse(init, 100); }) as typeof fetch;
  await env.APP_DB.prepare("UPDATE app_accounts SET balance=1 WHERE id='local-demo'").run();
  await expect(accountClassification(request({ inputs: ["Hello"], labels: ["yes", "no"] }), env)).rejects.toThrow("Insufficient");
  expect(calls).toBe(0);
  await env.APP_DB.prepare("UPDATE app_accounts SET balance=500000,billing_hold=TRUE WHERE id='local-demo'").run();
  await expect(accountClassification(request({ inputs: ["Hello"], labels: ["yes", "no"] }), env)).rejects.toThrow();
  expect(calls).toBe(0);
});

test("Smart bills actual Jev and Gemini cached/input/output tokens and emits one AE event", async () => {
  const points: unknown[] = [];
  env.ACCOUNT_AE = { writeDataPoint: (point) => points.push(point) };
  env.OPENROUTER_API_KEY = "openrouter-fixture";
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls++;
    if (String(url).includes("typesafe")) {
      const response = await jevResponse(init, 100).json();
      for (const answer of Object.values(response.answers) as any[]) answer.confidence = 0.4;
      return Response.json(response);
    }
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "google/gemini-3.8-flash", max_tokens: 2000 });
    const account = await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id='local-demo'").first<{ balance: number }>();
    expect(account!.balance).toBeLessThan(405000); // Bound is held before the request leaves.
    return Response.json({ model: "google/gemini-3.8-flash", choices: [{ message: { content: "B" } }],
      usage: { prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 100 }, cost: 0.0007575 } });
  }) as typeof fetch;
  const response = await accountClassification(request({ inputs: ["Hello"], labels: ["yes", "no"], tier: "smart" }), env);
  expect(response?.status).toBe(200);
  expect((await response!.json()).results[0].label).toBe("no");
  const row = await env.APP_DB.prepare("SELECT actual_nano::text,credits,status FROM app_usage WHERE account_id='local-demo'").first();
  expect(row).toEqual({ actual_nano: "913200", credits: 92, status: "completed" });
  expect(calls).toBe(2);
  expect(points).toHaveLength(1);
});
