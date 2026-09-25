import { Miniflare, convertV4MiniflareOptions, Response as WorkerResponse } from 'miniflare';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const report = { runtime: 'workerd + SQLite Durable Objects', upstream: 'deterministic HTTP provider fixtures; no live inference', results: [] };
await mkdir('captures', { recursive: true });

let calls = 0, lookups = 0, release, jevUnavailable = false, expensiveSmart = false;
let barrier = Promise.resolve();
const modules = (await readdir('dist/server', { recursive: true })).filter(p => /\.(js|wasm)$/.test(p)).sort((a, b) => a === 'index.js' ? -1 : b === 'index.js' ? 1 : a.localeCompare(b)).map(p => ({ type: p.endsWith('.wasm') ? 'CompiledWasm' : 'ESModule', path: `dist/server/${p}` }));
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "spending", modules, modulesRoot: 'dist/server', compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
  durableObjects: { FREE_BUDGET: { className: 'FreeBudget', useSQLite: true }, LIMITER: { className: 'RateLimiter', useSQLite: true } }, kvNamespaces: ['STATS'],
  bindings: { SPENDING_ENABLED: 'true', PRIVACY_SALT: 'private-e2e-fixture', SPUR_API_KEY: 'fixture', TYPESAFE_API_KEY: 'fixture', OPENROUTER_API_KEY: 'fixture', INTERNAL_API_KEY: 'private-fixture', FREE_LABEL_RPM: '200', FREE_LABEL_DAILY: '200', AGENT_API_KEY: 'operator-fixture', ENTERPRISE_API_KEY: 'enterprise-fixture', OPERATOR_DAILY_USD: '0.010001', ADMIN_PASSWORD: 'admin-fixture', ADMIN_SIGNING_KEY: 'private-admin-fixture' },
  outboundService: async request => {
    if (request.url.startsWith('https://api.spur.us/')) { lookups++; return WorkerResponse.json({}); }
    calls++; await barrier;
    const body = await request.json();
    if (jevUnavailable && request.url.includes('typesafe.ai')) return WorkerResponse.json({ detail: { error_type: 'insufficient_credits' } }, { status: 402 });
    if (request.url.includes('openrouter.ai')) return WorkerResponse.json({ model: body.model, usage: { cost: expensiveSmart ? 0.0072 : jevUnavailable ? 0.000001812 : 0.0007125, prompt_tokens: jevUnavailable ? 100 : 200, completion_tokens: expensiveSmart ? 1900 : jevUnavailable ? 1 : 150, prompt_tokens_details: { cached_tokens: 0 } }, choices: [{ message: { content: 'A' } }] });
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => { const keys = Object.keys(q.criteria); return [id, { choice: keys[0], confidence: 0.51, probabilities: Object.fromEntries(keys.map((k, i) => [k, i ? 0.49 : 0.51])) }]; }));
    return WorkerResponse.json({ model: 'jev-1.13.0', usage: { input_tokens: 100, output_tokens: 0 }, answers });
  },
}] }));
const request = (ip, body = { inputs: ['Invoice question'], labels: ['billing', 'support'] }, path = '/v1/classify', headers = {}) => mf.dispatchFetch(`https://classifier.dev${path}`, { method: 'POST', headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
try {
  await mf.ready;
  const adminUrl = 'https://classifier.dev/admin?view=labels';
  const unauthenticated = await mf.dispatchFetch(adminUrl);
  assert.equal(unauthenticated.status, 401);
  const login = await mf.dispatchFetch('https://classifier.dev/admin', { method: 'POST', redirect: 'manual',
    headers: { origin: 'https://classifier.dev', 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=admin-fixture' });
  assert.equal(login.status, 302);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const adminGet = url => mf.dispatchFetch(url, { headers: { cookie } });
  const empty = await adminGet(adminUrl);
  assert.equal(empty.status, 200);
  assert.match(await empty.text(), /No label sets collected yet/);
  const labelStore = await mf.getKVNamespace('STATS');
  for (let i = 0; i < 53; i++) {
    const fingerprint = `ls_${i.toString(16).padStart(16, '0')}`;
    await labelStore.put(`cls:${fingerprint}`, JSON.stringify({
      labels: i === 0 ? ['<script>alert("unsafe")</script>', 'safe & sound'] : [`category ${i}`, 'billing', 'support'], firstSeen: '2026-09-23T00:00:00.000Z',
    }));
    await labelStore.put(`clsn:${fingerprint}`, '1');
  }
  await labelStore.put('cls:ls_legacy', '2026-09-01T00:00:00.000Z');
  await labelStore.put('cls:ls_malformed', '{broken');
  await labelStore.put('unrelated-secret', 'must not appear');
  await labelStore.put('cls:obsolete-raw-key', '2026-09-01T00:00:00.000Z');
  let next = adminUrl;
  const seen = new Set();
  const pageSizes = [];
  while (next) {
    const response = await adminGet(next);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /private/);
    const html = await response.text();
    assert.match(html, /All label sets/);
    assert.doesNotMatch(html, /<script>alert|must not appear|obsolete-raw-key/);
    const ids = [...html.matchAll(/data-classifier="([^"]+)"/g)].map(match => match[1]);
    pageSizes.push(ids.length);
    for (const id of ids) { assert.ok(!seen.has(id), 'no duplicate registry rows'); seen.add(id); }
    if (pageSizes.length === 1) {
      assert.match(html, /&lt;script&gt;alert/);
      assert.match(html, /safe &amp; sound/);
      assert.match(html, /category 49/);
    } else assert.match(html, /category 52/);
    assert.doesNotMatch(html, /data-classifier="ls_(legacy|malformed)"/);
    const href = html.match(/href="([^"]+)"[^>]*rel="next"/)?.[1];
    next = href ? new URL(href.replaceAll('&amp;', '&'), adminUrl).href : null;
    assert.ok(pageSizes.length <= 2, 'pagination must finish');
  }
  assert.deepEqual(pageSizes, [50, 3]);
  assert.equal(seen.size, 53);
  const refused = await mf.dispatchFetch(adminUrl);
  assert.equal(refused.status, 401);
  assert.doesNotMatch(await refused.text(), /category 49|data-classifier/);
  assert.equal((await adminGet(`${adminUrl}&cursor=${'x'.repeat(2049)}`)).status, 400);
  report.results.push({ name: 'authenticated full label registry', unauthenticated: 401, empty: 200, pages: pageSizes,
    uniqueLabelSets: seen.size, escapedLabels: true, legacyAndMalformedRecords: 'excluded from named catalog' });
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
  const longSmartBody = { inputs: ['Invoice question '.repeat(380)], labels: ['billing', 'support'], tier: 'smart' };
  const longSmart = await request('203.0.113.6', longSmartBody);
  assert.equal(longSmart.status, 200, await longSmart.text());
  report.results.push({ name: 'free smart request beyond former JSON cutoff', bodyBytes: Buffer.byteLength(JSON.stringify(longSmartBody)), status: longSmart.status });
  const smartGetUrl = new URL('https://classifier.dev/');
  smartGetUrl.searchParams.set('labels', 'billing,support');
  smartGetUrl.searchParams.set('text', longSmartBody.inputs[0]);
  smartGetUrl.searchParams.set('tier', 'SMART');
  const smartGet = await mf.dispatchFetch(smartGetUrl, { headers: { 'cf-connecting-ip': '203.0.113.8', accept: 'application/json' } });
  assert.equal(smartGet.status, 200, await smartGet.clone().text());
  const smartGetBody = await smartGet.json();
  assert.equal(smartGetBody.tier, 'smart');
  assert.equal(smartGetBody.escalated, true);
  report.results.push({ name: 'free smart GET uses the same provider ceiling', status: smartGet.status });
  expensiveSmart = true;
  const partial = await request('203.0.113.7', { inputs: Array(20).fill('Invoice question'), labels: ['billing', 'support'], tier: 'smart' });
  const partialBody = await partial.json();
  assert.equal(partial.status, 200, JSON.stringify(partialBody));
  assert.equal(partialBody.results.length, 20);
  assert.ok(partialBody.usage.escalated > 0);
  assert.ok(partialBody.usage.escalation_failed > 0);
  assert.equal(partialBody.usage.escalated + partialBody.usage.escalation_failed, 20);
  assert.equal(partialBody.results.filter(result => result.confidence !== null).length, partialBody.usage.escalation_failed);
  expensiveSmart = false;
  report.results.push({ name: 'smart reviews stop at provider ceiling and retain fast answers', status: partial.status,
    escalated: partialBody.usage.escalated, escalationFailed: partialBody.usage.escalation_failed });
  for (const path of ['/%76%31/skills', '/skills', '/v1/skills']) {
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
      let record;
      try { record = JSON.parse(await registry.get(key.name)); } catch { continue; }
      if (record?.labels?.join(',') === 'allow,deny') storedLabels = record;
    }
    if (!storedLabels) await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.deepEqual(storedLabels?.labels, labels);
  assert.equal(JSON.stringify(storedLabels).includes('short text'), false);
  assert.equal(JSON.stringify(storedLabels).includes('203.0.113'), false);
  const catalog = await registry.list({ prefix: 'clsn:' });
  assert.ok(catalog.keys.length > 53, 'successful classifications enter the named catalog');
  report.results.push({ name: 'global label allowance across concurrent IPs, dimensions and SDK', statuses: labelStatuses,
    decisionsAccepted: 200, providerCalls: afterLabels - beforeLabels, dimensionStatus: dimensionDenied.status, sdkStatus: sdkDenied.status, registry: storedLabels });
  const budgets = await mf.getDurableObjectNamespace('FREE_BUDGET', 'spending');
  const publicBudget = budgets.get(budgets.idFromName('free-spending'));
  for (const [tier, amount, ip] of [['fast', 10_000_000, '203.0.113.90'], ['smart', 100_000_000, '203.0.113.91']]) {
    const reservation = await publicBudget.fetch('https://budget/reserve', { method: 'POST', body: JSON.stringify({ ip, tier }) });
    assert.equal(reservation.status, 200);
    const hold = await reservation.json();
    assert.equal(hold.amount, amount);
    assert.equal((await publicBudget.fetch('https://budget/settle', { method: 'POST', body: JSON.stringify({ id: hold.id, used: 0 }) })).status, 200);
  }
  report.results.push({ name: 'free request provider ceilings', fastUsd: 0.01, smartUsd: 0.10 });
  for (const [tier, count] of [['smart', 4], ['fast', 5]]) {
    for (let i = 0; i < count; i++) {
      const reservation = await publicBudget.fetch('https://budget/reserve', { method: 'POST', body: JSON.stringify({ ip: '203.0.113.88', tier }) });
      assert.equal(reservation.status, 200);
      const hold = await reservation.json();
      assert.equal((await publicBudget.fetch('https://budget/settle', { method: 'POST', body: JSON.stringify({ id: hold.id, used: hold.amount }) })).status, 200);
    }
  }
  const remainingSmart = await request('203.0.113.88', longSmartBody);
  assert.equal(remainingSmart.status, 200, await remainingSmart.text());
  report.results.push({ name: 'remaining daily allowance funds a smaller smart reservation', spentBeforeUsd: 0.45, status: remainingSmart.status });
  for (let i = 0; i < 50; i++) {
    const reserved = await publicBudget.fetch('https://budget/reserve', { method: 'POST', body: JSON.stringify({ ip: '203.0.113.99' }) });
    assert.equal(reserved.status, 200);
    const hold = await reserved.json();
    assert.equal((await publicBudget.fetch('https://budget/settle', { method: 'POST', body: JSON.stringify({ id: hold.id, used: hold.amount }) })).status, 200);
  }
  const exhausted = await request('203.0.113.99');
  assert.equal(exhausted.status, 429);
  assert.equal((await exhausted.json()).code, 'free_ip_daily_budget');
  const operator = await request('203.0.113.99', undefined, undefined, { authorization: 'Bearer operator-fixture' });
  assert.equal(operator.status, 200, 'operator has its own allowance after anonymous exhaustion');
  await operator.arrayBuffer();
  await new Promise(r => setTimeout(r, 100));
  const operatorBudget = budgets.get(budgets.idFromName('operator-spending'));
  const operatorRemainder = await operatorBudget.fetch('https://budget/reserve', { method: 'POST', body: JSON.stringify({ ip: '203.0.113.99', operator: true }) });
  assert.equal(operatorRemainder.status, 200);
  const operatorHold = await operatorRemainder.json();
  assert.equal((await operatorBudget.fetch('https://budget/settle', { method: 'POST', body: JSON.stringify({ id: operatorHold.id, used: operatorHold.amount }) })).status, 200);
  const operatorExhausted = await request('203.0.113.100', undefined, undefined, { authorization: 'Bearer operator-fixture' });
  assert.equal(operatorExhausted.status, 429);
  assert.equal((await operatorExhausted.json()).code, 'operator_daily_budget');
  assert.equal((await request('203.0.113.101', undefined, undefined, { authorization: 'Bearer wrong-operator' })).status, 401);
  assert.equal((await request('203.0.113.99', undefined, undefined, { authorization: 'Bearer enterprise-fixture' })).status, 429);
  assert.equal((await request('203.0.113.102')).status, 200);
  report.results.push({ name: 'isolated bounded operator allowance', exhaustedAnonymous: 429, operator: 200, operatorDailyAcrossIPs: 429, invalidCredential: 401, enterpriseCannotUseOperatorBudget: 429, otherAnonymous: 200 });
  jevUnavailable = true;
  const recovered = await request('203.0.113.5', { inputs: Array(119).fill('Invoice'), labels: ['billing', 'support'] });
  assert.equal(recovered.status, 200);
  const recoveredBody = await recovered.json();
  assert.equal(recoveredBody.results.length, 119);
  report.results.push({ name: '119-item batch during primary outage', status: recovered.status, results: recoveredBody.results.length });
  await writeFile('captures/spending-e2e.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await mf.dispose(); }
