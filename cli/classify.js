#!/usr/bin/env node
// classify — the classifier.dev CLI. One file, no dependencies, Node 18+.
//
// Built for agents first: every output is one line per input, in input order,
// tab-separated and greppable, or NDJSON with --json. Errors go to stderr with
// exit 1; nothing else ever does.

import { readFileSync, writeFileSync, mkdirSync, statSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const ENDPOINT = process.env.CLASSIFIER_ENDPOINT || "https://classifier.dev";
const BATCH = Number(process.env.CLASSIFY_BATCH) || 1000; // the API's per-request ceiling
const CONCURRENCY = 4;
// A request that never answers should not hang the pipeline forever. Generous,
// because a thousand inputs on the smart tier is legitimately slow.
const TIMEOUT_MS = (Number(process.env.CLASSIFY_TIMEOUT) || 180) * 1000;

const HELP = `classify ${PKG.version} — sort text into your own labels, with a confidence you can act on.

USAGE
  classify <labels> "<text>"           one text, prints the label
  classify <labels> < items.txt        one line per input, in order
  cat items.jsonl | classify <labels> --field title

  <labels> is comma-separated, 2 to 100: "spam,not spam" or bug,feature,praise

OUTPUT
  Default, one line per input:   label<TAB>confidence<TAB>text
  --json                         NDJSON: {"i","text","label","confidence","scores",...}
  --quiet                        labels only, one per line
  --count                        how many inputs got each label
  --review 0.7                   only the inputs the model was unsure about (confidence
                                 below 0.7), so you can look at those yourself

OPTIONS
  -m, --multi                every label that applies (comma-joined), plus a score per label
  -k, --max <n>              with --multi, at most n labels
  -s, --smart                re-ask uncertain answers of a reasoning model (slower)
  -i, --instructions <text>  extra criteria: "judge only the service, ignore the food"
  -r, --review <t>           print only inputs with confidence below t
  -c, --count                print a label histogram instead of rows
  -j, --json                 NDJSON output with every field the API returns
  -q, --quiet                labels only
      --field <name>         for JSON / NDJSON input, the field holding the text (default: text)
      --id <name>            for JSON / NDJSON input, a field to carry through to the output
      --endpoint <url>       API base, default https://classifier.dev  (env CLASSIFIER_ENDPOINT)
      --api-key <key>        bearer token for higher limits           (env CLASSIFIER_API_KEY)
  -v, --version
  -h, --help

INPUT
  stdin is plain lines (blank lines skipped), a JSON array of strings or objects,
  or NDJSON objects. Up to 1,000 inputs go in one request; more are batched and
  run 4 at a time, so 10,000 lines take a few seconds.

EXAMPLES
  classify spam,"not spam" "Win a free iPhone now"
  grep -v '^#' urls.txt | classify relevant,"not relevant" -i "relevant means about GPU pricing"
  classify bug,feature,praise,other --count < feedback.txt
  classify sadness,joy,anger,fear --review 0.7 < messages.txt     # the ones to double-check
  classify ml,databases,security,devops,frontend --multi --max 3 < abstracts.txt
  classify a,b --json < items.txt | jq -c 'select(.confidence < 0.8)'

CONFIDENCE
  Calibrated: on a six-way emotion set, answers at >= 0.9 were right 82% of the
  time and answers below 0.5 were right 29%. Act on the sure ones; --review the
  rest. It is not a fit score — add a label like "none of these" when
  none-of-the-above is a real outcome.

No API key or account. Limits per IP: 3,000 classifications/min on fast, 200 on smart.
Docs: https://classifier.dev   Agent skill: npx skills add https://classifier.dev
`;

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const o = { labels: null, text: null, multi: false, max: 0, smart: false, instructions: "",
    review: null, count: false, json: false, quiet: false, field: "text", id: null,
    endpoint: ENDPOINT, apiKey: process.env.CLASSIFIER_API_KEY || "", help: false, version: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(`${a} needs a value`);
      return argv[++i];
    };
    if (a === "--") { positional.push(...argv.slice(i + 1)); break; }
    else if (a === "-h" || a === "--help") o.help = true;
    else if (a === "-v" || a === "--version") o.version = true;
    else if (a === "-m" || a === "--multi") o.multi = true;
    else if (a === "-s" || a === "--smart") o.smart = true;
    else if (a === "-c" || a === "--count") o.count = true;
    else if (a === "-j" || a === "--json") o.json = true;
    else if (a === "-q" || a === "--quiet") o.quiet = true;
    else if (a === "-k" || a === "--max") o.max = Number(next());
    else if (a === "-i" || a === "--instructions") o.instructions = next();
    else if (a === "-r" || a === "--review") o.review = Number(next());
    else if (a === "--field") o.field = next();
    else if (a === "--id") o.id = next();
    else if (a === "--endpoint") o.endpoint = next();
    else if (a === "--api-key") o.apiKey = next();
    else if (a.startsWith("--") && a.includes("=")) { argv.splice(i + 1, 0, a.slice(a.indexOf("=") + 1)); argv[i] = a.slice(0, a.indexOf("=")); i--; }
    else if (a.startsWith("-") && a.length > 1 && !/^-\d/.test(a)) fail(`unknown option ${a} (see classify --help)`);
    else positional.push(a);
  }
  if (positional.length) o.labels = positional[0].split(",").map((l) => l.trim()).filter(Boolean);
  if (positional.length > 1) o.text = positional.slice(1).join(" ");
  if (o.review !== null && !(o.review > 0 && o.review <= 1)) fail("--review takes a threshold between 0 and 1, e.g. --review 0.7");
  if (o.max && !(o.max > 0)) fail("--max takes a positive number");
  return o;
}

function fail(msg, code = 1) {
  process.stderr.write(`classify: ${msg}\n`);
  process.exit(code);
}

// ---------------------------------------------------------------- input

/** Returns [{text, id?}] from stdin: plain lines, a JSON array, or NDJSON. */
export function parseInput(raw, field = "text", idField = null) {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const fromObj = (v) => {
    if (typeof v === "string") return { text: v };
    if (v && typeof v === "object") {
      const text = v[field];
      if (typeof text !== "string") throw new Error(`input object has no string field "${field}" (use --field)`);
      return idField ? { text, id: v[idField] } : { text };
    }
    throw new Error("input array must hold strings or objects");
  };
  if (trimmed[0] === "[") return JSON.parse(trimmed).map(fromObj);
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.every((l) => l[0] === "{")) return lines.map((l) => fromObj(JSON.parse(l)));
  return lines.map((text) => ({ text }));
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

// ---------------------------------------------------------------- api

async function post(o, inputs) {
  const body = { inputs, labels: o.labels };
  if (o.multi) body.multi = true;
  if (o.max) body.max_labels = o.max;
  if (o.smart) body.tier = "smart";
  if (o.instructions) body.instructions = o.instructions;
  const headers = { "content-type": "application/json", "user-agent": `classify-cli/${PKG.version}` };
  if (o.apiKey) headers.authorization = `Bearer ${o.apiKey}`;

  let last = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    let res;
    try {
      res = await fetch(o.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      last = e.name === "TimeoutError" ? `no answer in ${TIMEOUT_MS / 1000}s` : `network error: ${e.message}`;
      await sleep(500 * 2 ** attempt);
      continue;
    }
    const payload = await res.json().catch(() => ({}));
    if (res.ok) return payload.results;
    last = payload.error || `HTTP ${res.status}`;
    if (res.status === 429) {
      // The API says exactly how long; a batch that trips the minute window
      // resumes on its own rather than dying at item 7,400.
      const wait = Number(res.headers.get("retry-after")) || 5;
      process.stderr.write(`classify: rate limited, retrying in ${wait}s\n`);
      await sleep(wait * 1000);
      continue;
    }
    if (res.status >= 500) { await sleep(500 * 2 ** attempt); continue; }
    break; // 4xx: our fault, no point retrying
  }
  throw new Error(last);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Classify everything, handing results to `onReady` in input order as soon as
 * they are contiguous. Batches finish out of order at concurrency 4, so a
 * result is held only until the ones before it arrive — which keeps `| head`
 * fast on a large file instead of waiting for the whole run.
 */
export async function classifyAll(o, items, onReady, onProgress) {
  const out = new Array(items.length);
  const done = new Array(items.length).fill(false);
  const batches = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(i);
  let next = 0;
  let flushed = 0;
  let completed = 0;

  const flush = () => {
    while (flushed < items.length && done[flushed]) {
      onReady?.(flushed, out[flushed]);
      flushed++;
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
      while (next < batches.length) {
        const start = batches[next++];
        const slice = items.slice(start, start + BATCH);
        const results = await post(o, slice.map((it) => it.text));
        results.forEach((r, k) => { out[start + k] = r; done[start + k] = true; });
        completed += results.length;
        onProgress?.(completed, items.length);
        flush();
      }
    }),
  );
  flush();
  return out;
}

/**
 * A counter on stderr, so a long run is not an unexplained pause. Only when
 * stderr is a terminal: piped or redirected output stays clean.
 */
export function makeProgress(enabled) {
  let shown = false;
  return {
    update(done, total) {
      if (!enabled) return;
      shown = true;
      process.stderr.write(`\rclassify: ${done.toLocaleString()}/${total.toLocaleString()}`);
    },
    clear() {
      if (enabled && shown) process.stderr.write("\r\u001b[K");
    },
  };
}

// ---------------------------------------------------------------- output

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\r?\n/g, "\\n");

/** One output row, or null when --review filters it out. */
export function formatRow(o, it, r, i) {
  const label = o.multi ? (r.labels || []).join(",") : r.label;
  // Multi-label answers have no single confidence; use the weakest kept label,
  // so --review surfaces items whose last label was a stretch.
  const confidence = o.multi
    ? (r.labels || []).length ? Math.min(...r.labels.map((l) => r.scores?.[l] ?? 0)) : 0
    : r.confidence;
  if (o.review !== null && !(confidence === null || confidence < o.review)) return null;
  if (o.json) return JSON.stringify({ i, ...(it.id !== undefined ? { id: it.id } : {}), text: it.text, ...r });
  if (o.quiet) return label;
  const c = confidence === null ? "-" : Number(confidence).toFixed(2);
  return `${label}\t${c}\t${(it.id !== undefined ? esc(it.id) + "\t" : "")}${esc(it.text)}`;
}

export function formatRows(o, items, results) {
  const rows = [];
  items.forEach((it, i) => {
    const row = formatRow(o, it, results[i], i);
    if (row !== null) rows.push(row);
  });
  return rows;
}

export function formatCount(o, results) {
  const tally = new Map();
  for (const r of results) {
    const labels = o.multi ? r.labels || [] : [r.label];
    for (const l of labels) tally.set(l, (tally.get(l) || 0) + 1);
  }
  for (const l of o.labels) if (!tally.has(l)) tally.set(l, 0);
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${n}\t${l}`);
}

// ---------------------------------------------------------------- update check

/** One registry hit a day, 1.5s budget, never blocks the answer. */
async function updateHint() {
  if (process.env.CLASSIFY_NO_UPDATE_CHECK) return "";
  try {
    const dir = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "classify");
    const file = join(dir, "latest.json");
    let latest = null;
    try {
      if (Date.now() - statSync(file).mtimeMs < 86_400_000) latest = JSON.parse(readFileSync(file, "utf8")).version;
    } catch { /* no cache */ }
    if (!latest) {
      const res = await fetch(`https://registry.npmjs.org/${PKG.name}/latest`, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return "";
      latest = (await res.json()).version;
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify({ version: latest }));
    }
    return latest && newer(latest, PKG.version)
      ? `classify ${latest} is available (you have ${PKG.version}): npm i -g ${PKG.name}\n`
      : "";
  } catch {
    return "";
  }
}

export function newer(a, b) {
  const pa = a.split(/[.-]/).map(Number), pb = b.split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

// ---------------------------------------------------------------- main

export async function main(argv) {
  const o = parseArgs(argv);
  if (o.help) { process.stdout.write(HELP); return 0; }
  if (o.version) { process.stdout.write(`${PKG.version}\n`); return 0; }
  if (!o.labels) { process.stdout.write(HELP); return 2; }
  if (o.labels.length < 2) fail("give at least two labels, comma-separated: classify spam,\"not spam\" ...");
  if (o.labels.length > 100) fail("at most 100 labels");

  const hint = updateHint();

  let items;
  if (o.text !== null) items = [{ text: o.text }];
  else {
    try { items = parseInput(await readStdin(), o.field, o.id); }
    catch (e) { fail(`could not read input: ${e.message}`); }
    if (!items.length) { process.stdout.write(HELP); return 2; }
  }

  // --count needs every answer before it can tally; a single text is one row.
  // Everything else streams, so `| head` on a large file returns immediately.
  const single = o.text !== null && !o.json;
  const streaming = !o.count && !single;

  // The counter would fight the rows for the same terminal, so it only appears
  // when stdout is going somewhere else — a file, a pipe — or prints nothing.
  const progress = makeProgress(
    !process.env.CLASSIFY_NO_PROGRESS && !process.env.CI &&
    process.stderr.isTTY && (!process.stdout.isTTY || o.count) && items.length > 50,
  );
  process.on("SIGINT", () => {
    progress.clear();
    process.stderr.write("classify: interrupted\n");
    process.exit(130);
  });
  // `| head` closes the pipe while rows are still being written. That is a
  // normal end to a stream, not a failure, so it must not raise.
  process.stdout.on("error", (e) => { if (e.code === "EPIPE") process.exit(0); });

  let results;
  try {
    results = await classifyAll(
      o,
      items,
      streaming
        ? (i, r) => {
            const row = formatRow(o, items[i], r, i);
            if (row !== null) process.stdout.write(row + "\n");
          }
        : null,
      (done, total) => progress.update(done, total),
    );
  } catch (e) { progress.clear(); fail(e.message); }
  progress.clear();

  if (!streaming) {
    const lines = o.count
      ? formatCount(o, results)
      : o.multi ? [(results[0].labels || []).join("\n")] : [results[0].label];
    if (lines.length) process.stdout.write(lines.join("\n") + "\n");
  }

  const h = await hint;
  if (h) process.stderr.write(h);
  return 0;
}

// npm installs the bin as a symlink, so argv[1] must be resolved before it can
// be compared with this file; without that a global install runs nothing.
const invokedAs = (() => { try { return realpathSync(process.argv[1] ?? ""); } catch { return ""; } })();
if (invokedAs === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => fail(e.message));
}
