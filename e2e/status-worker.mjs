import {
  Miniflare,
  convertV4MiniflareOptions,
  Response as WorkerResponse,
} from "miniflare";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";

// The built Worker must honor response formats, CSP, HEAD, normalized cache keys,
// telemetry failure, and the same schema as the request-to-status E2E.
const modules = (await readdir("dist/server", { recursive: true }))
  .filter((p) => /\.(js|wasm)$/.test(p))
  .sort((a, b) =>
    a === "index.js" ? -1 : b === "index.js" ? 1 : a.localeCompare(b),
  )
  .map((p) => ({
    type: p.endsWith(".wasm") ? "CompiledWasm" : "ESModule",
    path: `dist/server/${p}`,
  }));
const report = {
  runtime: "built Worker in workerd",
  upstream:
    "deterministic Analytics Engine fixtures; request telemetry verified separately in status.ts",
  scenarios: [],
};
for (const unavailable of [false, true]) {
  let calls = 0;
  const latest = new Date().toISOString().replace("T", " ").slice(0, 19);
  const bucket = new Date(Math.floor(Date.now() / 900000) * 900000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "status",
          modules,
          modulesRoot: "dist/server",
          compatibilityDate: "2026-08-01",
          compatibilityFlags: ["nodejs_compat"],
          bindings: {
            SPENDING_ENABLED: "true",
            CF_ANALYTICS_TOKEN: "private-fixture",
            CLOUDFLARE_ACCOUNT_ID: "fixture",
          },
          outboundService: async (request) => {
            assert.match(request.url, /analytics_engine\/sql/);
            calls++;
            if (unavailable)
              return new WorkerResponse("private upstream diagnostics", {
                status: 503,
              });
            const query = await request.text();
            return WorkerResponse.json({
              data: query.includes("classifier_chat_events")
                ? []
                : [
                    {
                      status: "200",
                      requests: 5,
                      ms_sum: 500,
                      escalation_failed: 2,
                      escalated: 3,
                      latest,
                      ...(query.includes("AS bucket") ? { bucket } : {}),
                    },
                  ],
            });
          },
        },
      ],
    }),
  );
  try {
    await mf.ready;
    const json = await mf.dispatchFetch("https://classifier.dev/v1/status");
    assert.equal(json.status, 200);
    assert.match(json.headers.get("cache-control"), /max-age=60/);
    const snapshot = await json.json();
    assert.equal(snapshot.status, unavailable ? "unknown" : "degraded");
    assert.equal(snapshot.components[0].requests, unavailable ? null : 5);
    const html = await mf.dispatchFetch("https://classifier.dev/status", {
      headers: { accept: "text/html" },
    });
    const body = await html.text();
    assert.equal(html.status, 200);
    assert.match(html.headers.get("content-security-policy"), /sha256-/);
    assert.match(body, /Smart escalation/);
    assert.match(html.headers.get("vary"), /accept/);
    const plain = await mf.dispatchFetch("https://classifier.dev/status", {
      headers: { accept: "text/plain" },
    });
    assert.match(plain.headers.get("vary"), /accept/);
    const negotiatedMarkdown = await mf.dispatchFetch(
      "https://classifier.dev/status",
      { headers: { accept: "text/markdown" } },
    );
    assert.match(
      negotiatedMarkdown.headers.get("content-type"),
      /text\/markdown/,
    );
    assert.match(negotiatedMarkdown.headers.get("vary"), /accept/);
    assert.doesNotMatch(body, /private-fixture|private upstream diagnostics/);
    const head = await mf.dispatchFetch(
      "https://classifier.dev/v1/status?cache-key=ignored",
      { method: "HEAD" },
    );
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const md = await mf.dispatchFetch("https://classifier.dev/status.md");
    assert.match(md.headers.get("content-type"), /text\/markdown/);
    assert.equal(
      (
        await mf.dispatchFetch("https://classifier.dev/status", {
          method: "POST",
        })
      ).status,
      405,
    );
    assert.equal(
      calls,
      4,
      "all formats and query strings share the snapshot cache",
    );
    report.scenarios.push({ unavailable, queryCalls: calls, snapshot });
  } finally {
    await mf.dispose();
  }
}
await mkdir("captures", { recursive: true });
await writeFile(
  "captures/status-worker-e2e.json",
  JSON.stringify(report, null, 2),
);
console.log("Built Worker status E2E passed; captures/status-worker-e2e.json");
