import { afterEach, beforeEach, expect, test } from "bun:test";
import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";
import { database } from "./support/postgres";
import { provisionTestAccount } from "./support/account";
import { performAction } from "../src/server/agents";
import { getSnapshot } from "../src/server/accounts";
import { accountClassification } from "../src/http/classification";
import { accountMcp } from "../src/http/mcp";
import { accountApi } from "../src/http/account-api";
import legacy from "../src/index";
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
  env = { APP_DB: database(), APP_ACCOUNTS_ENABLED: "true", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters", TYPESAFE_API_KEY: "provider-fixture", STATS: { get: async () => null, put: async () => {} } as unknown as KVNamespace };
  await provisionTestAccount(
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
    "/api/auth/callback",
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
  expect(
    await env.APP_DB.prepare(
      "SELECT items,credits,usage_type,input_tokens,output_tokens FROM app_usage WHERE account_id='local-demo' LIMIT 1",
    ).first(),
  ).toEqual({
    items: 1,
    credits: 1,
    usage_type: "API · Dimensions",
    input_tokens: 41,
    output_tokens: null,
  });
  await performAction("local-demo", { type: "revoke", agentId }, env);
  await expect(
    accountClassification(
      request({ inputs: ["Hello"], labels: ["a", "b"] }),
      env,
    ),
  ).rejects.toThrow();
  expect(calls).toBe(1);
});

test("the official TypeSafe SDK applies a workspace key to quota, billing, and model discovery", async () => {
  const quota: Array<{ owner: string; url: string }> = [];
  env.LIMITER = {
    idFromName: (owner: string) => owner,
    get: (owner: string) => ({ fetch: async (url: string) => {
      quota.push({ owner, url });
      return Response.json({ limited: false, remaining: 2997 });
    } }),
  } as unknown as DurableObjectNamespace;
  let systemOneCalls = 0;
  let modelCalls = 0;
  globalThis.fetch = (async (url, init) => {
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer provider-fixture");
    if (String(url).endsWith("/v1/models")) {
      modelCalls++;
      return Response.json({ models: [{ name: "jev-latest", description: "Latest stable Jev.", release_date: "2026-09-15" }] });
    }
    systemOneCalls++;
    return Response.json({
      model: "jev-1.13.0",
      answers: {
        category: { type: "choice", choice: "billing", confidence: .99, probabilities: { billing: .99, support: .01 } },
        urgent: { type: "noul", noul: .8 },
        frustration: { type: "score", score: 1.5, confidence: .75, legend: { "0": "calm", "1": "concerned", "2": "angry" }, probabilities: { "0": .1, "1": .3, "2": .6 } },
      },
      usage: { input_tokens: 41, output_tokens: 9 },
    }, { headers: { "x-typesafe-request-id": "req_workspace" } });
  }) as typeof fetch;

  const client = new TypeSafeClient({
    apiKey: token,
    baseURL: "http://localhost",
    fetch: (input, init) => dispatch(new Request(input, init)),
    retry: { maxRetries: 0 },
  });
  const result = await client.systemOne({
    state: "I was charged twice and need this fixed today.",
    questions: {
      category: choice("Which team?", { billing: null, support: null }),
      urgent: noul("Is this urgent?"),
      frustration: score("How frustrated?", ["calm", "concerned", "angry"]),
    },
  }).withResponse();
  const models = await client.models.list();

  expect(result.data.answers.category.choice).toBe("billing");
  expect(result.requestId).toBe("req_workspace");
  expect(result.response.headers.get("x-billing-status")).toBe("settled");
  expect(result.response.headers.get("x-request-id")).toBeTruthy();
  expect(models.map(model => model.name)).toEqual(["jev-latest"]);
  expect(systemOneCalls).toBe(1);
  expect(modelCalls).toBe(1);
  expect(quota).toHaveLength(1);
  expect(quota[0].owner).toBe("fast:account:local-demo");
  expect(new URL(quota[0].url).searchParams.get("cost")).toBe("3");
  expect(new URL(quota[0].url).searchParams.get("limit")).toBe("3000");
  expect(new URL(quota[0].url).searchParams.get("daily")).toBe("20000");
  expect((await getSnapshot("local-demo", env)).credits.balance).toBe(499999);
  expect(await env.APP_DB.prepare(
    "SELECT items,credits,usage_type,input_tokens,output_tokens,actual_nano::text AS actual_nano,status FROM app_usage WHERE account_id='local-demo'",
  ).first()).toEqual({
    items: 3,
    credits: 1,
    usage_type: "API · TypeSafe System One",
    input_tokens: 41,
    output_tokens: 9,
    actual_nano: "1722",
    status: "completed",
  });
});

test("TypeSafe workspace requests refund native provider errors and stop before inference without credit", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return Response.json({ detail: [{ loc: ["body", "questions"], msg: "Field required", type: "missing" }] }, {
      status: 422,
      headers: { "x-typesafe-request-id": "req_invalid" },
    });
  }) as typeof fetch;
  const invalid = await dispatch(new Request("http://localhost/v1/systemone", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ state: "ticket", questions: {} }),
  }));
  expect(invalid.status).toBe(422);
  expect(invalid.headers.get("x-typesafe-request-id")).toBe("req_invalid");
  expect(invalid.headers.get("x-billing-status")).toBe("refunded");
  expect(await invalid.json()).toEqual({ detail: [{ loc: ["body", "questions"], msg: "Field required", type: "missing" }] });
  expect((await getSnapshot("local-demo", env)).credits.balance).toBe(500000);
  expect(await env.APP_DB.prepare("SELECT status FROM app_usage WHERE account_id='local-demo'").first()).toEqual({ status: "refunded" });

  await env.APP_DB.prepare("UPDATE app_accounts SET balance=1 WHERE id='local-demo'").run();
  const before = calls;
  const insufficient = await dispatch(new Request("http://localhost/v1/systemone", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ state: "ticket", questions: { urgent: { type: "noul" } } }),
  }));
  expect(insufficient.status).toBe(402);
  expect(await insufficient.json()).toMatchObject({ error: expect.stringContaining("Insufficient") });
  expect(calls).toBe(before);
  expect((await getSnapshot("local-demo", env)).credits.balance).toBe(1);
});

test("TypeSafe workspace requests use paid-plan quota and reject revoked keys before inference", async () => {
  await env.APP_DB.prepare("UPDATE app_accounts SET billing_plan='pro' WHERE id='local-demo'").run();
  const quota: string[] = [];
  env.LIMITER = {
    idFromName: (owner: string) => owner,
    get: () => ({ fetch: async (url: string) => {
      quota.push(url);
      return Response.json({ limited: false, remaining: 29999 });
    } }),
  } as unknown as DurableObjectNamespace;
  let calls = 0;
  globalThis.fetch = (async (_url, init) => {
    calls++;
    return jevResponse(init, 20);
  }) as typeof fetch;
  const call = () => dispatch(new Request("http://localhost/v1/systemone", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ state: "ticket", questions: { category: { type: "choice", criteria: { billing: null, support: null } } } }),
  }));
  const response = await call();
  expect(response.status).toBe(200);
  expect(response.headers.get("ratelimit-limit")).toBe("30000");
  expect(response.headers.get("ratelimit-policy")).toBe("30000;w=60, 200000;w=86400");
  expect(new URL(quota[0]).searchParams.get("limit")).toBe("30000");
  expect(new URL(quota[0]).searchParams.get("daily")).toBe("200000");

  await performAction("local-demo", { type: "revoke", agentId }, env);
  const revoked = await call();
  expect(revoked.status).toBe(401);
  expect(calls).toBe(1);
});

test.each(["input", "inputs"])("account billing accepts the public API's scalar %s field", async (field) => {
  globalThis.fetch = (async (_url, init) => jevResponse(init, 41)) as typeof fetch;
  const response = await accountClassification(request({ [field]: "Help with my invoice", labels: ["billing", "sales"] }), env);
  expect(response?.status).toBe(200);
  expect(response?.headers.get("x-billing-status")).toBe("settled");
  expect(
    await env.APP_DB.prepare(
      "SELECT items,input_tokens FROM app_usage WHERE account_id='local-demo' LIMIT 1",
    ).first(),
  ).toEqual({ items: 1, input_tokens: 41 });
});

test.each(["/sandbox/classify", "/v1/sandbox/classify"])("account sandbox alias %s uses the same billing boundary", async path => {
  globalThis.fetch = (async (_url, init) => jevResponse(init, 41)) as typeof fetch;
  const response = await accountClassification(new Request(`http://localhost${path}`, request({ input: "Invoice", labels: ["billing", "sales"] })), env);
  expect(response?.status).toBe(200);
  expect(response?.headers.get("x-billing-status")).toBe("settled");
  expect(response?.headers.get("x-sandbox")).toBeTruthy();
  expect(await env.APP_DB.prepare("SELECT items,input_tokens,status FROM app_usage").first()).toEqual({ items: 1, input_tokens: 41, status: "completed" });
  await performAction("local-demo", { type: "revoke", agentId }, env);
  await expect(accountClassification(new Request(`http://localhost${path}`, request({ input: "Invoice", labels: ["billing", "sales"] })), env)).rejects.toThrow("revoked");
});

test("account authorization headers do not capture public documents or unmetered model discovery", async () => {
  for (const path of ["/", "/developers", "/openapi.json", "/mcp/docs", "/v1/health", "/v1/models"]) {
    expect(await accountClassification(new Request(`http://localhost${path}`, { headers: { authorization: `Bearer ${token}` } }), env)).toBeNull();
  }
});

const context = { waitUntil(promise: Promise<unknown>) { void promise.catch(() => {}); } } as ExecutionContext;
const dispatch = async (req: Request) => await accountApi(req, env as AppEnv & Env, context) ?? legacy.fetch(req, env as Env, context);

test("browser account clients can preflight and read balances, errors, and billing headers", async () => {
  for (const path of ["/v1/account/balance", "/v1/account/usage/summary", "/v1/classify", "/v1/systemone", "/mcp"]) {
    const response = await dispatch(new Request(`http://localhost${path}`, {
      method: "OPTIONS", headers: { origin: "https://client.example", "access-control-request-headers": "authorization,content-type" },
    }));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
  }
  const balance = await dispatch(new Request("http://localhost/v1/account/balance", { headers: { authorization: `Bearer ${token}` } }));
  expect(balance.status).toBe(200);
  expect(balance.headers.get("access-control-allow-origin")).toBe("*");
  for (const path of ["/v1/account/balance", "/mcp"]) {
    const error = await dispatch(new Request(`http://localhost${path}`, { headers: { authorization: "Bearer classifier_agent_invalid" } }));
    expect(error.status).toBe(401);
    expect(error.headers.get("access-control-allow-origin")).toBe("*");
  }
  globalThis.fetch = (async (_url, init) => jevResponse(init, 41)) as typeof fetch;
  const response = await dispatch(request({ input: "Invoice", labels: ["billing", "sales"] }));
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-expose-headers")).toContain("x-request-id");
  expect(response.headers.get("access-control-expose-headers")).toContain("x-billing-status");
  const error = await dispatch(request({}));
  expect(error.status).toBe(400);
  expect(error.headers.get("access-control-allow-origin")).toBe("*");
});

test("public routes accept account headers but alternate inference URLs cannot bypass accounting", async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("Must not infer"); }) as typeof fetch;
  for (const path of ["/", "/developers", "/openapi.json", "/v1/health"]) {
    expect((await dispatch(new Request(`http://localhost${path}`, { headers: { authorization: `Bearer ${token}` } }))).status).toBe(200);
  }
  await performAction("local-demo", { type: "revoke", agentId }, env);
  for (const path of ["/?labels=yes,no&text=hello", "/yes,no/hello", "/v1/classify?labels=yes,no&text=hello"]) {
    const response = await dispatch(new Request(`http://localhost${path}`, { headers: { authorization: `Bearer ${token}` } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "account_route_required" });
  }
  for (const path of ["/%76%31/classify", "/arbitrary"]) {
    expect((await dispatch(new Request(`http://localhost${path}`, request({ input: "hello", labels: ["yes", "no"] })))).status).toBe(400);
  }
  expect(calls).toBe(0);
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
  const response = await accountClassification(
    request({ inputs: ["Hello"], labels: ["a", "b"] }),
    env,
  );
  expect(response?.status).toBe(503);
  expect(await response?.json()).toMatchObject({ code: "inference_unavailable" });
  const snapshot = await getSnapshot("local-demo", env);
  expect(snapshot.credits.balance).toBe(500000);
  expect(snapshot.onboarding.completed).toBe(false);
  expect(
    await env.APP_DB.prepare(
      "SELECT status FROM app_usage WHERE account_id='local-demo' LIMIT 1",
    ).first(),
  ).toEqual({ status: "refunded" });
});

test("account credentials follow the same classification path on every hostname", async () => {
  globalThis.fetch = (async () => {
    throw new Error("Must not run");
  }) as typeof fetch;
  const req = new Request("https://classifier.dev/v1/classify", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: "{}",
  });
  await expect(accountClassification(req, env)).rejects.toThrow("Provide a nonempty list");
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
  expect(
    await env.APP_DB.prepare(
      "SELECT credits,usage_type,input_tokens FROM app_usage WHERE account_id='local-demo' LIMIT 1",
    ).first(),
  ).toEqual({
    credits: 1,
    usage_type: "MCP · Single-label",
    input_tokens: 100,
  });
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

test.each([
  { model: "laya", processing: "fast" },
  { model: "laya", processing: "bulk" },
  { processing: "fast" },
  { processing: "bulk" },
])("account Laya %j settles free inference without a Jev credential", async selection => {
  const { processing } = selection;
  delete env.TYPESAFE_API_KEY;
  Object.assign(env, { LAYA_ENABLED: "true", BEAM_API_KEY: "fixture", LIMITER: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: async () => Response.json({ limited: false, remaining: 59 }) }),
    } });
  // A free inference must also work when the account has no paid or free credits.
  await env.APP_DB.prepare("UPDATE app_accounts SET balance=0,paid_balance=0 WHERE id='local-demo'").run();
  globalThis.fetch = (async (url, init) => {
    // Both lanes reach the same Beam endpoint; the lane is a quota, not a host.
    expect(String(url)).toBe("https://app.beam.cloud/v1/systemone");
    const body = JSON.parse(String(init?.body)) as { model: string; questions: Record<string, unknown> };
    expect(body.model).toBe("jev/laya");
    return Response.json({
      model: "jev/laya",
      answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, {
        choice: "yes", confidence: .99, probabilities: { yes: .99, no: .01 },
      }])),
      usage: { input_tokens: 41, output_tokens: 0 },
    });
  }) as typeof fetch;
  const response = await accountClassification(request({ input: "Hello", labels: ["yes", "no"], ...selection }), env);
  expect(response?.status).toBe(200);
  expect(response?.headers.get("x-billing-status")).toBe("settled");
  const usage = await env.APP_DB.prepare("SELECT actual_nano::text,credits,status,input_tokens FROM app_usage WHERE account_id='local-demo'").first();
  expect(usage).toEqual({ actual_nano: "0", credits: 0, status: "completed", input_tokens: 41 });
  expect((await getSnapshot("local-demo", env)).credits.balance).toBe(0);
});

test.each(["fast", "smart"])("unconfigured %s Jev inference fails before spending and refunds", async tier => {
  delete env.TYPESAFE_API_KEY;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ error: "Invalid credential" }, { status: 401 }); }) as typeof fetch;
  const response = await accountClassification(request({ input: "Invoice", labels: ["billing", "sales"], model: "jev", tier }), env);
  expect(response?.status).toBe(503);
  expect(response?.headers.get("x-billing-status")).toBe("refunded");
  expect(calls).toBe(0);
  expect((await getSnapshot("local-demo", env)).credits.balance).toBe(500000);
  expect(await env.APP_DB.prepare("SELECT status,credits FROM app_usage").first()).toEqual({ status: "refunded", credits: 0 });
});

test("account Laya Smart charges only the actual review tokens", async () => {
  Object.assign(env, { LAYA_ENABLED: "true", BEAM_API_KEY: "fixture", OPENROUTER_API_KEY: "fixture", LIMITER: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: async () => Response.json({ limited: false, remaining: 59 }) }),
    } });
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls++;
    if (String(url) === "https://app.beam.cloud/v1/systemone") {
      const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> };
      // Low confidence, so the smart tier escalates this answer to a review.
      return Response.json({
        model: "jev/laya",
        answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, {
          choice: "yes", confidence: .6, probabilities: { yes: .6, no: .4 },
        }])),
        usage: { input_tokens: 41, output_tokens: 0 },
      });
    }
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
    return Response.json({ model: "google/gemini-3.8-flash", choices: [{ message: { content: "B" } }],
      usage: { prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 100 }, cost: 0.0007575 } });
  }) as typeof fetch;
  const response = await accountClassification(request({ input: "Hello", labels: ["yes", "no"], model: "laya", tier: "smart" }), env);
  expect(response?.status).toBe(200);
  expect((await response!.json()).results[0].label).toBe("no");
  expect(await env.APP_DB.prepare("SELECT actual_nano::text,credits,status FROM app_usage WHERE account_id='local-demo'").first())
    .toEqual({ actual_nano: "909000", credits: 91, status: "completed" });
  expect(calls).toBe(2);
});
