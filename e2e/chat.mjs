import { Miniflare, convertV4MiniflareOptions, Response as WorkerResponse } from 'miniflare';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const report = { runtime: 'built Worker and real rate-limiter Durable Object', upstream: 'deterministic provider fixtures; no live inference', results: [] };
let modelCalls = 0, classifications = 0;
const modules = (await readdir('dist/server', { recursive: true })).filter(p => /\.(js|wasm)$/.test(p)).sort((a, b) => a === 'index.js' ? -1 : b === 'index.js' ? 1 : a.localeCompare(b)).map(p => ({ type: p.endsWith('.wasm') ? 'CompiledWasm' : 'ESModule', path: `dist/server/${p}` }));
const sse = delta => new WorkerResponse(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'chat', modules, modulesRoot: 'dist/server', compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
  durableObjects: { FREE_BUDGET: { className: 'FreeBudget', useSQLite: true }, LIMITER: { className: 'RateLimiter', useSQLite: true } }, kvNamespaces: ['STATS'],
  bindings: { SPENDING_ENABLED: 'true', PRIVACY_SALT: 'fixture', SPUR_API_KEY: 'fixture', TYPESAFE_API_KEY: 'fixture', OPENROUTER_API_KEY: 'fixture', ENTERPRISE_API_KEY: 'fixture-enterprise' },
  outboundService: async request => {
    if (request.url.startsWith('https://api.spur.us/')) return WorkerResponse.json({});
    const body = await request.json();
    if (request.url.includes('openrouter.ai')) {
      modelCalls++;
      const last = body.messages.at(-1);
      if (last.content === 'fail upstream') return new WorkerResponse('unavailable', { status: 503 });
      if (last.content === 'slow reply') await new Promise(resolve => setTimeout(resolve, 1000));
      if (last.role === 'user') return sse({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'classify_texts', arguments: JSON.stringify({ inputs: ['Please refund my invoice'], labels: ['billing', 'support'] }) } }] });
      assert.equal(last.role, 'tool');
      assert.match(last.content, /billing\t0.90/);
      return sse({ content: 'The message is billing (90% confidence).' });
    }
    assert.ok(request.url.includes('typesafe.ai'), `Unexpected upstream: ${request.url}`);
    classifications++;
    return WorkerResponse.json({ model: 'jev-1.13.0', usage: { input_tokens: 100, output_tokens: 0 }, answers: Object.fromEntries(Object.entries(body.questions).map(([id, question]) => {
      const keys = Object.keys(question.criteria);
      return [id, { choice: keys[0], confidence: 0.9, probabilities: { [keys[0]]: 0.9, [keys[1]]: 0.1 } }];
    })) });
  },
}] }));
const post = (messages, ip = '203.0.113.10', path = '/v1/chat') => mf.dispatchFetch(`https://classifier.dev${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ messages }),
});
const message = content => [{ role: 'user', content }];
const events = async response => (await response.text()).split('\n\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
try {
  await mf.ready;
  for (const path of ['/', '/chat', '/docs', '/benchmark']) {
    const response = await mf.dispatchFetch(`https://classifier.dev${path}`, { headers: { accept: 'text/html' } });
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, /data-chat-open/);
    assert.match(html, /id="chat" aria-label="Chat"/);
    if (path === '/chat') assert.match(html, /id="chat" aria-label="Chat">/);
    for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(script[1]));
  }
  report.results.push({ name: 'public chat entry points and executable scripts', status: 'passed' });
  assert.equal((await post([])).status, 400);
  assert.equal((await post(message('x'.repeat(8001)))).status, 400);
  assert.equal((await post(message('x'.repeat(1_000_001)))).status, 413);
  assert.equal(modelCalls, 0);
  const response = await post(message('Classify this refund request'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const turn = await events(response);
  assert.deepEqual(turn.map(event => event.t), ['tool', 'result', 'text', 'done']);
  assert.equal(turn[1].error, undefined);
  assert.match(turn[1].text, /billing/);
  assert.equal(classifications, 1);
  report.results.push({ name: 'anonymous streamed classification through MCP and provider', events: turn });
  for (let i = 1; i < 10; i++) {
    const next = await post(message('Classify another refund request'));
    assert.equal(next.status, 200);
    assert.equal((await events(next)).at(-1).t, 'done');
  }
  const callsBeforeLimit = modelCalls;
  const limited = await post(message('One too many'));
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(modelCalls, callsBeforeLimit);
  report.results.push({ name: 'ten turns per minute; rejected before provider call', status: limited.status });
  const failure = await events(await post(message('fail upstream'), '203.0.113.11'));
  assert.equal(failure.at(-1).t, 'error');
  for (const path of ['/skills', '/v1/skills', '/%76%31/skills', '/chat.md', '/chat/private']) assert.equal((await mf.dispatchFetch(`https://classifier.dev${path}`)).status, 404);
  report.results.push({ name: 'upstream error terminates stream; skills remain private', status: 'passed' });
  if (process.argv.includes('--browser')) {
    const run = promisify(execFile);
    const browser = async (...args) => (await run('agent-browser', ['--session', 'restore-chat-e2e', ...args])).stdout;
    const check = async condition => browser('eval', `if (!(${condition})) throw new Error('Browser assertion failed: ' + ${JSON.stringify(condition)}); true`);
    const capture = async path => {
      await browser('wait', '--fn', 'getComputedStyle(document.querySelector("#chat")).transform === "matrix(1, 0, 0, 1, 0, 0)"');
      await browser('eval', 'document.fonts.ready.then(() => true)');
      await browser('screenshot', path);
    };
    const url = String(await mf.ready);
    await browser('open', url);
    await browser('set', 'viewport', '1440', '1000');
    await browser('click', '.site-links [data-chat-open]');
    await check('!document.querySelector("#chat").hidden');
    await capture('captures/desktop-chat.png');
    await browser('fill', '#chat textarea', 'Classify: Please refund my invoice. Labels: billing, support.');
    await browser('press', 'Enter');
    await browser('wait', '--text', 'The message is billing (90% confidence).');
    await check('document.querySelector(".chat-tool .nm").textContent === "classify_texts"');
    await capture('captures/desktop-conversation.png');
    await browser('reload');
    await browser('wait', '--text', 'The message is billing (90% confidence).');
    await browser('press', 'Escape');
    await check('document.querySelector("#chat").hidden');
    await browser('press', 'Control+i');
    await check('!document.querySelector("#chat").hidden');
    await browser('open', new URL('/docs', url).href);
    await browser('wait', '--text', 'The message is billing (90% confidence).');
    await browser('click', '[data-chat-clear]');
    await check('document.querySelector(".chat-msgs").childElementCount === 0');
    await browser('fill', '#chat textarea', 'slow reply');
    await browser('press', 'Shift+Enter');
    await check('document.querySelector("#chat textarea").value.endsWith("\\n")');
    await browser('press', 'Enter');
    await browser('click', '.chat-send[aria-label="Stop"]');
    await browser('wait', '--fn', 'document.querySelector(".chat-send").getAttribute("aria-label") === "Send"');
    await browser('fill', '#chat textarea', 'fail upstream');
    await browser('press', 'Enter');
    await browser('wait', '--text', 'the assistant could not answer; try again');
    await browser('click', '[data-chat-close]');
    await browser('open', new URL('/chat', url).href);
    await check('!document.querySelector("#chat").hidden');
    await browser('click', '[data-chat-close]');
    await browser('open', url);
    await browser('set', 'viewport', '390', '844');
    await browser('press', 'Control+i');
    await capture('captures/mobile-chat.png');
    await check('document.querySelector("#chat").getBoundingClientRect().right <= innerWidth');
    await browser('click', '[data-chat-close]');
    await browser('click', '.site-menu summary');
    await browser('click', '.site-menu-links a[href="/chat"]');
    await check('!document.querySelector("#chat").hidden');
    await browser('close');
    report.results.push({ name: 'desktop/mobile chat, stream, persistence, clear, error, shortcut, mobile menu', status: 'passed', screenshots: ['desktop-chat.png', 'desktop-conversation.png', 'mobile-chat.png'] });
  }
} finally {
  await mkdir('captures', { recursive: true });
  await writeFile('captures/chat-e2e.json', JSON.stringify(report, null, 2));
  await mf.dispose();
}
console.log(`${report.results.length} chat E2E scenarios passed; captures/chat-e2e.json`);
