import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { countTokens } from 'gpt-tokenizer/encoding/cl100k_base';

// Opt-in paid smoke: real upload, alarms, Jev and settlement. Synthetic filler
// stresses document size, not classification accuracy. Never writes the key.
const key = process.env.CLASSIFIER_API_KEY ?? process.env.CLASSIFY_API_KEY;
assert.ok(key, 'Set CLASSIFIER_API_KEY to a funded workspace key.');
const base = process.env.CLASSIFIER_BASE_URL ?? 'https://classifier.dev';
const tokens = process.argv.includes('--full') ? 10_000_000 : 600_000;
const id = process.env.DOCUMENT_JOB_ID ?? randomUUID();
const headers = { authorization: `Bearer ${key}` };
const prefix = 'The agreement automatically renews for another year. No cancellation was sent. The remaining text is archival filler:';
const started = Date.now();
if (!process.env.DOCUMENT_JOB_ID) {
  let left = tokens - countTokens(prefix), phase = 0;
  const encoder = new TextEncoder();
  const body = new ReadableStream({ pull(controller) {
    if (phase++ === 0) controller.enqueue(encoder.encode(JSON.stringify({ labels: ['renewal', 'cancellation'],
      instructions: 'Classify the agreement outcome; archival filler is irrelevant.', input: prefix }).slice(0, -2)));
    else if (left) { const n = Math.min(32768, left); left -= n; controller.enqueue(encoder.encode(' x'.repeat(n))); }
    else { controller.enqueue(encoder.encode('"}')); controller.close(); }
  } });
  const response = await fetch(new URL('/v1/classify', base), { method: 'POST', duplex: 'half', body,
    headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': id }, signal: AbortSignal.timeout(300000) });
  const accepted = await response.json();
  console.log(JSON.stringify({ uploadStatus: response.status, ...accepted }));
  assert.equal(response.status, 202);
  assert.equal(accepted.context_tokens, tokens);
}
const url = new URL(`/v1/long-context/jobs/${id}/status`, base);
console.log(`Resume with DOCUMENT_JOB_ID=${id}`);
let previous = -1;
for (;;) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  const job = await response.json();
  if (job.processed_tokens !== previous) {
    previous = job.processed_tokens;
    console.log(JSON.stringify({ id, status: job.status, processedTokens: previous, tokens: job.context_tokens }));
  }
  if (job.status === 'finished' || job.status === 'failed') {
    await mkdir('captures', { recursive: true });
    await writeFile(`captures/whole-document-live-${id}.json`, JSON.stringify({ endpoint: base, synthetic: true,
      elapsedMs: Date.now() - started, job }, null, 2));
    assert.equal(job.status, 'finished', JSON.stringify(job.error));
    assert.equal(job.result.results[0].label, 'renewal');
    assert.equal(job.result.pricing.input_tokens, tokens);
    assert.equal(job.result.pricing.total_usd, tokens * 84 / 1e9);
    assert.equal(job.result.usage.long_context.screened_chunks, job.result.usage.long_context.chunks);
    console.log(JSON.stringify({ id, result: job.result }));
    break;
  }
  assert.ok(Date.now() - started < 3600000, `Still processing: resume ${id}`);
  await new Promise(resolve => setTimeout(resolve, 10000));
}
