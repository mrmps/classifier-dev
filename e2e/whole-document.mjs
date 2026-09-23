import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { Miniflare, convertV4MiniflareOptions, Response as WorkerResponse } from 'miniflare';
import { countTokens } from 'gpt-tokenizer/encoding/cl100k_base';

// Failure contract: one upload must not buffer the document, lose Unicode or
// escaped JSON, change token counts at transport boundaries, require client
// chunking/finish calls, double-charge retries, or lose work after a restart.
// Reject unfunded, malformed, empty and oversized inputs before inference;
// protect ownership and refund cancelled/no-evidence jobs. Real workerd, SQLite
// Durable Objects, alarms and PostgreSQL ledger; only upstream HTTP is a fixture.
const report = { runtime: 'built Worker + SQLite Durable Objects/alarms + PostgreSQL ledger', results: [] };
const pg = new PGlite();
for (const file of (await readdir('migrations/postgres')).filter(p => p.endsWith('.sql')).sort())
  await pg.exec(await readFile(`migrations/postgres/${file}`, 'utf8'));
const key = 'classifier_agent_whole_document_fixture';
const freeKey = 'classifier_agent_free_document_fixture';
for (const [id, token, paid] of [['whole', key, 500000], ['free', freeKey, 0]]) {
  await pg.query(`INSERT INTO app_accounts(id,email,name,balance,paid_balance,reset_at,created_at,period_start)
    VALUES($1,$2,'Fixture',500000,$3,$4,$5,$5)`, [id, `${id}@example.com`, paid,
    new Date(Date.now() + 30 * 86400000).toISOString(), new Date().toISOString()]);
  await pg.query(`INSERT INTO app_agents(id,account_id,name,client,status,credit_limit,token_hash,prefix,created_at)
    VALUES($1,$1,'Fixture','test','connected',500000,$2,'fixture',$3)`,
    [id, createHash('sha256').update(token).digest('hex'), new Date().toISOString()]);
}
let calls = 0, screenedCharacters = 0, mode = 'normal', failScreen = 0, finalEvidence = '';
let loseAdmission = false, loseRefund = false, staleAdmissionRead = false;
const modules = (await readdir('dist/server', { recursive: true })).filter(p => /\.(js|wasm)$/.test(p))
  .sort((a, b) => a === 'index.js' ? -1 : b === 'index.js' ? 1 : a.localeCompare(b))
  .map(p => ({ type: p.endsWith('.wasm') ? 'CompiledWasm' : 'ESModule', path: `dist/server/${p}` }));
const options = convertV4MiniflareOptions({ workers: [{ name: 'whole-document', modules, modulesRoot: 'dist/server',
  compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
  durableObjects: { LONG_CONTEXT_JOBS: { className: 'LongContextJob', useSQLite: true } }, kvNamespaces: ['STATS'],
  bindings: { DATABASE_URL: 'postgres://fixture:fixture@fixture.neon.tech/fixture', APP_ACCOUNTS_ENABLED: 'true',
    SPENDING_ENABLED: 'true', TYPESAFE_API_KEY: 'fixture', AI_GATEWAY_DISABLED: 'true' },
  outboundService: async request => {
    const body = await request.json();
    if (request.url.includes('neon.tech')) {
      if ((body.queries ?? [body]).some(q => q.query.includes('WITH admitted AS')))
        assert.equal(request.headers.get('neon-batch-isolation-level'), 'Serializable');
      const execute = async tx => {
        const results = [];
        for (const q of body.queries ?? [body]) {
          const r = await tx.query(q.query, q.params);
          results.push({ fields: r.fields, rowCount: r.affectedRows ?? r.rows.length,
            rows: r.rows.map(row => r.fields.map(field => {
              const value = row[field.name];
              return value === null ? null : typeof value === 'boolean' ? value ? 't' : 'f' : String(value);
            })) });
        }
        return results;
      };
      try {
        const results = await pg.transaction(execute);
        if (staleAdmissionRead && body.query?.startsWith('SELECT u.account_id,u.agent_id')) {
          staleAdmissionRead = false; results[0].rows = []; results[0].rowCount = 0;
        }
        if ((loseAdmission && (body.queries ?? [body]).some(q => q.query.includes('INSERT INTO app_usage'))) ||
          (loseRefund && body.query?.includes('refund_token_reservation'))) {
          loseAdmission = false; loseRefund = false;
          return WorkerResponse.json({ message: 'Fixture: response lost after commit' }, { status: 503 });
        }
        return WorkerResponse.json(body.queries ? { results } : results[0]);
      } catch (error) { return WorkerResponse.json({ message: error.message, code: error.code }, { status: 400 }); }
    }
    assert.ok(request.url.includes('typesafe.ai'), request.url);
    calls++;
    const screening = Object.values(body.questions).some(q => Object.hasOwn(q.criteria ?? {}, 'irrelevant'));
    if (screening && failScreen > 0) { failScreen--; return WorkerResponse.json({ detail: { error_type: 'invalid_request' } }, { status: 400 }); }
    if (screening && mode === 'slow') await new Promise(resolve => setTimeout(resolve, 200));
    if (screening) screenedCharacters += body.state.reduce((sum, state) => sum + state.text.length, 0);
    else finalEvidence = body.state.map(state => state.text).join('');
    return WorkerResponse.json({ model: 'jev-1.13.0', usage: { input_tokens: 1000, output_tokens: 0 },
      answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]) => {
        const state = body.state.find(state => state.id === id) ?? body.state[0];
        const labels = Object.keys(q.criteria);
        const choice = screening ? mode === 'none' ? 'irrelevant' : state.text.includes('DECISIVE') ? 'relevant' : 'irrelevant' : labels[0];
        return [id, { choice, confidence: 0.99,
          probabilities: Object.fromEntries(labels.map(label => [label, label === choice ? 0.99 : 0.005])) }];
      })) });
  },
}] });
const mf = new Miniflare(options);
const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json', prefer: 'respond-async' };
const upload = (body, extra = {}) => mf.dispatchFetch('https://classifier.dev/v1/classify', {
  method: 'POST', duplex: 'half', headers: { ...headers, ...extra }, body: typeof body === 'string' || body instanceof ReadableStream ? body : JSON.stringify(body),
});
async function waitForJob(url, failure = false) {
  for (let i = 0; i < 1800; i++) {
    const response = await mf.dispatchFetch(url, { headers });
    assert.equal(response.status, 200, await response.clone().text());
    const job = await response.json();
    if (job.status === 'finished') return job;
    if (failure && job.status === 'failed') return job;
    assert.notEqual(job.status, 'failed', JSON.stringify(job));
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Job did not finish within three minutes.');
}
try {
  await mf.ready;
  const text = 'DECISIVE START: This agreement renews.\n\n' + 'Meeting notes, café, 日本語 😀.\n\n'.repeat(6000) + 'DECISIVE END: Renewal is confirmed.';
  const payload = { input: text, labels: ['renewal', 'cancellation'], instructions: 'Does the agreement renew?' };
  const accepted = await upload(payload);
  assert.equal(accepted.status, 202, await accepted.clone().text());
  const job = await accepted.json();
  assert.ok(job.id && job.status_url);
  const done = await waitForJob(job.status_url);
  assert.equal(done.result.results[0].label, 'renewal');
  assert.equal(done.result.usage.long_context.context_tokens, countTokens(text));
  assert.equal(screenedCharacters, text.length);
  assert.ok(finalEvidence.includes('DECISIVE START') && finalEvidence.includes('DECISIVE END'));
  report.results.push({ name: 'one whole JSON document, automatic processing and exact token count', result: done.result });

  const repeatCalls = calls;
  const duplicate = await upload(payload, { 'idempotency-key': job.id });
  assert.equal(duplicate.status, 202);
  assert.equal((await duplicate.json()).id, job.id);
  assert.equal(calls, repeatCalls);
  assert.equal(Number((await pg.query('SELECT count(*) AS n FROM app_usage')).rows[0].n), 1);
  report.results.push({ name: 'retrying a lost upload response reuses one job and one charge' });

  const previousCalls = calls;
  const free = await upload(payload, { authorization: `Bearer ${freeKey}` });
  assert.equal(free.status, 402);
  for (const bad of ['{"input":"unfinished', '{"input":"a","input":"b","labels":["x","y"]}',
    JSON.stringify({ input: '', labels: ['x', 'y'] })]) {
    const response = await upload(bad);
    assert.equal(response.status, 400, await response.clone().text());
  }
  assert.equal(calls, previousCalls);
  const invalidUtf8 = await mf.dispatchFetch('https://classifier.dev/v1/classify?labels=a,b', {
    method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: new Uint8Array([0xff]),
  });
  assert.equal(invalidUtf8.status, 400);
  const hidden = await mf.dispatchFetch(job.status_url, { headers: { authorization: `Bearer ${freeKey}` } });
  assert.equal(hidden.status, 404);
  report.results.push({ name: 'free, malformed, duplicate, empty and cross-account requests rejected', providerCalls: 0 });

  const escapedText = 'DECISIVE: renewal. "Quoted" \\ \t café 😀 日本語\n'.repeat(4000);
  const escapedJson = JSON.stringify({ input: escapedText, labels: ['renewal', 'cancellation'] })
    .replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  let position = 0;
  const encoder = new TextEncoder();
  const fragmented = new ReadableStream({ pull(controller) {
    if (position === escapedJson.length) { controller.close(); return; }
    controller.enqueue(encoder.encode(escapedJson.slice(position, position + 997)));
    position = Math.min(escapedJson.length, position + 997);
  } });
  const escaped = await upload(fragmented);
  assert.equal(escaped.status, 202, await escaped.clone().text());
  const escapedDone = await waitForJob((await escaped.json()).status_url);
  assert.equal(escapedDone.result.pricing.input_tokens, countTokens(escapedText));
  report.results.push({ name: 'escaped Unicode and JSON across arbitrary transport boundaries', tokens: countTokens(escapedText) });

  const tail = 'DECISIVE renewal. ' + 'x '.repeat(37000) + ' \t'.repeat(4000);
  const tailResponse = await upload({ input: tail, labels: ['renewal', 'cancellation'] });
  assert.equal(tailResponse.status, 202);
  const tailDone = await waitForJob((await tailResponse.json()).status_url);
  assert.equal(tailDone.result.pricing.input_tokens, countTokens(tail));
  report.results.push({ name: 'whitespace-only internal tail retains exact original token count' });

  const recoveryId = randomUUID();
  const beforeHolds = Number((await pg.query('SELECT count(*) AS n FROM app_usage')).rows[0].n);
  const exactCredits = Math.ceil(countTokens(text) * 84 / 10000);
  await pg.query("UPDATE app_accounts SET balance=$1,paid_balance=$1 WHERE id='whole'", [exactCredits]);
  loseAdmission = true;
  const lost = await upload(payload, { 'idempotency-key': recoveryId });
  assert.equal(lost.status, 503);
  staleAdmissionRead = true;
  const recovered = await upload(payload, { 'idempotency-key': recoveryId });
  assert.equal(recovered.status, 202, await recovered.clone().text());
  await waitForJob((await recovered.json()).status_url);
  assert.equal(Number((await pg.query('SELECT count(*) AS n FROM app_usage')).rows[0].n), beforeHolds + 1);
  const recoveredBalance = Number((await pg.query("SELECT balance FROM app_accounts WHERE id='whole'")).rows[0].balance);
  assert.ok(recoveredBalance >= 0 && recoveredBalance <= 1, 'Only one debit; settlement may return one rounded credit.');
  await pg.query("UPDATE app_accounts SET balance=500000,paid_balance=500000 WHERE id='whole'");
  report.results.push({ name: 'lost reservation response and stale retry read debit once, even with only enough balance for one hold' });

  mode = 'slow';
  const cancelStart = calls;
  const cancelUpload = await upload(payload);
  assert.equal(cancelUpload.status, 202);
  const cancelJob = await cancelUpload.json();
  while (calls === cancelStart) await new Promise(resolve => setTimeout(resolve, 10));
  const cancellation = await mf.dispatchFetch(cancelJob.status_url.replace(/status$/, 'cancel'), { method: 'POST', headers });
  assert.ok([200, 202].includes(cancellation.status));
  const canceled = await waitForJob(cancelJob.status_url, true);
  assert.equal(canceled.status, 'failed');
  assert.match(canceled.error.message, /canceled/);
  assert.equal((await pg.query('SELECT status FROM app_usage ORDER BY created_at DESC LIMIT 1')).rows[0].status, 'refunded');
  mode = 'none';
  loseRefund = true;
  const emptyEvidence = await upload({ input: 'No meaningful evidence.', labels: ['renewal', 'cancellation'] });
  const emptyJob = await waitForJob((await emptyEvidence.json()).status_url, true);
  assert.equal(emptyJob.error.code, 'long_context_no_evidence');
  assert.equal((await pg.query('SELECT status FROM app_usage ORDER BY created_at DESC LIMIT 1')).rows[0].status, 'refunded');
  report.results.push({ name: 'cancellation and no evidence refund, including lost refund acknowledgement' });

  mode = 'normal'; failScreen = 1;
  const restart = await upload(payload);
  assert.equal(restart.status, 202);
  const restartJob = await restart.json();
  await mf.setOptions({ ...options, workers: options.workers.map(worker => ({ ...worker,
    config: { ...worker.config, env: { ...worker.config.env, RESTART_PROBE: { type: 'text', value: 'reloaded' } } } })) });
  const restarted = await waitForJob(restartJob.status_url);
  assert.equal(restarted.result.pricing.input_tokens, countTokens(text));
  report.results.push({ name: 'background job survives Worker reload and provider refusal', id: restarted.id });

  await mkdir('captures', { recursive: true });
  await writeFile('captures/document-fixture.txt', text);
  const cli = await promisify(execFile)(process.execPath, ['cli/classify.js', 'renewal,cancellation',
    '--document', 'captures/document-fixture.txt', '--json', '--endpoint', String(await mf.ready)],
    { env: { ...process.env, CLASSIFY_API_KEY: key, CLASSIFY_NO_UPDATE_CHECK: '1', CLASSIFY_NO_PROGRESS: '1' }, timeout: 30000 });
  const cliResult = JSON.parse(cli.stdout);
  assert.equal(cliResult.label, 'renewal');
  assert.equal(cliResult.usage.long_context.context_tokens, countTokens(text));
  report.results.push({ name: 'CLI streams one file and polls automatically', tokens: cliResult.usage.long_context.context_tokens });

  if (process.argv.includes('--full')) {
    // Exactly 10M tokens, sent as one 20MB JSON upload. No caller tokenization,
    // part calls or finish request. The HTTP stream uses ordinary 64KB frames.
    let remaining = 10_000_000 - countTokens('DECISIVE renewal.');
    const encoder = new TextEncoder();
    let phase = 0;
    const body = new ReadableStream({ pull(controller) {
      if (phase === 0) { controller.enqueue(encoder.encode('{"labels":["renewal","cancellation"],"input":"DECISIVE renewal.')); phase = 1; }
      else if (remaining) { const n = Math.min(32768, remaining); remaining -= n; controller.enqueue(encoder.encode(' x'.repeat(n))); }
      else { controller.enqueue(encoder.encode('"}')); controller.close(); }
    } });
    const started = Date.now();
    const response = await upload(body, { prefer: '' });
    assert.equal(response.status, 202, await response.clone().text());
    const pending = await response.json();
    const completed = await waitForJob(pending.status_url);
    assert.equal(completed.result.usage.long_context.context_tokens, 10_000_000);
    assert.equal(completed.result.pricing.total_usd, 0.84);
    assert.equal(completed.result.usage.long_context.screened_chunks, completed.result.usage.long_context.chunks);
    const ledger = await pg.query("SELECT status,actual_nano::text AS nano FROM app_usage ORDER BY created_at DESC LIMIT 1");
    assert.equal(ledger.rows[0].nano, '840000000');
    assert.equal(ledger.rows[0].status, 'completed');
    report.results.push({ name: '10M tokens in one streamed upload through real workerd and SQLite alarms',
      elapsedMs: Date.now() - started, usage: completed.result.usage, ledger: ledger.rows[0] });

    const beforeOversize = calls;
    let left = 10_000_001;
    const oversized = new ReadableStream({ pull(controller) {
      if (!left) { controller.close(); return; }
      const n = Math.min(32768, left); left -= n;
      controller.enqueue(encoder.encode(' x'.repeat(n)));
    } });
    const rejected = await mf.dispatchFetch('https://classifier.dev/v1/classify?labels=a,b', {
      method: 'POST', duplex: 'half', headers: { ...headers, 'content-type': 'text/plain' }, body: oversized,
    });
    assert.equal(rejected.status, 413, await rejected.clone().text());
    assert.equal(calls, beforeOversize);
    report.results.push({ name: '10M+1 tokens rejected before inference or reservation' });
  }
} finally {
  await mkdir('captures', { recursive: true });
  await writeFile('captures/whole-document.json', JSON.stringify(report, null, 2));
  await mf.dispose();
  await pg.close();
}
console.log(`${report.results.length} whole-document E2E scenarios passed; captures/whole-document.json`);
