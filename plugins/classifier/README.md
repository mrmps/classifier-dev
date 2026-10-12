# classifier.dev plugins

The same two hosted MCP servers and `bulk-classify` skill, packaged for multiple
agents. Public calls need no API key. Workspace attribution and paid features
require a workspace key configured separately; hosted workspace OAuth is not
available yet.

Classification text, labels, instructions and results are retained for training
and operator review by default. Use `share_data: false` to opt out. The bundled
skill explains this, nullable confidence and service limits. See the
[privacy policy](https://classifier.dev/privacy).

## Quick MCP install

[Neon's add-mcp](https://github.com/neon-solutions/add-mcp) detects supported
coding clients and writes their native configuration. Run it in your project
and select the clients you want for each server:

```sh
npx add-mcp@2.4.1 https://classifier.dev/mcp --name classifier
npx add-mcp@2.4.1 https://classifier.dev/mcp/docs --name classifier-docs
```

Supported targets include Claude Code, Codex, Cursor, VS Code/Copilot, Gemini
CLI, Grok Build, Windsurf, Cline, Goose, Kiro, OpenCode, Zed and others. Run
`npx add-mcp@2.4.1 list-agents` for the exact list. Inspect the proposed scope
before confirming: selecting a global-only client
(such as Goose or Windsurf) makes the entire selection global. Do not use
`--all` or `--yes` unless you intend those configuration writes. Use the
native Gemini extension below for its documented Streamable HTTP settings.
This installs MCP tools,
not the skill. Choose either this route or a plugin bundle in each client to
avoid connecting the same servers twice. It does not install cloud apps such as
ChatGPT, Muse or Grok Bot.

## Build the plugin bundles

From the repository root, with Node.js 18 or newer (no dependencies required):

```sh
npm run package:plugins
```

The `classifier-plugins` artifact on the PR's GitHub Actions run contains the
same output. Each directory below is a self-contained plugin, with a copy of
the shared skill and the correct transport fields for its client:

| Output directory | Client / format |
| --- | --- |
| `dist/plugins/portable/classifier` | Agent Plugins 1.0 (`plugin.json`, `mcp.json`); Cursor and other conforming clients |
| `dist/plugins/claude/classifier` | Claude Code; Grok Build's documented Claude compatibility |
| `dist/plugins/codex/classifier` | ChatGPT / Codex plugin bundle with listing assets |
| `dist/plugins/muse/classifier` | Native Muse Code manifest |
| `dist/plugins/gemini/classifier` | Gemini CLI extension |

The source manifests remain in this directory. The packager derives the other
formats from the Codex metadata and `.mcp.json`. Muse rejects multiple manifests
in one package, so install its generated bundle, not this source directory.
The command replaces only its five generated directories under `dist/plugins`.

## Claude Code and Codex

These clients can install directly from this repository's existing marketplace:

```sh
claude plugin marketplace add mrmps/classifier-dev
claude plugin install classifier@classifier-dev

codex plugin marketplace add https://github.com/mrmps/classifier-dev
codex plugin add classifier@classifier-dev
```

Until this PR merges, use a local checkout as the marketplace source to review
its version. A remote install from `main` gets the currently released version.

## Muse Code

From the repository root after packaging:

```sh
export MUSE_EXPERIMENTAL_PLUGINS=1
muse plugins validate ./dist/plugins/muse/classifier
muse plugins install ./dist/plugins/muse/classifier --scope user
muse plugins approve classifier
```

The experimental flag is required by builds that gate plugins. Restart Muse
Code and inspect `/mcp` to confirm both servers. This is distinct from the
consumer Muse app.

## Gemini CLI

```sh
gemini extensions install ./dist/plugins/gemini/classifier
```

Restart Gemini CLI, then inspect `/mcp` and `/skills`. The extension uses
`httpUrl` for Streamable HTTP; `url` would select the wrong transport.

## Cursor and other Agent Plugins clients

Copy `dist/plugins/portable/classifier` into `~/.cursor/plugins/local/classifier`
and reload Cursor, then inspect Customize. Review or back up an existing folder
before replacing it. Cursor requires the copied files to live inside that local
plugins directory; an external symlink is not supported. Team policy can disable
local plugin imports. Other Agent Plugins clients use their own install UI.

## Grok Build

Grok Build documents Claude Code plugin compatibility. After packaging, load the
Claude bundle with:

```sh
grok --plugin-dir ./dist/plugins/claude/classifier
```

Alternatively use add-mcp with `--agent grok-build`. Grok Build is the local CLI;
Grok Bot is the hosted product below.

## ChatGPT, Claude app, Muse and Grok Bot

| Product | Connection path | Distribution boundary |
| --- | --- | --- |
| ChatGPT | Add `https://classifier.dev/mcp` as a custom app in developer mode, with No Authentication. The Codex bundle is also prepared for the shared plugin directory. | Public directory publication requires review. |
| Claude app / Desktop | Add `https://classifier.dev/mcp` as a custom connector, leaving OAuth fields empty. Add `/mcp/docs` separately if wanted. | Availability depends on plan and organization controls. |
| Muse (consumer app) | Ask Muse to create a custom connector using `https://classifier.dev/openapi.json` and `https://classifier.dev/skill.md`; use its API/CLI connector path. | The Muse Code bundle is not a consumer connector. Submit at [Muse Platform](https://muse.ai/platform) for directory distribution. |
| Grok Bot | Distribute the hosted MCP server through Cursor's plugin / team marketplace; then users add it through Connect apps. | A local Grok Build plugin does not install into Grok Bot. Review or team-admin setup is required. |

A concrete Muse setup prompt:

> Create a classifier.dev custom connector using https://classifier.dev/openapi.json
> and follow https://classifier.dev/skill.md. Use the public API without a key,
> set share_data to false, and classify a small synthetic batch with explicit
> labels. Preserve input order and nullable confidence. Show the actual response;
> do not claim setup succeeded until the request succeeds.

The existing [marketplace review packet](marketplace-review.md) contains the
submission details and acceptance examples. These files prepare integrations;
they do not imply any platform has approved or listed them.

## Verification and sources

`npm run package:plugins` builds the bundles. After `npm run build`, run
`npm run test:e2e:plugins` against the built Worker, or add `-- --live` to smoke
test the declared production MCP endpoints with synthetic data and training
opted out. Results go to `captures/agent-plugins.json` or
`captures/agent-plugins-live.json`. This proves package contents and MCP behavior,
not a user session in every host. Native validators:

```sh
claude plugin validate --strict dist/plugins/claude/classifier
MUSE_EXPERIMENTAL_PLUGINS=1 muse plugins validate dist/plugins/muse/classifier
```

- [Agent Plugins 1.0 specification](https://agent-plugins.org/specification)
- [Cursor plugins and local imports](https://cursor.com/docs/plugins)
- [Meta's native Muse manifest example](https://github.com/facebook/meta-wearables-dat-ios/blob/main/plugins/mwdat-ios/.muse-plugin/plugin.json)
- [Muse custom connectors](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
- [Grok Build plugin compatibility](https://docs.x.ai/build/features/skills-plugins-marketplaces)
- [Grok Bot plugins](https://cursor.com/help/grok-bot/connect-plugins)
- [Gemini extension reference](https://geminicli.com/docs/extensions/reference/)
- [ChatGPT and Codex plugins](https://developers.openai.com/plugins)
