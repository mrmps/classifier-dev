import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions, Response as WorkerResponse } from 'miniflare';

const live = process.argv.includes('--live');
const report = {
  runtime: live ? 'production MCP and live inference' : 'built Worker; deterministic inference fixture',
  limitations: 'Package and MCP verification does not prove installation in every host or directory approval.',
  results: [],
};
const read = path => readFile(path, 'utf8');
const json = async path => JSON.parse(await read(path));
const root = 'dist/plugins';
let mf;
let id = 0;

try {
  const portable = await json(`${root}/portable/classifier/plugin.json`);
  const codex = await json(`${root}/codex/classifier/.codex-plugin/plugin.json`);
  const claude = await json(`${root}/claude/classifier/.claude-plugin/plugin.json`);
  const muse = await json(`${root}/muse/classifier/.muse-plugin/plugin.json`);
  const gemini = await json(`${root}/gemini/classifier/gemini-extension.json`);
  for (const manifest of [codex, claude, muse, gemini]) {
    assert.equal(manifest.name, portable.name);
    assert.equal(manifest.version, portable.version);
  }
  assert.equal(portable.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(muse.schemaVersion, 1);
  assert.equal(muse.compat.manifestDir, '.muse-plugin');
  assert.deepEqual(muse.capabilities.skills, [{ id: 'bulk-classify', path: 'skills/bulk-classify/SKILL.md' }]);
  const skill = await read(`${root}/portable/classifier/skills/bulk-classify/SKILL.md`);
  assert.equal(skill, await read('src/SKILL.md'));
  for (const format of ['claude', 'codex', 'muse', 'gemini']) {
    assert.equal(await read(`${root}/${format}/classifier/skills/bulk-classify/SKILL.md`), skill);
  }
  assert.deepEqual((await readdir(`${root}/muse/classifier`)).sort(), ['.muse-plugin', 'skills']);
  assert.match(skill, /share_data: false/);
  const legacy = await json(`${root}/claude/classifier/.mcp.json`);
  const mcp = await json(`${root}/portable/classifier/mcp.json`);
  assert.deepEqual(await json(`${root}/codex/classifier/.mcp.json`), legacy);
  for (const asset of [codex.interface.logo, codex.interface.composerIcon]) {
    assert.ok((await readFile(`${root}/codex/classifier/${asset}`)).length > 0);
  }
  assert.equal(mcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  for (const manifest of [codex, claude]) assert.equal(manifest.mcpServers, './.mcp.json');
  const expected = { classifier: 'https://classifier.dev/mcp', 'classifier-docs': 'https://classifier.dev/mcp/docs' };
  const endpoints = servers => Object.fromEntries(Object.entries(servers).map(([name, server]) => [name, server.url]));
  assert.deepEqual(endpoints(mcp.mcpServers), expected);
  assert.deepEqual(endpoints(legacy.mcpServers), expected);
  assert.deepEqual(Object.fromEntries(muse.capabilities.mcpServers.map(server => [server.id, server.url])), expected);
  assert.deepEqual(Object.fromEntries(Object.entries(gemini.mcpServers).map(([name, server]) => [name, server.httpUrl])), expected);
  for (const server of Object.values(mcp.mcpServers)) assert.deepEqual(Object.keys(server).sort(), ['type', 'url']);
  for (const server of Object.values(mcp.mcpServers)) assert.equal(server.type, 'streamable-http');
  for (const server of Object.values(legacy.mcpServers)) assert.equal(server.type, 'http');
  for (const server of muse.capabilities.mcpServers) assert.equal(server.transport, 'http');
  const claudeMarket = await json('.claude-plugin/marketplace.json');
  const codexMarket = await json('.agents/plugins/marketplace.json');
  assert.equal(claudeMarket.plugins.find(plugin => plugin.name === portable.name).version, portable.version);
  assert.equal(claudeMarket.plugins[0].source, './plugins/classifier');
  assert.equal(codexMarket.plugins[0].source.path, './plugins/classifier');
  report.results.push({ name: 'portable, Claude, Codex, Muse and Gemini packages share endpoints, version and bundled skill', version: portable.version });

  if (!live) {
    const modules = (await readdir('dist/server', { recursive: true }))
      .filter(path => /\.(js|wasm)$/.test(path))
      .sort((a, b) => a === 'index.js' ? -1 : b === 'index.js' ? 1 : a.localeCompare(b))
      .map(path => ({ type: path.endsWith('.wasm') ? 'CompiledWasm' : 'ESModule', path: `dist/server/${path}` }));
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
      name: 'agent-plugins', modules, modulesRoot: 'dist/server',
      compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
      durableObjects: { FREE_BUDGET: { className: 'FreeBudget', useSQLite: true }, LIMITER: { className: 'RateLimiter', useSQLite: true } },
      kvNamespaces: ['STATS'], r2Buckets: ['TRAINING_DATA'],
      bindings: { SPENDING_ENABLED: 'true', PRIVACY_SALT: 'fixture', SPUR_API_KEY: 'fixture', TYPESAFE_API_KEY: 'fixture' },
      outboundService: async request => {
        if (request.url.startsWith('https://api.spur.us/')) return WorkerResponse.json({});
        assert.ok(request.url.includes('typesafe.ai'), `Unexpected upstream: ${request.url}`);
        const body = await request.json();
        return WorkerResponse.json({ model: 'jev-1.13.0', usage: { input_tokens: 100, output_tokens: 0 },
          answers: Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
            const labels = Object.keys(question.criteria);
            return [key, { choice: labels[0], confidence: 0.9, probabilities: { [labels[0]]: 0.9, [labels[1]]: 0.1 } }];
          })),
        });
      },
    }] }));
    await mf.ready;
  }
  const request = (url, options) => live ? fetch(url, { ...options, signal: AbortSignal.timeout(60_000) }) : mf.dispatchFetch(url, options);
  const rpc = async (url, method, params = {}) => {
    const response = await request(url, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', ...(!live ? { 'cf-connecting-ip': '203.0.113.42' } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
    const body = await response.json();
    assert.equal(body.id, id);
    return body;
  };
  for (const [name, url] of Object.entries(expected)) {
    const initialized = await rpc(url, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'classifier-plugin-e2e', version: portable.version } });
    assert.equal(initialized.result.protocolVersion, '2025-11-25');
    const tools = await rpc(url, 'tools/list');
    assert.ok(tools.result.tools.length >= 4);
    const tool = name === 'classifier' ? 'classify_texts' : 'list_docs';
    assert.ok(tools.result.tools.some(item => item.name === tool));
    const args = name === 'classifier' ? { inputs: ['Please refund my invoice.', 'The application crashes on launch.'], labels: ['billing', 'technical support'], share_data: false } : {};
    const call = await rpc(url, 'tools/call', { name: tool, arguments: args });
    assert.equal(call.error, undefined);
    assert.ok(!call.result.isError, JSON.stringify(call.result));
    assert.ok(call.result.content.some(item => item.type === 'text' && item.text.length > 0));
    if (name === 'classifier') {
      assert.equal(call.result.structuredContent.results.length, args.inputs.length);
      for (const row of call.result.structuredContent.results) assert.ok(args.labels.includes(row.label));
      const invalid = await rpc(url, 'tools/call', { name: tool, arguments: { inputs: ['sample'], labels: ['only one'], share_data: false } });
      assert.equal(invalid.error.code, -32602);
    }
    report.results.push({ name, url, tools: tools.result.tools.map(item => item.name), call: call.result });
  }
  if (!live) {
    assert.equal((await (await mf.getR2Bucket('TRAINING_DATA')).list()).objects.length, 0);
    for (const accept of ['text/html', 'text/plain', 'text/markdown']) {
      const response = await request('https://classifier.dev/mcp-setup', { headers: { accept } });
      assert.equal(response.status, 200);
      const text = await response.text();
      for (const term of ['add-mcp', 'Muse', 'Grok', 'Gemini', 'Agent Plugins']) assert.ok(text.includes(term), `${accept} missing ${term}`);
      assert.ok(!text.includes('Every tool here carries readOnlyHint'));
    }
    report.results.push({ name: 'HTML, plain text and Markdown install guides; opt-out requests retained no training data' });
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  await mf?.dispose();
  await mkdir('captures', { recursive: true });
  const path = `captures/agent-plugins${live ? '-live' : ''}.json`;
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status}: ${path}`);
  if (report.error) console.error(report.error);
}
