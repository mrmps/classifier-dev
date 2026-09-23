import { Miniflare, convertV4MiniflareOptions, Response as WorkerResponse } from 'miniflare';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const report = { runtime: 'built Worker in workerd', upstream: 'deterministic HTTP fixtures; no live inference', results: [] };
let missing = false;
const modules = (await readdir('dist/server', { recursive: true })).filter(p => /\.(js|wasm)$/.test(p)).sort((a, b) => a === 'index.js' ? -1 : b === 'index.js' ? 1 : a.localeCompare(b)).map(p => ({ type: p.endsWith('.wasm') ? 'CompiledWasm' : 'ESModule', path: `dist/server/${p}` }));
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'usage', modules, modulesRoot: 'dist/server', compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
  durableObjects: { FREE_BUDGET: { className: 'FreeBudget', useSQLite: true }, LIMITER: { className: 'RateLimiter', useSQLite: true } }, kvNamespaces: ['STATS'],
  bindings: { TYPESAFE_API_KEY: 'fixture', OPENROUTER_API_KEY: 'fixture', PRIVACY_SALT: 'fixture' },
  outboundService: async request => {
    const body = await request.json();
    if (request.url.includes('openrouter.ai')) return WorkerResponse.json({ model: body.model, usage: { cost: 0.0001, prompt_tokens: 200, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 50 } }, choices: [{ message: { content: 'A' } }] });
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => {
      if (q.type === 'noul') return [id, { noul: 0.9 }];
      const keys = Object.keys(q.criteria);
      return [id, { choice: keys[0], confidence: 0.51, probabilities: Object.fromEntries(keys.map((k, i) => [k, i ? 0.49 : 0.51])) }];
    }));
    return WorkerResponse.json({ model: 'jev-1.13.0', ...(missing ? {} : { usage: { input_tokens: 100, output_tokens: 5 } }), answers });
  },
}] }));
const send = (body, path = '/v1/classify', json = true) => mf.dispatchFetch(`https://classifier.dev${path}`, {
  ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.70', ...(json ? { accept: 'application/json' } : {}) },
});
try {
  await mf.ready;
  for (const [name, body, path] of [
    ['batch', { inputs: ['Invoice', 'Refund'], labels: ['billing', 'support'] }],
    ['dimensions', { items: ['Invoice'], dimensions: { team: ['billing', 'support'], priority: ['high', 'low'] } }],
    ['multi-label', { inputs: ['Invoice'], labels: ['billing', 'support'], multi: true }],
    ['GET JSON', null, '/billing,support/Invoice'],
    ['smart', { inputs: ['Invoice'], labels: ['billing', 'support'], tier: 'smart' }],
    ['unknown usage', { inputs: ['Invoice'], labels: ['billing', 'support'] }],
  ]) {
    missing = name === 'unknown usage';
    const response = await send(body, path);
    assert.equal(response.status, 200, await response.clone().text());
    const data = await response.json();
    const smart = name === 'smart';
    assert.equal(data.usage.input_tokens, missing ? null : smart ? 300 : 100);
    assert.equal(data.usage.output_tokens, missing ? null : smart ? 15 : 5);
    assert.equal(data.usage.total_tokens, missing ? null : smart ? 315 : 105);
    assert.equal(data.usage.models.length, smart ? 2 : 1);
    assert.equal(data.pricing.currency, 'USD');
    assert.equal(data.pricing.total_usd, 0);
    assert.equal(data.pricing.billing_status, 'not_billed');
    assert.equal(data.pricing.estimated_usd, missing ? null : smart ? 0.0020042 : 0.0000042);
    assert.equal(data.pricing.input_usd_per_million, 0.042);
    assert.equal(data.pricing.usd_per_escalation, 0.002);
    report.results.push({ name, response: data });
  }
  missing = false;
  const plain = await send(null, '/billing,support/Invoice', false);
  assert.equal(await plain.text(), 'billing\n');
  const invalid = await send({ inputs: [], labels: ['billing', 'support'] });
  assert.equal(invalid.status, 400);
  report.results.push({ name: 'plain text unchanged and invalid input rejected', status: 'passed' });
} finally {
  await mkdir('captures', { recursive: true });
  await writeFile('captures/usage-e2e.json', JSON.stringify(report, null, 2));
  await mf.dispose();
}
console.log(`${report.results.length} usage E2E scenarios passed; captures/usage-e2e.json`);
