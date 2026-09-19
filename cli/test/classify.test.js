import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseInput, formatRows, formatRow, formatCount, newer, classifyAll, makeProgress } from "../classify.js";

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

function run(args, stdin = "", env = {}, timeoutMs = 0) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, CLASSIFY_NO_UPDATE_CHECK: "1", ...env } });
    const timer = timeoutMs ? setTimeout(() => p.kill(), timeoutMs) : null;
    let out = "", err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
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

    const smartMany = Array.from({ length: 401 }, (_, i) => `smart ${i}`).join("\n");
    const smartBefore = requests.length;
    r = await run(["--endpoint", url, "a,b", "--smart", "-q"], smartMany);
    assert.equal(r.code, 0, r.err);
    assert.ok(requests.slice(smartBefore).every((request) => request.inputs.length <= 200), "public smart batches stay within 200 classifications");
  } finally {
    server.close();
  }
});

test("an empty pipe is an empty answer, not the help text", async () => {
  // stdin here is a pipe that closes at once: a filter upstream matched nothing.
  const r = await run(["spam,ham"], "");
  assert.equal(r.out, "", "nothing on stdout for a downstream tool to choke on");
  assert.equal(r.err, "");
  assert.equal(r.code, 0);
  const blank = await run(["spam,ham", "--count"], "\n\n");
  assert.equal(blank.out, "");
  assert.equal(blank.code, 0);
  // No labels at all is a person who has not read the usage yet.
  const none = await run([], "");
  assert.match(none.out, /USAGE/);
  assert.equal(none.code, 2);
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


// ---------------------------------------------------------------- streaming

test("classifyAll hands results to onReady in input order", async () => {
  const { server, url } = await mockApi();
  try {
    // Three batches, finishing out of order at concurrency 4; the caller must
    // still see 0,1,2,... because that is what every downstream tool assumes.
    const items = Array.from({ length: 25 }, (_, i) => ({ text: `item ${i} alpha` }));
    const seen = [];
    const out = await classifyAll(
      { endpoint: url, labels: ["alpha", "beta"] },
      items,
      (i) => seen.push(i),
    );
    assert.deepEqual(seen, items.map((_, i) => i));
    assert.equal(out.length, items.length);
  } finally {
    server.close();
  }
});

test("classifyAll reports progress as batches land", async () => {
  const { server, url } = await mockApi();
  try {
    const items = Array.from({ length: 10 }, (_, i) => ({ text: `item ${i} alpha` }));
    const seen = [];
    await classifyAll({ endpoint: url, labels: ["alpha", "beta"] }, items, null, (done, total) =>
      seen.push([done, total]),
    );
    assert.ok(seen.length >= 1);
    assert.deepEqual(seen.at(-1), [items.length, items.length]);
  } finally {
    server.close();
  }
});

test("formatRow returns null when --review filters the row out", () => {
  const o = { review: 0.5, multi: false, json: false, quiet: false, labels: ["a", "b"] };
  const confident = formatRow(o, { text: "x" }, { label: "a", confidence: 0.9 }, 0);
  const unsure = formatRow(o, { text: "y" }, { label: "a", confidence: 0.2 }, 1);
  assert.equal(confident, null, "a confident row is not under review");
  assert.ok(unsure && unsure.startsWith("a\t0.20"), "an unsure row is kept");
});

test("formatRows and formatRow agree", () => {
  const o = { review: null, multi: false, json: false, quiet: false, labels: ["a", "b"] };
  const items = [{ text: "one" }, { text: "two" }];
  const results = [{ label: "a", confidence: 1 }, { label: "b", confidence: 0.4 }];
  assert.deepEqual(
    formatRows(o, items, results),
    items.map((it, i) => formatRow(o, it, results[i], i)),
  );
});

test("progress stays silent when disabled", () => {
  const p = makeProgress(false);
  const writes = [];
  const real = process.stderr.write.bind(process.stderr);
  process.stderr.write = (c) => { writes.push(c); return true; };
  try { p.update(1, 2); p.clear(); } finally { process.stderr.write = real; }
  assert.deepEqual(writes, [], "nothing is written when stderr is not a terminal");
});

// ---------------------------------------------------------------- guards added after the first audit

import { checkResults, confidenceOf, kept } from "../classify.js";

/** A server that answers with whatever `reply(body)` returns, as JSON 200. */
function replyWith(reply) {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply(JSON.parse(raw))));
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

test("checkResults rejects a short, missing, or mis-shaped answer", () => {
  const o = { multi: false, smart: false };
  const one = { label: "a", confidence: 0.9 };
  assert.deepEqual(checkResults(o, { results: [one, one] }, 2), [one, one]);
  assert.throws(() => checkResults(o, { ok: true }, 2), /returned no results/);
  assert.throws(() => checkResults(o, { results: [one] }, 2), /1 results for 2 inputs/);
  assert.throws(() => checkResults(o, { results: [{ labels: ["a"] }] }, 1), /multi-label shape/);
  assert.throws(() => checkResults({ multi: true }, { results: [one] }, 1), /single-label shape/);
});

test("a short answer from the API is an error, not a shorter file", async () => {
  const { server, url } = await replyWith((b) => ({ results: b.inputs.slice(1).map(() => ({ label: "a", confidence: 0.9 })) }));
  try {
    const r = await run(["a,b", "--endpoint", url], "one\ntwo\nthree\n");
    assert.equal(r.code, 1);
    assert.match(r.err, /2 results for 3 inputs/);
    assert.equal(r.out, "");
  } finally { server.close(); }
});

test("a missing confidence prints as -, and --review keeps it", () => {
  const o = { multi: false, review: null, json: false, quiet: false };
  assert.equal(formatRow(o, { text: "x" }, { label: "a" }, 0), "a\t-\tx");
  assert.equal(confidenceOf(o, { label: "a" }), null);
  assert.equal(kept({ ...o, review: 0.5 }, { label: "a" }), true);
  assert.equal(kept({ ...o, review: 0.5 }, { label: "a", confidence: 0.9 }), false);
});

test("--max implies --multi, and rejects anything but a whole number", async () => {
  const { server, requests, url } = await mockApi();
  try {
    const r = await run(["ml,db", "-k", "1", "--endpoint", url], "db tuning\n");
    assert.equal(r.code, 0, r.err);
    assert.equal(requests.at(-1).multi, true);
    assert.equal(requests.at(-1).max_labels, 1);
    assert.match(r.out, /^db\t0\.90\tdb tuning\n$/);
    for (const bad of ["abc", "0", "1.5", "-2"]) {
      const b = await run(["ml,db", "-k", bad, "--endpoint", url], "x\n");
      assert.equal(b.code, 1, bad);
      assert.match(b.err, /--max takes a whole number/);
    }
  } finally { server.close(); }
});

test("--review composes with --count and with a single text", async () => {
  const { server, url } = await mockApi();
  try {
    // The mock gives 0.4 to anything with a "?" and 0.9 otherwise.
    const c = await run(["a,b", "--count", "--review", "0.5", "--endpoint", url], "a sure\nb?\nb?\n");
    assert.equal(c.out, "2\tb\n0\ta\n");
    const sure = await run(["a,b", "--review", "0.5", "--endpoint", url, "a sure thing"]);
    assert.equal(sure.out, "");
    const unsure = await run(["a,b", "--review", "0.5", "--endpoint", url, "b?"]);
    assert.equal(unsure.out, "b\t0.40\tb?\n");
    const multi = await run(["a,b", "-m", "--endpoint", url, "a and b"]);
    assert.equal(multi.out, "a\n", "one text with --multi is comma-joined like every other row");
  } finally { server.close(); }
});

test("plain lines that open with a brace stay plain; broken NDJSON says which line", () => {
  assert.deepEqual(parseInput("{not json}\n{also not}"), [{ text: "{not json}" }, { text: "{also not}" }]);
  assert.throws(() => parseInput('{"text":"a"}\n{"text":'), /line 2 is not valid JSON/);
});

test("--smart reports answers the smart tier could not re-ask", async () => {
  const { server, url } = await replyWith((b) => ({
    results: b.inputs.map(() => ({ label: "a", confidence: 0.3 })),
    usage: { classifications: b.inputs.length, escalated: 0, escalation_failed: b.inputs.length },
  }));
  try {
    const r = await run(["a,b", "-s", "--endpoint", url], "one\ntwo\n");
    assert.equal(r.code, 0);
    assert.match(r.err, /could not re-ask 2 uncertain answers/);
    const m = await run(["a,b", "-s", "-m", "--endpoint", url], "one\n");
    assert.match(m.err, /--smart has no effect with --multi/);
  } finally { server.close(); }
});

test("newer ignores prereleases and junk", () => {
  assert.equal(newer("1.0.1-beta.1", "1.0.0"), false);
  assert.equal(newer(undefined, "1.0.0"), false);
  assert.equal(newer("2.0.0", "1.9.9"), true);
});

test("retries are announced on stderr, and a 5xx is retried", async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls++;
      if (calls === 1) { res.writeHead(503, { "content-type": "application/json" }); return res.end('{"error":"upstream down"}'); }
      const b = JSON.parse(raw);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ results: b.inputs.map(() => ({ label: "a", confidence: 0.9 })) }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  try {
    const r = await run(["a,b", "--endpoint", `http://127.0.0.1:${server.address().port}`], "x\n");
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /upstream down, retrying in 0\.5s \(2\/5\)/);
    assert.equal(calls, 2);
  } finally { server.close(); }
});

test("malformed NDJSON fails before sending any input to the API", async () => {
  const { server, requests, url } = await mockApi();
  try {
    for (const tail of ["broken json", "42", "null"]) {
      const r = await run(["bug,praise", "--endpoint", url, "--field", "title", "--id", "id"],
        '{"title":"The app crashes","id":7}\n' + tail);
      assert.equal(r.code, 1, `accepted malformed NDJSON: ${tail}`);
      assert.equal(r.out, "");
      assert.match(r.err, /could not read input/);
    }
    assert.equal(requests.length, 0, "invalid input never reaches the classifier");
  } finally { server.close(); }
});

test("daily quota exhaustion exits immediately instead of sleeping for a day", async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    calls++;
    req.resume();
    res.writeHead(429, { "content-type": "application/json", "retry-after": "86400" });
    res.end(JSON.stringify({ code: "rate_limit_day", error: "Daily limit reached: 20000 fast classifications per IP per day." }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const r = await run(["bug,praise", "The app crashes", "--endpoint", `http://127.0.0.1:${server.address().port}`], "", {}, 1500);
    assert.equal(r.code, 1, r.err);
    assert.equal(r.out, "");
    assert.match(r.err, /Daily limit reached/);
    assert.doesNotMatch(r.err, /retrying/);
    assert.equal(calls, 1);
  } finally { server.close(); }
});

test("exhausted retries exit without sleeping after the final response", async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    calls++;
    req.resume();
    res.writeHead(429, { "content-type": "application/json", "retry-after": calls === 5 ? "60" : "0.001" });
    res.end(JSON.stringify({ code: "rate_limit_minute", error: "Minute limit reached" }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const r = await run(["bug,praise", "The app crashes", "--endpoint", `http://127.0.0.1:${server.address().port}`], "", {}, 1500);
    assert.equal(r.code, 1, r.err);
    assert.equal(calls, 5);
    assert.equal((r.err.match(/retrying/g) || []).length, 4);
    assert.match(r.err, /Minute limit reached/);
    assert.equal(r.out, "");
  } finally { server.close(); }
});

test("CLASSIFY_BATCH rejects invalid values and caps smart batches", async () => {
  const { server, requests, url } = await mockApi();
  try {
    for (const bad of ["0", "-1", "1.5", "NaN", "Infinity", "1001"]) {
      const r = await run(["a,b", "--endpoint", url], "x\n", { CLASSIFY_BATCH: bad });
      assert.equal(r.code, 1, bad);
      assert.match(r.err, /CLASSIFY_BATCH must be a whole number/);
    }
    const r = await run(["a,b", "--smart", "--endpoint", url], "x\n", { CLASSIFY_BATCH: "500" });
    assert.equal(r.code, 0, r.err);
    const keyedMany = Array.from({ length: 401 }, () => "x").join("\n");
    const before = requests.length;
    const keyed = await run(["a,b", "--smart", "--api-key", "partner", "--endpoint", url], keyedMany, { CLASSIFY_BATCH: "500" });
    assert.equal(keyed.code, 0, keyed.err);
    assert.deepEqual(requests.slice(before).map((request) => request.inputs.length), [401], "partner-key smart calls keep their configured batch size");
  } finally { server.close(); }
});
