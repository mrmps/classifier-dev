import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import worker, { type Env } from "../src/index";
import { newMeter } from "../src/cost";
import { Permit } from "../src/spending/permit";
import { parseTokenRateCard, priceTokens } from "../src/server/token-pricing";
import { providerCallBound } from "../src/server/token-reservation";
import rates from "../src/retail-rates.json";

// bun --env-file=.dev.vars e2e/diffusiongemma.ts --live
// SDK → local HTTP Worker → Beam (or a local HTTP provider fixture).
// Failure modes: dropped images, text-only fallback, wrong model/auth, excess
// images, malformed replies, provider refusal, cancellation, and unmetered spend.
const live = process.argv.includes("--live");
if (live && !process.env.BEAM_API_KEY) throw new Error("BEAM_API_KEY is required for --live");
const originalFetch = globalThis.fetch;
let scenario = "success", calls = 0;
const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  calls++;
  assert.equal(req.headers.get("authorization"), "Bearer fixture-beam");
  const body = await req.json() as Record<string, any>;
  assert.equal(body.model, "jev/diffusiongemma");
  if (scenario === "busy") return Response.json({ detail: "busy" }, { status: 429 });
  if (scenario === "invalid") return Response.json({ detail: "invalid image" }, { status: 422 });
  if (scenario === "malformed") return Response.json({ model: body.model, answers: {} });
  return Response.json({ model: body.model, answers: {
    color: { type: "choice", choice: body.images ? "red" : "blue", confidence: 0.99, probabilities: { red: body.images ? 0.99 : 0.01, blue: body.images ? 0.01 : 0.99 } },
    red: { type: "noul", noul: 0.99 },
    intensity: { type: "score", score: 1.99, confidence: 0.99, legend: { 0: "Not red", 1: "Some red", 2: "Entirely red" }, probabilities: { 0: 0, 1: 0.01, 2: 0.99 } },
  }, usage: { input_tokens: 310, output_tokens: 0 } });
} });
if (!live) globalThis.fetch = ((input, init) => {
  if (String(input).startsWith("http://127.0.0.1:")) return originalFetch(input, init);
  assert.equal(String(input), "https://app.beam.cloud/v1/systemone", "never fall back to a text model or pod");
  return originalFetch(provider.url, init);
}) as typeof fetch;
const env = { DGEMMA_ENABLED: "true", BEAM_API_KEY: live ? process.env.BEAM_API_KEY : "fixture-beam",
  DGEMMA_URL: "https://unused-pod.example", DGEMMA_TOKEN: "unused",
  STATS: { get: async () => null, put: async () => {} },
  LIMITER: { idFromName: (s: string) => s, get: () => ({ fetch: async () => Response.json({ limited: false, remaining: 59 }) }) },
} as unknown as Env;
const report: unknown[] = [];
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  const meter = newMeter();
  meter.permit = new Permit(10_000_000, Date.now() + 90000);
  const response = await worker.fetch(req, env, { waitUntil: () => {} } as unknown as ExecutionContext, { meter });
  await meter.permit.drain();
  report.push({ status: response.status, response: await response.clone().json(), providerUsd: meter.usd,
    tokens: meter.tokens, spending: { used: meter.permit.used, unknown: meter.permit.unknown } });
  if (response.ok) {
    assert.equal(meter.tokens[0].provider, "beam");
    assert.equal(meter.tokens[0].model, "jev/diffusiongemma");
    assert.ok(meter.usd > 0);
    assert.equal(meter.permit.unknown, false);
    assert.ok(Math.abs(meter.permit.used - meter.tokens[0].inputTokens! * 21) <= 1);
  }
  return response;
} });
// Deterministic 128×128 red PNG, constructed without external image assets.
function chunk(type: string, data: Buffer) {
  const name = Buffer.from(type), crc = Bun.hash.crc32(Buffer.concat([name, data]));
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc);
  return Buffer.concat([size, name, data, checksum]);
}
const header = Buffer.alloc(13); header.writeUInt32BE(128); header.writeUInt32BE(128, 4); header[8] = 8; header[9] = 2;
const row = Buffer.from([0, ...Array.from({ length: 128 }, () => [255, 0, 0]).flat()]);
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(Array(128).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
const image = `data:image/png;base64,${png.toString("base64")}`;
const questions = {
  color: { type: "choice" as const, instructions: "What color is the image or described square?", criteria: { red: null, blue: null } },
  red: { type: "noul" as const, instructions: "Is the image red?" },
  intensity: { type: "score" as const, instructions: "How red is the image?", criteria: ["Not red", "Some red", "Entirely red"] as const },
};
const client = new TypeSafeClient({ apiKey: "unused", baseURL: server.url.origin, retry: { maxRetries: 0 }, timeout: 65000 });
try {
  const request = { model: "jev/diffusiongemma", state: "Look at the image.", images: [image], questions };
  const result = await client.systemOne(request);
  assert.equal(result.answers.color.choice, "red");
  assert.ok(result.answers.red.noul > 0.9);
  assert.ok(result.answers.intensity.score > 1.8);
  const alias = await client.systemOne({ ...request, model: "dgemma" });
  assert.equal(alias.model, "jev/diffusiongemma");
  const text = await client.systemOne({ model: "jev/diffusiongemma", state: "The square is blue.", questions });
  assert.equal(text.answers.color.choice, "blue");
  const post = (body: object) => fetch(new URL("/v1/systemone", server.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  for (const change of [{ images: [image, image] }, { images: [] }, { images: ["https://example.com/a.png"] }, { model: "jev-latest" }]) {
    const before = calls;
    assert.equal((await post({ ...request, ...change })).status, 400);
    assert.equal(calls, before, "invalid requests must not reach the provider");
  }
  if (!live) for (const [mode, status] of [["busy", 429], ["invalid", 400], ["malformed", 503]] as const) {
    scenario = mode;
    const response = await post(request);
    assert.equal(response.status, status);
    if (mode === "busy") assert.ok(response.headers.get("retry-after"));
  }
  const card = parseTokenRateCard(JSON.stringify(rates))!;
  assert.equal(providerCallBound(card, "beam", "jev/diffusiongemma", 0), 0);
  assert.equal(priceTokens(card, [{ provider: "beam", model: "jev/diffusiongemma", calls: 1, inputTokens: 310, outputTokens: 0, cachedInputTokens: 0 }])?.nanodollars, 0n);
  console.log(`DiffusionGemma ${live ? "live" : "fixture"} E2E passed (${report.length} HTTP requests)`);
} finally {
  await mkdir("captures", { recursive: true });
  await writeFile(`captures/diffusiongemma-${live ? "live" : "fixture"}.json`, JSON.stringify({ live, sdk: "@typesafe-ai/sdk 0.6.0", results: report }, null, 2));
  await writeFile("captures/diffusiongemma-red.png", png);
  server.stop(true); provider.stop(true); globalThis.fetch = originalFetch;
}
