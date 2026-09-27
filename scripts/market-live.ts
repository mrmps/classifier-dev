/**
 * Live Market pipeline harness: retrieval → membership → panel → votes,
 * against the real corpus and real Jev, without the worker or billing.
 *
 *   bun --env-file=.dev.vars scripts/market-live.ts "<audience>" "<option a>" "<option b>" [population] [decision]
 *
 * Requires DATABASE_URL (market corpus), TYPESAFE_API_KEY, and — for vector
 * retrieval — OPENROUTER_EMBED_KEY in the environment.
 */
import { neon } from "@neondatabase/serverless";
import { jevKeys } from "../src/jev";
import { newMeter } from "../src/cost";
import {
  aggregate,
  readMarketRequest,
  runVotes,
  samplePanel,
  scoreMembership,
  seededRandom,
  sha256Hex,
  voteBatches,
  MARKET_CORPUS_VERSION,
  MEMBERSHIP_SHORTLIST,
  type PanelMember,
} from "../src/market";

const [audience, a, b, populationRaw, decisionRaw] = process.argv.slice(2);
if (!audience || !a || !b) {
  console.error('usage: bun scripts/market-live.ts "<audience>" "<option a>" "<option b>" [population] [decision]');
  process.exit(1);
}
const request = readMarketRequest({
  audience,
  options: [a, b],
  population: populationRaw ? Number(populationRaw) : 200,
  ...(decisionRaw ? { decision: decisionRaw } : {}),
});

const sql = neon(process.env.MARKET_DATABASE_URL ?? process.env.DATABASE_URL!);
const keys = jevKeys(process.env as Record<string, string>)!;
const meter = newMeter();
const t0 = Date.now();
const lap = (label: string) => console.log(`${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s, spend $${meter.usd.toFixed(4)}`);

// 1. Embed the audience (optional).
let embedding: string | null = null;
if (process.env.OPENROUTER_EMBED_KEY) {
  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENROUTER_EMBED_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: [request.audience], dimensions: 512 }),
  });
  const data = await response.json() as { data?: { embedding: number[] }[] };
  if (data.data?.[0]) embedding = `[${data.data[0].embedding.map((x) => x.toFixed(5)).join(",")}]`;
}
lap(`embed (${embedding ? "ok" : "SKIPPED"})`);

// 2. Retrieve.
const shortlist = (embedding
  ? (await sql.transaction((tx) => [
      tx`SET LOCAL hnsw.ef_search = 1000`,
      tx`
      WITH vec AS (SELECT id FROM market_personas ORDER BY embedding <=> ${embedding}::halfvec(512) LIMIT 1000),
           kw AS (SELECT id FROM market_personas
                  WHERE tsv @@ websearch_to_tsquery('english', ${request.audience})
                  ORDER BY ts_rank(tsv, websearch_to_tsquery('english', ${request.audience})) DESC LIMIT 1400)
      SELECT p.id, p.panel_text FROM market_personas p
      WHERE p.id IN (SELECT id FROM vec UNION SELECT id FROM kw)`,
    ]))[1]
  : await sql`
      SELECT id, panel_text FROM market_personas
      WHERE tsv @@ websearch_to_tsquery('english', ${request.audience})
      ORDER BY ts_rank(tsv, websearch_to_tsquery('english', ${request.audience})) DESC LIMIT 2200`
) as { id: number; panel_text: string }[];
lap(`retrieve (${shortlist.length} candidates)`);

// 3. Membership scoring.
const audienceId = await sha256Hex(`${MARKET_CORPUS_VERSION}\n${request.audience}\n${request.population}`);
const random = seededRandom(audienceId);
const scored = shortlist
  .map((row) => ({ row, key: random() }))
  .sort((x, y) => x.key - y.key)
  .slice(0, MEMBERSHIP_SHORTLIST)
  .map(({ row }) => ({ id: row.id, text: row.panel_text }));
const weights = await scoreMembership(keys, request.audience, scored, meter);
const histogram = [0, 0, 0, 0, 0];
for (const w of weights) histogram[Math.min(4, Math.floor(w * 4))]++;
lap(`membership (weights 0-.25/.25-.5/.5-.75/.75-1/1: ${histogram.join("/")})`);

// 4. Panel.
const members = scored.map((candidate, i) => ({ id: candidate.id, weight: weights[i] })).filter((m) => m.weight > 0);
const panelIds = samplePanel(members, request.population, audienceId);
const textById = new Map(scored.map((candidate) => [candidate.id, candidate.text]));
const attrsRows = await sql`SELECT id, attrs FROM market_personas WHERE id = ANY(${panelIds.map((m) => m.id)})` as { id: number; attrs: Record<string, unknown> }[];
const attrsById = new Map(attrsRows.map((row) => [row.id, row.attrs]));
const panel = new Map<number, PanelMember>(panelIds.map((m) => [m.id, { id: m.id, weight: m.weight, attrs: attrsById.get(m.id) ?? {} }]));
console.log(`panel: ${panelIds.length} of ${members.length} eligible`);
for (const m of panelIds.slice(0, 3)) console.log(`  · w=${m.weight.toFixed(2)} ${textById.get(m.id)?.slice(0, 130)}`);

// 5. Votes.
const batches = voteBatches(request.options, panelIds.map((m) => ({ id: m.id, text: textById.get(m.id)! })), request.decision);
const { votes, failedRespondents } = await runVotes(keys, batches, request.options, meter);
lap(`votes (${votes.length} answered, ${failedRespondents} failed)`);

// 6. Aggregate.
const result = aggregate(request, audienceId, scored.length, panel, votes);
console.log(JSON.stringify(result, null, 1));
lap("total");
