import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Miniflare, convertV4MiniflareOptions, Response as WorkerResponse } from 'miniflare';

// Failure contract: no implicit consent or truthy strings; shared/private calls
// use the same counters; model failures remain observable; no identity, secrets,
// or executable markup in storage/admin; unavailable storage cannot fake success.
const report = { runtime: 'built Worker + workerd + real SQLite quotas and R2; deterministic provider', results: [] };
await mkdir('captures', { recursive: true });
const modules = (await readdir('dist/server', { recursive: true })).filter(p => /\.(js|wasm)$/.test(p))
  .sort((a, b) => a === 'index.js' ? -1 : b === 'index.js' ? 1 : a.localeCompare(b))
  .map(p => ({ type: p.endsWith('.wasm') ? 'CompiledWasm' : 'ESModule', path: `dist/server/${p}` }));
let providerCalls = 0, failProvider = false;
const make = (storage = true, extraBindings = {}) => new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'training', modules,
  modulesRoot: 'dist/server', compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
  durableObjects: { LIMITER: { className: 'RateLimiter', useSQLite: true }, QUOTAS: { className: 'QuotaCoordinator', useSQLite: true } },
  kvNamespaces: ['STATS'], r2Buckets: storage ? ['TRAINING_DATA'] : [],
  bindings: { TYPESAFE_API_KEY: 'fixture', BEAM_API_KEY: 'fixture', LAYA_ENABLED: 'true',
    QUOTA_COORDINATOR_ENABLED: 'true', PRIVACY_SALT: 'private-fixture', AI_GATEWAY_DISABLED: 'true',
    ADMIN_PASSWORD: 'admin-fixture', ADMIN_SIGNING_KEY: 'private-admin-fixture', ...extraBindings },
  outboundService: async request => {
    providerCalls++;
    if (failProvider) return WorkerResponse.json({ detail: { error_type: 'upstream_unavailable' } }, { status: 503 });
    assert.equal(request.headers.get('x-classifier-share-data'), null, 'our opt-in header must not reach model providers');
    assert.equal(new URL(request.url).searchParams.has('share_data'), false);
    const body = await request.json();
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => {
      if (q.type === 'noul') return [id, { noul: .99 }];
      const labels = Object.keys(q.criteria ?? { yes: null, no: null });
      return [id, { choice: labels[0], confidence: .99, probabilities: Object.fromEntries(labels.map((l, i) => [l, i ? .01 : .99])) }];
    }));
    return WorkerResponse.json({ model: 'jev-1.13.0', usage: { input_tokens: 100, output_tokens: 0 }, answers });
  },
}] }));
const mf = make();
const send = (body, ip = '203.0.113.1', extra = {}, path = '/v1/classify') => mf.dispatchFetch(`https://classifier.dev${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...extra }, body: JSON.stringify(body),
});
const base = { input: 'A useful example', labels: ['useful', 'irrelevant'] };
try {
  const bucket = await mf.getR2Bucket('TRAINING_DATA');
  for (const consent of [undefined, false]) {
    const response = await send({ ...base, ...(consent === undefined ? {} : { share_data: consent }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('ratelimit-limit'), '3000');
  }
  assert.equal((await bucket.list()).objects.length, 0);
  for (const consent of ['true', 'false', 1, null, {}, []]) {
    const response = await send({ ...base, share_data: consent });
    assert.equal(response.status, 400, `invalid consent ${JSON.stringify(consent)}`);
  }
  assert.equal((await bucket.list()).objects.length, 0);
  assert.equal((await send({ ...base, share_data: false }, '203.0.113.1', { 'x-classifier-share-data': 'true' })).status, 400);
  report.results.push({ name: 'default and false store nothing; invalid consent rejected', passed: true });
  const shared = await send({ ...base, input: 'Contact alice@example.com with Bearer secret-token or sk_examplesecret123. <script>alert(1)</script>',
    instructions: 'Route this message', share_data: true, ignored_secret: 'not a task field' });
  assert.equal(shared.status, 200, await shared.clone().text());
  assert.equal(shared.headers.get('ratelimit-limit'), '6000');
  assert.equal(shared.headers.get('ratelimit-policy'), '6000;w=60, 40000;w=86400');
  assert.equal(shared.headers.get('x-classifier-data-sharing'), 'saved');
  const objects = (await bucket.list()).objects;
  assert.equal(objects.length, 1);
  const stored = await (await bucket.get(objects[0].key)).json();
  assert.equal(stored.consent.version, '2026-10-04');
  assert.equal(stored.request.instructions, 'Route this message');
  assert.equal(stored.response.results[0].label, 'useful');
  assert.equal(stored.status, 200);
  assert.ok(stored.usage);
  const encoded = JSON.stringify(stored);
  assert.doesNotMatch(encoded, /alice@example\.com|secret-token|sk_examplesecret123|203\.0\.113|not a task field/);
  report.results.push({ name: 'full opted-in task, results and provenance saved with double quotas and credential redaction', record: stored });
  // Same owner has already spent three decisions: toggling consent cannot reset it.
  const privateAgain = await send(base);
  assert.equal(privateAgain.headers.get('ratelimit-remaining'), '2996');
  for (let i = 0; i < 3; i++) assert.equal((await send({ inputs: Array(1000).fill('example'), labels: base.labels }, '203.0.113.2')).status, 200);
  const denied = await send(base, '203.0.113.2');
  assert.equal(denied.status, 429);
  assert.match((await denied.json()).error, /share_data.*true/);
  const bonus = await send({ ...base, share_data: true }, '203.0.113.2');
  assert.equal(bonus.status, 200);
  assert.equal(bonus.headers.get('ratelimit-remaining'), '2999');
  report.results.push({ name: 'real quota exhaustion offers explicit opt-in; bonus reuses spent quota', passed: true });
  const dimensions = await send({ items: ['A useful example'], dimensions: { usefulness: base.labels }, share_data: true });
  assert.equal(dimensions.status, 200, await dimensions.clone().text());
  const multi = await send({ ...base, multi: true, share_data: true });
  assert.equal(multi.status, 200);
  const get = await mf.dispatchFetch('https://classifier.dev/useful,irrelevant/example?verbose=1&share_data=true', { headers: { 'cf-connecting-ip': '203.0.113.3' } });
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('x-classifier-data-sharing'), 'saved');
  const sdk = await send({ state: 'Example', questions: { category: { type: 'choice', criteria: { useful: null, irrelevant: null } } } }, '203.0.113.4', { 'x-classifier-share-data': 'true' }, '/v1/systemone');
  assert.equal(sdk.status, 200, await sdk.clone().text());
  assert.equal(sdk.headers.get('ratelimit-limit'), '6000');
  assert.equal(sdk.headers.get('x-classifier-data-sharing'), 'saved');
  const laya = await send({ ...base, model: 'laya', share_data: true }, '203.0.113.5');
  assert.equal(laya.status, 200, await laya.clone().text());
  assert.equal(laya.headers.get('ratelimit-limit'), '120');
  const mcp = await send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'classify_texts', arguments: { inputs: ['MCP example'], labels: base.labels, share_data: true } } }, '203.0.113.6', {}, '/mcp');
  const rpc = await mcp.json();
  assert.ok(!rpc.error && !rpc.result.isError, JSON.stringify(rpc));
  assert.equal(rpc.result.structuredContent.data_sharing, 'saved');
  assert.equal((await bucket.list()).objects.length, 8);
  report.results.push({ name: 'dimensions, multi-label, GET, SDK, Laya and MCP preserve consent and persist', passed: true });
  failProvider = true;
  const failure = await send({ ...base, model: 'laya', share_data: true }, '203.0.113.20');
  failProvider = false;
  assert.equal(failure.status, 503);
  assert.equal(failure.headers.get('x-classifier-data-sharing'), 'saved');
  const failures = await Promise.all((await bucket.list()).objects.map(async object => (await bucket.get(object.key)).json()));
  assert.ok(failures.some(record => record.status === 503 && record.response.code === 'laya_unavailable'));
  report.results.push({ name: 'admitted model failures retain their actual status and error code', passed: true });
  const unauthenticated = await mf.dispatchFetch('https://classifier.dev/admin?view=training');
  assert.equal(unauthenticated.status, 401);
  const login = await mf.dispatchFetch('https://classifier.dev/admin', { method: 'POST', redirect: 'manual',
    headers: { origin: 'https://classifier.dev', 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=admin-fixture' });
  assert.equal(login.status, 302);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const admin = path => mf.dispatchFetch(`https://classifier.dev/admin?view=training${path}`, { headers: { cookie } });
  const list = await admin('');
  assert.equal(list.status, 200);
  assert.match(await list.text(), /Shared training data/);
  const detail = await admin(`&key=${encodeURIComponent(objects[0].key)}`);
  const html = await detail.text();
  assert.equal(detail.status, 200);
  assert.match(html, /&lt;script&gt;alert/);
  assert.doesNotMatch(html, /<script>alert|alice@example\.com/);
  assert.match(detail.headers.get('cache-control'), /private/);
  const download = await admin(`&key=${encodeURIComponent(objects[0].key)}&format=json`);
  assert.deepEqual(await download.json(), stored);
  assert.equal((await admin('&key=other-secret')).status, 400);
  report.results.push({ name: 'authenticated list, escaped full detail and JSON export; no arbitrary object reads', passed: true });
  const labelLimits = make(true, { FREE_LABEL_RPM: '2', FREE_LABEL_DAILY: '3' });
  try {
    const labelRequest = share => labelLimits.dispatchFetch('https://classifier.dev/v1/classify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, share_data: share }) });
    assert.equal((await labelRequest(false)).status, 200);
    assert.equal((await labelRequest(false)).status, 200);
    assert.equal((await labelRequest(false)).status, 429);
    assert.equal((await labelRequest(true)).status, 200);
    assert.equal((await labelRequest(true)).status, 200);
    const exhausted = await labelRequest(true);
    assert.equal(exhausted.status, 429);
    assert.equal(exhausted.headers.get('ratelimit-policy'), '4;w=60, 6;w=86400');
  } finally { await labelLimits.dispose(); }
  report.results.push({ name: 'public label quotas double without resetting or escaping the shared counter', passed: true });
  const quota = await mf.getDurableObjectNamespace('LIMITER', 'training');
  await quota.get(quota.idFromName('fast:203.0.113.21')).fetch('https://limiter/?limit=100000&daily=40000&cost=40000');
  const dailyDenied = await send({ ...base, share_data: true }, '203.0.113.21');
  assert.equal(dailyDenied.status, 429);
  assert.equal((await dailyDenied.json()).code, 'rate_limit_day');
  report.results.push({ name: 'shared requests enforce the doubled daily ceiling', passed: true });
  const missing = make(false);
  try {
    const response = await missing.dispatchFetch('https://classifier.dev/v1/classify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, share_data: true }) });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /sharing.*unavailable/i);
  } finally { await missing.dispose(); }
  report.results.push({ name: 'missing bucket rejects opted-in collection explicitly', passed: true });
  const broken = make(false, { TRAINING_DATA: {} });
  try {
    const response = await broken.dispatchFetch('https://classifier.dev/v1/classify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, share_data: true }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-classifier-data-sharing'), 'failed');
    assert.equal((await response.json()).results[0].label, 'useful');
  } finally { await broken.dispose(); }
  report.results.push({ name: 'unusable storage binding reports failed collection without losing inference', passed: true });
  // Pagination uses real R2, including records arriving between page requests.
  for (let i = 0; i < 26; i++) await bucket.put(`requests/9999999999999-${String(i).padStart(8, '0')}-0000-4000-8000-000000000000.json`, JSON.stringify(stored), { customMetadata: { created: stored.created_at, endpoint: 'classify', status: '200', items: '1', preview: btoa(`Pagination example ${i}`) } });
  const pageOne = await (await admin('')).text();
  const next = pageOne.match(/rel="next" href="([^"]+)"/)?.[1];
  assert.ok(next);
  const pageTwo = await mf.dispatchFetch(`https://classifier.dev${next.replaceAll('&amp;', '&')}`, { headers: { cookie } });
  assert.equal(pageTwo.status, 200);
  assert.match(await pageTwo.text(), /Pagination example 25/);
  report.results.push({ name: 'paginated R2 browsing reaches older contributions', passed: true });
  const local = createServer(async (request, response) => {
    try {
      if (request.url.startsWith('/admin-assets/')) {
        response.setHeader('content-type', request.url.endsWith('.css') ? 'text/css' : 'text/javascript');
        response.end(await readFile('public' + request.url)); return;
      }
      const body = []; for await (const chunk of request) body.push(chunk);
      const upstream = await mf.dispatchFetch('https://classifier.dev' + request.url, { method: request.method,
        headers: { ...request.headers, cookie, 'cf-connecting-ip': '203.0.113.22' }, ...(body.length ? { body: Buffer.concat(body) } : {}) });
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${local.address().port}`;
  const exec = promisify(execFile);
  try {
    const beforeCli = (await bucket.list()).objects.length;
    await exec(process.execPath, ['cli/classify.js', 'useful,irrelevant', 'CLI contribution', '--share-data', '--json'], {
      env: { ...process.env, CLASSIFY_ENDPOINT: address + '/v1/classify', CLASSIFY_NO_UPDATE_CHECK: '1', CLASSIFY_API_KEY: '', CLASSIFIER_API_KEY: '' },
    });
    assert.equal((await bucket.list()).objects.length, beforeCli + 1);
    report.results.push({ name: 'CLI --share-data reaches the real Worker and R2', passed: true });
    if (process.argv.includes('--browser')) {
      const browser = async (...args) => (await exec('agent-browser', ['--session', 'training-data-e2e', ...args])).stdout;
      try {
        await browser('open', address + '/admin?view=training');
        await browser('set', 'viewport', '1366', '900');
        await browser('wait', '--text', 'Shared training data');
        await browser('screenshot', 'captures/training-list-desktop.png');
        await browser('set', 'viewport', '390', '844');
        await browser('screenshot', 'captures/training-list-mobile.png');
        assert.equal(JSON.parse(await browser('eval', 'document.documentElement.scrollWidth <= innerWidth')), true);
        await browser('open', address + '/admin?view=training&key=' + encodeURIComponent(objects[0].key));
        await browser('wait', '--text', 'Request and result');
        await browser('screenshot', 'captures/training-detail-mobile.png');
        assert.equal(JSON.parse(await browser('eval', 'document.documentElement.scrollWidth <= innerWidth')), true);
        await browser('set', 'viewport', '1366', '900');
        await browser('screenshot', 'captures/training-detail-desktop.png');
        await browser('download', 'a[href*="format=json"]', 'captures/training-download.json');
        assert.deepEqual(JSON.parse(await readFile('captures/training-download.json', 'utf8')), stored);
        report.results.push({ name: 'desktop/mobile admin list, record detail and browser download', passed: true });
      } finally { await browser('close'); }
    }
  } finally { await new Promise(resolve => local.close(resolve)); }
  report.providerCalls = providerCalls;
} finally {
  await mf.dispose();
  await writeFile('captures/training-data-e2e.json', JSON.stringify(report, null, 2));
}
console.log(`${report.results.length} training-data scenarios passed; captures/training-data-e2e.json`);
