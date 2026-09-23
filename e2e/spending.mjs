import { Miniflare, convertV4MiniflareOptions, Response as WorkerResponse } from 'miniflare';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const report = { runtime: 'workerd + SQLite Durable Objects', upstream: 'deterministic HTTP provider fixtures; no live inference', results: [] };
await mkdir('captures', { recursive: true });

let calls = 0, lookups = 0, release, jevUnavailable = false;
let barrier = Promise.resolve();
const modules = (await readdir('dist/server', { recursive: true })).filter(p => p.endsWith('.js')).sort((a, b) => a === 'index.js' ? -1 : b === 'index.js' ? 1 : a.localeCompare(b)).map(p => ({ type: 'ESModule', path: `dist/server/${p}` }));
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "spending", modules, modulesRoot: 'dist/server', compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
  durableObjects: { FREE_BUDGET: { className: 'FreeBudget', useSQLite: true }, LIMITER: { className: 'RateLimiter', useSQLite: true } }, kvNamespaces: ['STATS'],
  bindings: { SPENDING_ENABLED: 'true', PRIVACY_SALT: 'private-e2e-fixture', SPUR_API_KEY: 'fixture', TYPESAFE_API_KEY: 'fixture', OPENROUTER_API_KEY: 'fixture', INTERNAL_API_KEY: 'private-fixture', FREE_LABEL_RPM: '200', FREE_LABEL_DAILY: '200' },
  outboundService: async request => {
    if (request.url.startsWith('https://api.spur.us/')) { lookups++; return WorkerResponse.json({}); }
    calls++; await barrier;
    const body = await request.json();
    if (jevUnavailable && request.url.includes('typesafe.ai')) return WorkerResponse.json({ detail: { error_type: 'insufficient_credits' } }, { status: 402 });
    if (request.url.includes('openrouter.ai')) return WorkerResponse.json({ model: body.model, usage: { cost: jevUnavailable ? 0.000001812 : 0.0007125, prompt_tokens: jevUnavailable ? 100 : 200, completion_tokens: jevUnavailable ? 1 : 150, prompt_tokens_details: { cached_tokens: 0 } }, choices: [{ message: { content: 'A' } }] });
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => { const keys = Object.keys(q.criteria); return [id, { choice: keys[0], confidence: 0.51, probabilities: Object.fromEntries(keys.map((k, i) => [k, i ? 0.49 : 0.51])) }]; }));
    return WorkerResponse.json({ model: 'jev-1.13.0', usage: { input_tokens: 100, output_tokens: 0 }, answers });
  },
}] }));
const request = (ip, body = { inputs: ['Invoice question'], labels: ['billing', 'support'] }, path = '/v1/classify', headers = {}) => mf.dispatchFetch(`https://classifier.dev${path}`, { method: 'POST', headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
try {
  await mf.ready;
  barrier = new Promise(r => { release = r; });
  const running = Array.from({ length: 12 }, (_, i) => request(i % 2 ? '2001:db8:1:2::1' : '2001:0db8:0001:0002::ffff'));
  for (let i = 0; i < 250 && calls < 4; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(calls, 4); release();
  const statuses = (await Promise.all(running)).map(r => r.status);
  assert.equal(statuses.filter(s => s === 200).length, 4);
  assert.equal(statuses.filter(s => s === 429).length, 8);
  assert.equal(lookups, 1);
  report.results.push({ name: 'concurrent IPv6 aliases', statuses, providerCalls: calls, spurLookups: lookups });
  const smart = await request('203.0.113.2', { inputs: ['Invoice question'], labels: ['billing', 'support'], tier: 'smart' });
  assert.equal(smart.status, 200); const result = await smart.json();
  assert.ok(JSON.stringify(result).includes('gemini'));
  report.results.push({ name: 'free smart escalation', status: smart.status, model: 'google/gemini-3.8-flash' });
  for (const path of ['/v1/chat', '//v1/chat', '/%76%31/skills', '/skills', '/v1/skills']) {
    assert.equal((await request('203.0.113.3', {}, path)).status, 404);
  }
  report.results.push({ name: 'private endpoints and encoded aliases', status: 'all 404 without internal credential' });
  const first = await request('203.0.113.4', undefined, undefined, { 'idempotency-key': 'one' });
  assert.equal(first.status, 200);
  const duplicate = await request('203.0.113.4', undefined, undefined, { 'idempotency-key': 'one' });
  assert.equal(duplicate.status, 409);
  report.results.push({ name: 'durable idempotency', first: first.status, duplicate: duplicate.status });
  const beforeLabels = calls;
  const labels = ['allow', 'deny'];
  const labelResponses = await Promise.all(Array.from({ length: 3 }, (_, index) => request(`203.0.113.${20 + index}`, {
    inputs: Array(100).fill('short text'), labels: index === 1 ? ['DENY', 'ALLOW'] : labels,
  })));
  const labelStatuses = labelResponses.map(response => response.status).sort();
  assert.deepEqual(labelStatuses, [200, 200, 429]);
  const labelDenied = labelResponses.find(response => response.status === 429);
  assert.equal((await labelDenied.json()).code, 'label_set_limit');
  assert.equal(labelDenied.headers.get('ratelimit-remaining'), '0');
  const afterLabels = calls;
  const dimensionDenied = await request('203.0.113.23', { items: ['text'], dimensions: { renamed: labels } });
  assert.equal(dimensionDenied.status, 429);
  const sdkDenied = await request('203.0.113.24', { state: 'text', questions: { renamed: { type: 'choice', criteria: { allow: null, deny: null } } } }, '/v1/systemone');
  assert.equal(sdkDenied.status, 429);
  assert.equal(calls, afterLabels);
  assert.equal((await request('203.0.113.25', { input: 'text', labels: ['independent', 'other'] })).status, 200);
  const registry = await mf.getKVNamespace('STATS');
  let storedLabels;
  for (let attempt = 0; attempt < 50 && !storedLabels; attempt++) {
    const entries = await registry.list({ prefix: 'cls:' });
    for (const key of entries.keys) {
      const record = await registry.get(key.name, 'json');
      if (record?.labels?.join(',') === 'allow,deny') storedLabels = record;
    }
    if (!storedLabels) await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.deepEqual(storedLabels?.labels, labels);
  assert.equal(JSON.stringify(storedLabels).includes('short text'), false);
  assert.equal(JSON.stringify(storedLabels).includes('203.0.113'), false);
  report.results.push({ name: 'global label allowance across concurrent IPs, dimensions and SDK', statuses: labelStatuses,
    decisionsAccepted: 200, providerCalls: afterLabels - beforeLabels, dimensionStatus: dimensionDenied.status, sdkStatus: sdkDenied.status, registry: storedLabels });
  jevUnavailable = true;
  const recovered = await request('203.0.113.5', { inputs: Array(119).fill('Invoice'), labels: ['billing', 'support'] });
  assert.equal(recovered.status, 200);
  const recoveredBody = await recovered.json();
  assert.equal(recoveredBody.results.length, 119);
  report.results.push({ name: '119-item batch during primary outage', status: recovered.status, results: recoveredBody.results.length });
  await writeFile('captures/spending-e2e.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await mf.dispose(); }
