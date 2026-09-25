/**
 * POST /v1/market/compare — account-billed market preference.
 *
 * The audience resolves once and is cached in market_audiences forever, keyed
 * by sha256(corpus version + audience text): retrieval (hybrid keyword +
 * vector over market_personas) shortlists candidates, one Jev Score per
 * candidate grades membership, and a seeded weighted sample fixes the panel.
 * The same audience string therefore always polls the same simulated people,
 * which is what makes two experiments against one audience comparable.
 *
 * Billing mirrors classification: a token reservation is extended before
 * every provider call and settled to measured usage. The one OpenRouter
 * embedding per audience miss (~30 tokens) is infrastructure cost like the
 * database query, deliberately outside the meter: an unpriced model row
 * would push every settlement into review.
 */

import { neon } from "@neondatabase/serverless";
import type { Env } from "../index";
import { jevKeys } from "../jev";
import { newMeter } from "../cost";
import rates from "../retail-rates.json";
import { AppError, type AppEnv } from "../server/db";
import { authorizeAndReserve } from "../server/usage";
import { parseTokenRateCard, priceTokens } from "../server/token-pricing";
import { extendTokenReservation, providerCallBound } from "../server/token-reservation";
import { refundTokenReservation, settleTokenReservation } from "../server/token-ledger";
import { writeAccountAnalytics } from "../server/analytics/write";
import {
  aggregate,
  MARKET_RECIPE_VERSION,
  assertOptionsFit,
  MARKET_CORPUS_VERSION,
  MarketError,
  MEMBERSHIP_SHORTLIST,
  readMarketRequest,
  runVotes,
  samplePanel,
  scoreMembership,
  seededRandom,
  sha256Hex,
  voteBatches,
  type MarketRequest,
  type PanelMember,
} from "../market";

const card = parseTokenRateCard(JSON.stringify(rates))!;
const EMBED_URL = "https://openrouter.ai/api/v1/embeddings";
const EMBED_MODEL = "openai/text-embedding-3-small";
const EMBED_DIMS = 512;

type MarketEnv = AppEnv & Partial<Env> & { MARKET_DATABASE_URL?: string };

/** The audience embedding; null degrades retrieval to keywords only. */
async function embedAudience(env: MarketEnv, audience: string): Promise<string | null> {
  if (!env.OPENROUTER_API_KEY) return null;
  try {
    const response = await fetch(EMBED_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: [audience], dimensions: EMBED_DIMS }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { data?: { embedding?: number[] }[] };
    const vector = data.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== EMBED_DIMS) return null;
    return `[${vector.map((x) => x.toFixed(5)).join(",")}]`;
  } catch {
    return null;
  }
}

type StoredPanel = { id: number; w: number }[];

/** Resolve or build the audience panel. Returns members and the shortlist size. */
async function resolveAudience(
  env: MarketEnv,
  sql: ReturnType<typeof neon<false, false>>,
  request: MarketRequest,
  audienceId: string,
  meter: ReturnType<typeof newMeter>,
): Promise<{ panel: StoredPanel; candidates: number }> {
  const cached = await sql`SELECT panel, candidates FROM market_audiences WHERE id = ${audienceId}` as { panel: StoredPanel; candidates: number }[];
  if (cached.length) return { panel: cached[0].panel, candidates: cached[0].candidates };

  const embedding = await embedAudience(env, request.audience);
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

  if (shortlist.length < 25) {
    throw new MarketError(
      `Only ${shortlist.length} corpus personas resembled this audience. The corpus is ${MARKET_CORPUS_VERSION} (US general population); describe the audience with occupations or demographics it can contain.`,
      422,
    );
  }

  // A shortlist larger than the scoring budget is sampled, never truncated by
  // rank: the top of a similarity ranking is the most stereotypical slice.
  const random = seededRandom(audienceId);
  const scored = shortlist
    .map((row) => ({ row, key: random() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, MEMBERSHIP_SHORTLIST)
    .map(({ row }) => ({ id: row.id, text: row.panel_text }));

  const keys = jevKeys(env as Parameters<typeof jevKeys>[0]);
  if (!keys) throw new MarketError("Inference is not configured.", 503);
  const weights = await scoreMembership(keys, request.audience, scored, meter);
  const members = scored
    .map((candidate, index) => ({ id: candidate.id, weight: Number(weights[index].toFixed(4)) }))
    .filter((member) => member.weight > 0);

  const panel = samplePanel(members, request.population, audienceId).map((member) => ({ id: member.id, w: member.weight }));
  if (panel.length < 25) {
    throw new MarketError(
      `Only ${panel.length} of ${scored.length} shortlisted personas fit this audience; the corpus cannot represent it. Try a broader or more US-general audience.`,
      422,
    );
  }
  await sql`
    INSERT INTO market_audiences (id, query, corpus_version, panel, candidates)
    VALUES (${audienceId}, ${request.audience}, ${MARKET_CORPUS_VERSION}, ${JSON.stringify(panel)}::jsonb, ${scored.length})
    ON CONFLICT (id) DO NOTHING`;
  return { panel, candidates: scored.length };
}

export async function accountMarket(request: Request, env: MarketEnv, _ctx: ExecutionContext): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/v1/market/compare") return null;
  if (!/^Bearer\s+classifier_agent_/i.test(request.headers.get("authorization") || "")) return null;
  if (request.method !== "POST") throw new AppError(405, "Use POST for market comparisons.");
  if (!env.MARKET_DATABASE_URL) throw new AppError(503, "Market is not configured for this deployment.");

  const text = await request.text();
  if (new TextEncoder().encode(text).length > 100_000) throw new AppError(413, "Request is too large.");
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { throw new AppError(400, "Send valid JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError(400, "Send a JSON object.");

  let marketRequest: MarketRequest;
  try {
    marketRequest = readMarketRequest(body);
    assertOptionsFit(marketRequest.options);
  } catch (error) {
    if (error instanceof MarketError) throw new AppError(error.status, error.message);
    throw error;
  }

  const reservation = await authorizeAndReserve(request, env, 0, marketRequest.population, {
    type: "API · Market", meteringMode: "tokens",
  });
  if (!reservation) throw new AppError(401, "Missing account credential.");

  const meter = newMeter();
  let admissionError: AppError | undefined;
  let reservationQueue = Promise.resolve();
  meter.beforeCall = (provider, model, maxOutput) => {
    const admission = reservationQueue.then(async () => {
      if (admissionError) throw admissionError;
      try { await extendTokenReservation(env.APP_DB, reservation.id, providerCallBound(card, provider, model, maxOutput)); }
      catch (error) {
        admissionError = error instanceof AppError ? error : new AppError(503, "Credit reservation is temporarily unavailable.");
        throw admissionError;
      }
    });
    reservationQueue = admission.catch(() => {});
    return admission;
  };

  const started = Date.now();
  const tokens = () => {
    const sum = (field: "inputTokens" | "outputTokens" | "cachedInputTokens") =>
      meter.tokens.length && meter.tokens.every((row) => row[field] !== null)
        ? meter.tokens.reduce((total, row) => total + row[field]!, 0) : null;
    return { inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), cachedInputTokens: sum("cachedInputTokens") };
  };
  const analytics = (success: boolean, retailCostUsd: number | null) => writeAccountAnalytics(env, {
    accountId: reservation.accountId, keyId: reservation.agentId, requestId: reservation.id, source: "API", tier: "smart",
    status: success ? "success" : "error", items: marketRequest.population, ...tokens(),
    model: "market," + meter.tokens.map((row) => row.model).join(","),
    providerCostUsd: meter.tokens.length ? meter.usd : null, retailCostUsd, latencyMs: Date.now() - started,
  });

  let result;
  try {
    const sql = neon(env.MARKET_DATABASE_URL);
    const audienceId = await sha256Hex(`${MARKET_CORPUS_VERSION}\n${MARKET_RECIPE_VERSION}\n${marketRequest.audience}\n${marketRequest.population}`);
    const { panel: stored, candidates } = await resolveAudience(env, sql, marketRequest, audienceId, meter);

    const ids = stored.map((member) => member.id);
    const rows = await sql`SELECT id, panel_text, attrs FROM market_personas WHERE id = ANY(${ids})` as
      { id: number; panel_text: string; attrs: Record<string, unknown> }[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const panel = new Map<number, PanelMember>();
    const votersInput: { id: number; text: string }[] = [];
    for (const member of stored) {
      const row = byId.get(member.id);
      if (!row) continue;
      panel.set(member.id, { id: member.id, weight: member.w, attrs: row.attrs });
      votersInput.push({ id: member.id, text: row.panel_text });
    }

    const keys = jevKeys(env as Parameters<typeof jevKeys>[0]);
    if (!keys) throw new MarketError("Inference is not configured.", 503);
    const batches = voteBatches(marketRequest.options, votersInput, marketRequest.decision);
    const { votes, failedRespondents } = await runVotes(keys, batches, marketRequest.options, meter);
    if (!votes.length) throw new MarketError("No panel votes completed; the upstream model refused the whole panel. Retry shortly.", 502);

    result = {
      ...aggregate(marketRequest, audienceId, candidates, panel, votes),
      ...(stored.length < marketRequest.population ? {
        note: `Only ${stored.length} corpus personas fit this audience; the panel is smaller than the requested population and the interval reflects that.`,
      } : {}),
      failed_respondents: failedRespondents,
      options: Object.fromEntries(marketRequest.options.map((option) => [option.id, option.content.slice(0, 80)])),
    };
    await reservationQueue;
    if (admissionError) throw admissionError;
  } catch (error) {
    await reservationQueue;
    await refundTokenReservation(env.APP_DB, reservation.id);
    analytics(false, 0);
    if (error instanceof MarketError) throw new AppError(error.status, error.message);
    if (error instanceof AppError) throw error;
    throw new AppError(502, "The market comparison failed. Your reserved balance was returned.");
  }

  const charge = priceTokens(card, meter.tokens);
  let billingStatus = "settled";
  try { await settleTokenReservation(env.APP_DB, reservation.id, charge, tokens()); }
  catch { billingStatus = "review"; }
  if (!charge) billingStatus = "review";
  analytics(true, charge ? Number(charge.nanodollars) / 1e9 : null);

  return Response.json({
    ...result,
    usage: {
      ...tokens(),
      models: meter.tokens.map((row) => ({ provider: row.provider, model: row.model, calls: row.calls })),
    },
    pricing: {
      currency: "USD", rate_version: card.version,
      total_usd: charge ? Number(charge.nanodollars) / 1e9 : null,
      billing_status: billingStatus,
    },
  }, {
    headers: { "cache-control": "no-store", "x-request-id": reservation.id, "x-billing-status": billingStatus },
  });
}
