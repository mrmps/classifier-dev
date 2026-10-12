import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = new URL('../plugins/classifier/', import.meta.url);
const output = new URL('../dist/plugins/', import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, source), 'utf8'));
const codex = await read('.codex-plugin/plugin.json');
const claude = await read('.claude-plugin/plugin.json');
const { mcpServers } = await read('.mcp.json');
const { skills, mcpServers: mcpPath, interface: presentation, ...metadata } = codex;
if (claude.name !== codex.name || claude.version !== codex.version) {
  throw new Error('Claude and Codex plugin names and versions must agree.');
}

const bundles = {
  portable: {
    'plugin.json': { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', ...metadata },
    'mcp.json': {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: Object.fromEntries(Object.entries(mcpServers).map(([name, server]) => [name, { type: 'streamable-http', url: server.url }])),
    },
  },
  claude: { '.claude-plugin/plugin.json': claude, '.mcp.json': { mcpServers } },
  codex: { '.codex-plugin/plugin.json': codex, '.mcp.json': { mcpServers } },
  muse: {
    '.muse-plugin/plugin.json': {
      schemaVersion: 1, name: codex.name, version: codex.version,
      displayName: presentation.displayName, description: codex.description,
      compat: { manifestDir: '.muse-plugin' },
      capabilities: {
        skills: [{ id: 'bulk-classify', path: 'skills/bulk-classify/SKILL.md' }],
        mcpServers: Object.entries(mcpServers).map(([id, server]) => ({ id, transport: 'http', url: server.url })),
      },
    },
  },
  gemini: {
    'gemini-extension.json': {
      name: codex.name, version: codex.version, description: codex.description,
      mcpServers: Object.fromEntries(Object.entries(mcpServers).map(([name, server]) => [name, { httpUrl: server.url }])),
    },
  },
};

for (const [format, files] of Object.entries(bundles)) {
  const destination = new URL(`${format}/classifier/`, output);
  await rm(destination, { recursive: true, force: true });
  await cp(new URL('skills/', source), new URL('skills/', destination), { recursive: true });
  if (format === 'codex') await cp(new URL('assets/', source), new URL('assets/', destination), { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const target = new URL(path, destination);
    await mkdir(new URL('./', target), { recursive: true });
    await writeFile(target, JSON.stringify(content, null, 2) + '\n');
  }
  console.log(`${format}: ${fileURLToPath(destination)}`);
}
