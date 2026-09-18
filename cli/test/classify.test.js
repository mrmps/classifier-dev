import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseInput, formatRows, formatCount, newer } from "../classify.js";

const BIN = fileURLToPath(new URL("../classify.js", import.meta.url));

// A stand-in for classifier.dev: labels each input by which label it mentions,
// records every request body so tests can check batching and parameters.
function mockApi() {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      requests.push(body);
      if (body.labels.length < 2) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Provide at least 2 labels" }));
      }
      // A label of "ratelimit" trips one 429 so the retry path can be exercised.
      if (body.labels.includes("ratelimit") && !server.tripped) {
        server.tripped = true;
        res.writeHead(429, { "content-type": "application/json", "retry-after": "1" });
        return res.end(JSON.stringify({ error: "Rate limit" }));
      }
      const results = body.inputs.map((text) => {
        const hit = body.labels.find((l) => text.toLowerCase().includes(l.toLowerCase())) ?? body.labels[0];
        const scores = Object.fromEntries(body.labels.map((l) => [l, l === hit ? 0.9 : 0.1 / (body.labels.length - 1)]));
        return body.multi
          ? { labels: [hit], scores, ms: 1, model: "mock" }
          : { label: hit, confidence: text.includes("?") ? 0.4 : 0.9, scores, ms: 1, model: "mock" };
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ tier: body.tier ?? "fast", model: "mock", results, usage: { classifications: results.length } }));
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` })));
}

function run(args, stdin = "", env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, CLASSIFY_NO_UPDATE_CHECK: "1", ...env } });
    let out = "", err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (code) => resolve({ code, out, err }));
    p.stdin.end(stdin);
  });
}

test("parseInput: lines, JSON array, NDJSON, --field/--id", () => {
  assert.deepEqual(parseInput("a\n\n b \n"), [{ text: "a" }, { text: "b" }]);
  assert.deepEqual(parseInput('["x","y"]'), [{ text: "x" }, { text: "y" }]);
  assert.deepEqual(parseInput('[{"title":"t","id":7}]', "title", "id"), [{ text: "t", id: 7 }]);
  assert.deepEqual(parseInput('{"text":"a"}\n{"text":"b"}'), [{ text: "a" }, { text: "b" }]);
  assert.throws(() => parseInput('[{"nope":1}]'), /no string field "text"/);
});

test("formatRows: tsv, quiet, json, review, multi confidence = weakest kept label", () => {
  const items = [{ text: "a\tb" }, { text: "c?" }];
  const results = [{ label: "x", confidence: 0.9, scores: { x: 0.9 } }, { label: "y", confidence: 0.4, scores: { y: 0.4 } }];
  const base = { labels: ["x", "y"], multi: false, review: null, json: false, quiet: false };
  assert.deepEqual(formatRows(base, items, results), ["x\t0.90\ta\\tb", "y\t0.40\tc?"]);
  assert.deepEqual(formatRows({ ...base, quiet: true }, items, results), ["x", "y"]);
  assert.deepEqual(formatRows({ ...base, review: 0.7 }, items, results), ["y\t0.40\tc?"]);
  assert.equal(JSON.parse(formatRows({ ...base, json: true }, items, results)[1]).i, 1);
  const multi = [{ labels: ["x", "y"], scores: { x: 0.95, y: 0.72 } }];
  assert.deepEqual(formatRows({ ...base, multi: true }, [items[0]], multi), ["x,y\t0.72\ta\\tb"]);
  assert.deepEqual(formatRows({ ...base, multi: true, review: 0.8 }, [items[0]], multi), ["x,y\t0.72\ta\\tb"]);
});

test("formatCount lists every label, most common first", () => {
  const o = { labels: ["x", "y", "z"], multi: false };
  assert.deepEqual(formatCount(o, [{ label: "y" }, { label: "y" }, { label: "x" }]), ["2\ty", "1\tx", "0\tz"]);
});

test("newer: semver compare", () => {
  assert.equal(newer("0.2.0", "0.1.9"), true);
  assert.equal(newer("1.0.0", "1.0.0"), false);
  assert.equal(newer("0.1.0-beta.1", "0.1.0"), false);
});

test("end to end against a mock API: single text, stdin, batching, count, 429 retry", async () => {
  const { server, requests, url } = await mockApi();
  try {
    let r = await run(["--endpoint", url, "spam,ham", "this is spam"]);
    assert.equal(r.out, "spam\n");
    assert.equal(r.code, 0);

    r = await run(["--endpoint", url, "spam,ham", "-i", "be strict", "--smart"], "ham sandwich\nspam mail\nwhich?\n");
    assert.deepEqual(r.out.trim().split("\n").map((l) => l.split("\t")[0]), ["ham", "spam", "spam"]);
    assert.equal(requests.at(-1).instructions, "be strict");
    assert.equal(requests.at(-1).tier, "smart");

    r = await run(["--endpoint", url, "spam,ham", "--review", "0.7"], "ham\nwhich?\n");
    assert.equal(r.out, "spam\t0.40\twhich?\n");

    r = await run(["--endpoint", url, "spam,ham", "--count"], "ham\nham\nspam\n");
    assert.equal(r.out, "2\tham\n1\tspam\n");

    const many = Array.from({ length: 2500 }, (_, i) => (i % 2 ? "spam" : "ham")).join("\n");
    const before = requests.length;
    r = await run(["--endpoint", url, "spam,ham", "-q"], many);
    assert.equal(r.out.trim().split("\n").length, 2500);
    assert.equal(requests.length - before, 3, "2500 inputs = 3 requests of up to 1000");
    assert.equal(r.out.trim().split("\n")[1], "spam", "order preserved across batches");

    r = await run(["--endpoint", url, "onlyone", "x"]);
    assert.equal(r.code, 1);
    assert.match(r.err, /at least two labels/);

    r = await run(["--endpoint", url, "ratelimit,ham", "ham please"]);
    assert.equal(r.code, 0);
    assert.equal(r.out, "ham\n");
    assert.match(r.err, /rate limited, retrying in 1s/);
  } finally {
    server.close();
  }
});

test("--help and --version", async () => {
  const h = await run(["--help"]);
  assert.match(h.out, /USAGE/);
  const v = await run(["--version"]);
  assert.match(v.out, /^\d+\.\d+\.\d+/);
});

if (process.env.CLASSIFY_E2E) {
  test("smoke against production", async () => {
    const r = await run(["spam,not spam", "Win a free iPhone now"]);
    assert.equal(r.out, "spam\n");
  });
}
