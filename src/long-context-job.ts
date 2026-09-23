import { classificationPricing, classificationUsage } from "./classification-usage";
import { newMeter, type Meter, type ModelTokenUsage } from "./cost";
import { jevClassificationFits, jevClassify, jevKeys, MULTI_THRESHOLD } from "./jev";
import {
  EVIDENCE_TOKENS, IRRELEVANT_CONFIDENCE, LONG_CONTEXT_BACKEND,
  LONG_CONTEXT_JOB_MAX_TOKENS, LONG_CONTEXT_PART_MAX_TOKENS, LONG_CONTEXT_MAX_PARTS,
  LONG_CONTEXT_MAX_DECISIONS, LONG_CONTEXT_MAX_INPUTS,
  SCREENING_BACKEND, SCREEN_LABELS, chunkLongContextPart, countContextTokens,
  longContextFinalInstructions, longContextScreeningInstructions, LongContextError,
} from "./long-context";
import { recordLongContext } from "./long-context-analytics";
import { longContextCharge } from "./lib/classification-pricing";
import { requireApiAccount } from "./server/account-access";
import { writeAccountAnalytics } from "./server/analytics/write";
import { AppError, type AppEnv } from "./server/db";
import { appEnvironment } from "./server/environment";
import { refundTokenReservation, settleTokenReservation } from "./server/token-ledger";
import { authorizeAndReserve } from "./server/usage";
import { boundedRequest } from "./spending";
import { Permit } from "./spending/permit";
import { policy, SpendingError } from "./spending/policy";
import type { Env } from "./index";

const EVIDENCE_RESERVOIR_TOKENS = 30_000;
const JOB_TTL_MS = 24 * 60 * 60 * 1000;

type Candidate = { index: number; text: string; score: number; tokens: number };
type Job = {
  id: string; accountId: string; agentId: string; reservationId: string; createdAt: number;
  status: "open" | "settling" | "finished" | "failed";
  maxTokens: number; documents: number; labels: string[]; instructions?: string; multi: boolean;
  nextPart: number; lastDocument: number; chunkIndexes: number[];
  stats: NonNullable<Meter["longContext"]>; tokens: ModelTokenUsage[];
  providerCostUsd: number | null;
  result?: Record<string, unknown>;
};

function answer(status: number, code: string, message: string): Response {
  return Response.json({ error: message, code }, { status, headers: { "cache-control": "no-store" } });
}

function validLabels(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 2 && value.length <= 100 &&
    value.every(label => typeof label === "string" && !!label.trim() && label.length <= 200) &&
    new Set(value).size === value.length;
}

function joinUsage(into: ModelTokenUsage[], rows: ModelTokenUsage[]) {
  for (const row of rows) {
    const prior = into.find(other => other.provider === row.provider && other.model === row.model);
    if (!prior) { into.push({ ...row }); continue; }
    prior.calls += row.calls;
    for (const key of ["inputTokens", "outputTokens", "cachedInputTokens"] as const)
      prior[key] = prior[key] === null || row[key] === null ? null : prior[key]! + row[key]!;
  }
}

/** One private job stores selected evidence only; full source parts are discarded after screening. */
export class LongContextJob implements DurableObject {
  private busy = false;
  private readonly env: Env & AppEnv;
  constructor(private readonly state: DurableObjectState, bindings: Env & Partial<AppEnv>) {
    this.env = appEnvironment(bindings);
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const accountId = await requireApiAccount(request, this.env);
      const job = await this.state.storage.get<Job>("job");
      if (job && job.accountId !== accountId) return answer(404, "not_found", "Job not found.");
      const path = new URL(request.url).pathname;
      if (request.method === "PUT" && path.endsWith("/create")) return this.create(request, accountId, job);
      if (!job) return answer(404, "not_found", "Job not found.");
      if (request.method === "GET" && path.endsWith("/status"))
        return Response.json({ id: job.id, status: job.status, parts: job.nextPart, context_tokens: job.stats.contextTokens,
          max_tokens: job.maxTokens, ...(job.status === "finished" ? { result: job.result } : {}) });
      if (request.method === "PUT" && /\/parts\/\d+$/.test(path))
        return this.part(request, job, Number(path.split("/").at(-1)));
      if (request.method === "POST" && path.endsWith("/finish")) return this.finish(job);
      if (request.method === "POST" && path.endsWith("/cancel")) {
        if (job.status === "open") await this.fail(job);
        return Response.json({ id: job.id, status: job.status });
      }
      return answer(404, "not_found", "Job route not found.");
    } catch (error) {
      if (error instanceof LongContextError || error instanceof SpendingError)
        return answer(error.status, error.code, error.message);
      if (error instanceof AppError) return answer(error.status,
        error.status >= 500 ? "long_context_unavailable" : error.status === 401 ? "invalid_api_key" : "long_context_input",
        error.message);
      if (error instanceof SyntaxError) return answer(400, "long_context_input", "Send valid JSON.");
      return answer(503, "long_context_unavailable", "Long-context job unavailable.");
    }
  }

  private async create(request: Request, accountId: string, existing?: Job): Promise<Response> {
    if (existing) return Response.json({ id: existing.id, status: existing.status, max_tokens: existing.maxTokens });
    if (this.busy) return answer(409, "job_busy", "The job is processing another request.");
    this.busy = true;
    try {
      const body = await (await boundedRequest(request)).json() as Record<string, unknown>;
      if (!body || typeof body !== "object" || Array.isArray(body))
        return answer(400, "long_context_input", "Provide a JSON job configuration.");
      const maxTokens = body.max_tokens;
      const documents = body.documents;
      if (!Number.isSafeInteger(maxTokens) || (maxTokens as number) < 1 || (maxTokens as number) > LONG_CONTEXT_JOB_MAX_TOKENS ||
        !Number.isSafeInteger(documents) || (documents as number) < 1 || (documents as number) > LONG_CONTEXT_MAX_INPUTS ||
        !validLabels(body.labels) || (typeof body.instructions !== "undefined" && (typeof body.instructions !== "string" || body.instructions.length > 4000)) ||
        (body.multi !== undefined && typeof body.multi !== "boolean") ||
        (body.tier !== undefined && body.tier !== "fast"))
        return answer(400, "long_context_input", "Provide max_tokens (1–10,000,000), documents (1–20), labels and optional instructions; fast tier only.");
      const labels = body.labels as string[];
      const multi = body.multi === true;
      if ((documents as number) * (multi ? labels.length : 1) > LONG_CONTEXT_MAX_DECISIONS)
        return answer(400, "too_many_decisions", "This job exceeds 32 decisions.");
      const instructions = body.instructions as string | undefined;
      if (!jevClassificationFits("", SCREEN_LABELS, longContextScreeningInstructions(labels, instructions), false) ||
        !jevClassificationFits("", labels, longContextFinalInstructions(instructions), multi))
        return answer(400, "long_context_input", "The labels and instructions exceed Jev's context budget.");
      const funded = await this.env.APP_DB.prepare(`SELECT (paid_balance>0 OR
        (billing_plan IN ('pro','max','scale') AND reset_at::timestamptz>now())) AS funded
        FROM app_accounts WHERE id=?`).bind(accountId).first<{ funded: boolean }>();
      if (!funded?.funded) return answer(402, "long_context_payment_required", "A funded workspace is required.");
      const credits = Number((longContextCharge(maxTokens as number).nanodollars + 9999n) / 10000n);
      const reservation = await authorizeAndReserve(request, this.env, credits, documents as number,
        { type: "API · Long context job", meteringMode: "tokens" });
      if (!reservation) return answer(401, "invalid_api_key", "A workspace API key is required.");
      const id = new URL(request.url).pathname.split("/")[4];
      const job: Job = { id, accountId, agentId: reservation.agentId, reservationId: reservation.id,
        createdAt: Date.now(), status: "open",
        maxTokens: maxTokens as number, documents: documents as number, labels, instructions, multi,
        nextPart: 0, lastDocument: 0, chunkIndexes: Array(documents as number).fill(0),
        tokens: [], providerCostUsd: 0,
        stats: { contextTokens: 0, documents: documents as number, chunks: 0, screenedChunks: 0,
          eligibleChunks: 0, selectedChunks: 0, omittedChunks: 0,
          screeningInputTokens: 0, finalInputTokens: 0, screeningCalls: 0, finalCalls: 0,
          screeningMs: 0, finalMs: 0, tokenizer: "cl100k_base" } };
      try {
        await this.state.storage.setAlarm(Date.now() + JOB_TTL_MS);
        await this.state.storage.put("job", job);
      } catch (error) {
        await refundTokenReservation(this.env.APP_DB, reservation.id);
        throw error;
      }
      return Response.json({ id, status: "open", max_tokens: maxTokens, part_max_tokens: LONG_CONTEXT_PART_MAX_TOKENS,
        expires_in_seconds: JOB_TTL_MS / 1000, reservation_usd: credits / 100000 }, { status: 201 });
    } finally { this.busy = false; }
  }

  private async part(request: Request, job: Job, sequence: number): Promise<Response> {
    if (job.status !== "open") return answer(409, "job_closed", "This job is closed.");
    if (this.busy) return answer(409, "job_busy", "The job is processing another request.");
    if (!Number.isSafeInteger(sequence) || sequence !== job.nextPart)
      return answer(409, "part_sequence", `The next part is ${job.nextPart}.`);
    if (job.nextPart >= LONG_CONTEXT_MAX_PARTS)
      return answer(400, "long_context_too_large", `A job accepts at most ${LONG_CONTEXT_MAX_PARTS.toLocaleString("en-US")} parts.`);
    this.busy = true;
    try {
      const body = await (await boundedRequest(request)).json() as Record<string, unknown>;
      const document = body.document;
      const text = body.text;
      if (!Number.isSafeInteger(document) || (document as number) < job.lastDocument ||
        (document as number) >= job.documents || typeof text !== "string" || !text.trim())
        return answer(400, "long_context_input", "Provide nonempty text and a document index in source order.");
      const count = countContextTokens(text as string);
      if (count > LONG_CONTEXT_PART_MAX_TOKENS || job.stats.contextTokens + count > job.maxTokens)
        return answer(400, "long_context_too_large", "The part or job exceeds its token limit.");
      const chunks = await chunkLongContextPart(text as string);
      const screenInstructions = longContextScreeningInstructions(job.labels, job.instructions);
      if (chunks.some(chunk => !jevClassificationFits(chunk, SCREEN_LABELS, screenInstructions, false)))
        return answer(400, "long_context_input", "A chunk and its instructions exceed Jev's context budget.");
      const meter = newMeter();
      meter.permit = new Permit(policy(this.env).paidRequest, Date.now() + 300_000);
      meter.beforeCall = async () => {};
      const keys = jevKeys(this.env);
      if (!keys) return answer(503, "long_context_unavailable", "Jev is unavailable.");
      const started = Date.now();
      const screening = await jevClassify(keys, chunks, SCREEN_LABELS,
        screenInstructions, false, meter, SCREENING_BACKEND);
      const existing = await this.state.storage.get<Candidate[]>(`doc:${document}`) ?? [];
      const candidates = [...existing];
      let eligible = 0;
      for (let i = 0; i < chunks.length; i++) {
        const result = screening[i];
        if (result.label === "irrelevant" && result.confidence >= IRRELEVANT_CONFIDENCE &&
          result.scores.irrelevant >= IRRELEVANT_CONFIDENCE) continue;
        eligible++;
        candidates.push({ index: job.chunkIndexes[document as number] + i, text: chunks[i],
          score: result.scores.relevant, tokens: countContextTokens(chunks[i]) });
      }
      candidates.sort((a, b) => b.score - a.score || a.index - b.index);
      let kept = candidates.reduce((sum, item) => sum + item.tokens, 0);
      while (kept > EVIDENCE_RESERVOIR_TOKENS) kept -= candidates.pop()!.tokens;
      job.stats.contextTokens += count;
      job.stats.chunks += chunks.length;
      job.stats.screenedChunks += screening.length;
      job.stats.eligibleChunks += eligible;
      job.stats.screeningCalls += meter.tokens.reduce((sum, row) => sum + row.calls, 0);
      job.stats.screeningInputTokens = job.stats.screeningInputTokens === null || meter.tokens.some(row => row.inputTokens === null)
        ? null : job.stats.screeningInputTokens + meter.tokens.reduce((sum, row) => sum + row.inputTokens!, 0);
      job.stats.screeningMs += Date.now() - started;
      joinUsage(job.tokens, meter.tokens);
      job.providerCostUsd = job.providerCostUsd === null || meter.tokens.some(row => row.inputTokens === null)
        ? null : job.providerCostUsd + meter.usd;
      job.chunkIndexes[document as number] += chunks.length;
      job.lastDocument = document as number;
      job.nextPart++;
      await this.state.storage.transaction(async transaction => {
        await transaction.put(`doc:${document}`, candidates);
        await transaction.put("job", job);
      });
      return Response.json({ id: job.id, status: job.status, next_part: job.nextPart,
        context_tokens: job.stats.contextTokens, screened_chunks: job.stats.screenedChunks,
        max_tokens: job.maxTokens });
    } finally { this.busy = false; }
  }

  private async finish(job: Job): Promise<Response> {
    if (job.status === "finished") return Response.json(job.result);
    if (job.status === "settling") {
      if (this.busy) return answer(409, "job_busy", "The job is settling.");
      this.busy = true;
      try { return await this.settle(job); }
      finally { this.busy = false; }
    }
    if (job.status !== "open") return answer(409, "job_closed", "This job is closed.");
    if (this.busy) return answer(409, "job_busy", "The job is processing another request.");
    if (job.stats.contextTokens === 0 || job.chunkIndexes.some(index => index === 0))
      return answer(400, "long_context_input", "Every document needs at least one part.");
    this.busy = true;
    try {
      const instructions = longContextFinalInstructions(job.instructions);
      const evidence: string[] = [];
      for (let document = 0; document < job.documents; document++) {
        const candidates = await this.state.storage.get<Candidate[]>(`doc:${document}`) ?? [];
        let selected: Candidate[] = [];
        let packed = "";
        for (const candidate of candidates) {
          const proposed = [...selected, candidate].sort((a, b) => a.index - b.index);
          const text = proposed.map(item => `[Excerpt ${item.index + 1}]\n${item.text}`).join("\n\n");
          if (countContextTokens(text) <= EVIDENCE_TOKENS &&
            jevClassificationFits(text, job.labels, instructions, job.multi)) {
            selected = proposed;
            packed = text;
          }
        }
        if (!selected.length) {
          await this.fail(job);
          return answer(422, "long_context_no_evidence", "No usable evidence was selected for a document.");
        }
        evidence.push(packed);
        job.stats.selectedChunks += selected.length;
      }
      job.stats.omittedChunks = job.stats.eligibleChunks - job.stats.selectedChunks;
      const meter = newMeter();
      meter.permit = new Permit(policy(this.env).paidRequest, Date.now() + 300_000);
      meter.beforeCall = async () => {};
      const keys = jevKeys(this.env);
      if (!keys) return answer(503, "long_context_unavailable", "Jev is unavailable.");
      const started = Date.now();
      const results = await jevClassify(keys, evidence, job.labels, instructions, job.multi, meter, LONG_CONTEXT_BACKEND);
      const judged = results.map(result => job.multi
        ? { labels: job.labels.filter(label => result.scores[label] >= MULTI_THRESHOLD)
            .sort((a, b) => result.scores[b] - result.scores[a]), scores: result.scores,
            model: result.model }
        : { label: result.label, confidence: result.confidence, scores: result.scores,
            model: result.model });
      job.stats.finalMs += Date.now() - started;
      job.stats.finalCalls += meter.tokens.reduce((sum, row) => sum + row.calls, 0);
      job.stats.finalInputTokens = meter.tokens.some(row => row.inputTokens === null)
        ? null : meter.tokens.reduce((sum, row) => sum + row.inputTokens!, 0);
      joinUsage(job.tokens, meter.tokens);
      job.providerCostUsd = job.providerCostUsd === null || meter.tokens.some(row => row.inputTokens === null)
        ? null : job.providerCostUsd + meter.usd;
      const usageMeter = newMeter();
      usageMeter.longContext = job.stats;
      usageMeter.tokens = job.tokens;
      const charge = longContextCharge(job.stats.contextTokens);
      const modelsUsed = [...new Set(results.map(result => result.model))];
      const payload = { tier: "fast", model: modelsUsed[0] ?? null, modelsUsed,
        results: judged, usage: { ...classificationUsage(usageMeter), classifications: job.documents,
        escalated: 0 }, pricing: { ...classificationPricing(usageMeter, 0, job.stats.contextTokens),
        total_usd: Number(charge.nanodollars) / 1e9, billing_status: "settled" } };
      job.result = payload;
      job.status = "settling";
      await this.state.storage.put("job", job);
      return this.settle(job);
    } catch (error) {
      // A provider failure is retryable. The reservation remains held until retry,
      // cancellation or the expiry alarm; a failed final call never charges.
      return answer(503, "long_context_unavailable", "Final judgment is temporarily unavailable; retry before job expiry.");
    } finally { this.busy = false; }
  }

  private async settle(job: Job): Promise<Response> {
    const charge = longContextCharge(job.stats.contextTokens);
    const tokens = job.tokens.every(row => row.inputTokens !== null)
      ? job.tokens.reduce((sum, row) => sum + row.inputTokens!, 0) : null;
    await settleTokenReservation(this.env.APP_DB, job.reservationId, charge,
      { inputTokens: tokens, outputTokens: job.tokens.every(row => row.outputTokens !== null)
        ? job.tokens.reduce((sum, row) => sum + row.outputTokens!, 0) : null });
    job.status = "finished";
    await this.state.storage.put("job", job);
    for (let doc = 0; doc < job.documents; doc++)
      await this.state.storage.delete(`doc:${doc}`).catch(() => {});
    recordLongContext(this.env, job.stats, "success");
    this.recordAccount(job, "success", Number(charge.nanodollars) / 1e9);
    return Response.json(job.result, { headers: { "x-request-id": job.reservationId,
      "x-billing-status": "settled", "x-billed-input-tokens": String(job.stats.contextTokens),
      "x-usage-cost-usd": (Number(charge.nanodollars) / 1e9).toFixed(9) } });
  }

  private async fail(job: Job) {
    await refundTokenReservation(this.env.APP_DB, job.reservationId);
    job.status = "failed";
    await this.state.storage.put("job", job);
    for (let doc = 0; doc < job.documents; doc++) await this.state.storage.delete(`doc:${doc}`);
    recordLongContext(this.env, job.stats, "error");
    this.recordAccount(job, "error", 0);
  }

  private recordAccount(job: Job, status: "success" | "error", retailCostUsd: number) {
    const sum = (field: "inputTokens" | "outputTokens") => job.tokens.every(row => row[field] !== null)
      ? job.tokens.reduce((total, row) => total + row[field]!, 0) : null;
    writeAccountAnalytics(this.env, { accountId: job.accountId, keyId: job.agentId,
      requestId: job.reservationId, source: "API", tier: "fast", status,
      items: job.documents, inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"),
      cachedInputTokens: null, providerCostUsd: job.providerCostUsd, retailCostUsd,
      latencyMs: Date.now() - job.createdAt, escalations: 0,
      model: job.tokens.map(row => row.model).join(","), longContext: job.stats });
  }

  async alarm() {
    if (this.busy) { await this.state.storage.setAlarm(Date.now() + 300_000); return; }
    this.busy = true;
    try {
      const job = await this.state.storage.get<Job>("job");
      if (job?.status === "settling") {
        try { await this.settle(job); }
        catch { await this.state.storage.setAlarm(Date.now() + 300_000); }
        return;
      }
      if (job?.status === "open") {
        try { await refundTokenReservation(this.env.APP_DB, job.reservationId); }
        catch { await this.state.storage.setAlarm(Date.now() + 300_000); return; }
        recordLongContext(this.env, job.stats, "error");
        this.recordAccount(job, "error", 0);
      }
      await this.state.storage.deleteAll();
    } finally { this.busy = false; }
  }
}
