import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.CLASSIFIER_BASE_URL ?? 'https://classifier.dev';
const key = process.env.CLASSIFIER_API_KEY;
assert.ok(key?.startsWith('classifier_agent_'), 'Set CLASSIFIER_API_KEY to a funded workspace key.');
const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
const report = { base, at: new Date().toISOString(), results: [] };
try {
  for (const [url, labels, include] of [
    ['https://example.com', ['documentation', 'news'], ['markdown', 'html']],
    ['https://www.paulgraham.com/avg.html', ['programming', 'cooking'], []],
  ]) {
    const idempotency = crypto.randomUUID();
    const body = JSON.stringify({ url, labels, include });
    const response = await fetch(`${base}/v1/classify`, { method: 'POST', headers: { ...headers, 'idempotency-key': idempotency }, body });
    const result = await response.json();
    report.results.push({ url, status: response.status, requestId: response.headers.get('x-request-id'), label: result.results?.[0]?.label,
      pricing: result.pricing, usage: result.usage, article: { url: result.article?.url, markdownLength: result.article?.markdown?.length, htmlLength: result.article?.html?.length } });
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.results[0].label, labels[0]);
    assert.equal(result.pricing.scrape_usd, 0.0022);
    assert.ok(result.pricing.total_usd >= 0.0022);
    assert.equal(result.article.url, url.endsWith('.com') ? `${url}/` : url);
    if (include.length) {
      assert.ok(result.article.markdown.includes('Example Domain'));
      assert.ok(result.article.html.includes('<'));
    } else {
      assert.equal(result.article.markdown, undefined);
      assert.equal(result.article.html, undefined);
    }
    const duplicate = await fetch(`${base}/v1/classify`, { method: 'POST', headers: { ...headers, 'idempotency-key': idempotency }, body });
    assert.equal(duplicate.status, 409, await duplicate.text());
  }
  const anonymous = await fetch(`${base}/v1/classify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com', labels: ['a', 'b'] }) });
  assert.equal(anonymous.status, 401, await anonymous.text());
  report.results.push({ name: 'anonymous scrape denied', status: 401 });
} finally {
  await mkdir('captures', { recursive: true });
  await writeFile(`captures/url-live-${new URL(base).hostname}.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
