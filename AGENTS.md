# AGENTS.md — working in this repository

classifier.dev is one Cloudflare Worker (`src/index.ts`) with no runtime
dependencies, a one-file CLI (`cli/classify.js`) and a Python eval harness
(`eval/`). Everything the site says is generated from constants in `src/`, so
the plain text (`curl classifier.dev`), the HTML and the Markdown never drift.

## Run and check

- `npm test` — worker unit tests (bun). `cd cli && node --test` — CLI tests.
- `npx tsc --noEmit` — typecheck. `npx wrangler deploy` — deploy (secrets live in Wrangler).
- `wrangler.toml` is gitignored: copy `wrangler.example.toml` once and fill in
  your `account_id` and `STATS` KV id. Edit the example when the deployment
  shape changes — crons, bindings, migrations — never put real ids in it.
- `npm run vs-jev` — re-measure the service against Jev; writes `src/vs-jev.json`, which the site imports.

## Conventions

- Docs are plain text with UPPERCASE headings (`src/docs.ts`, `src/pages.ts`); `renderDoc` turns them into HTML and `toMarkdown` into Markdown.
- Discovery files (`/.well-known/*`, sitemap, robots, auth.md) are generated in `src/wellknown.ts` from `SITE` and the MCP tool table — edit the source, never a served file.
- The MCP servers (`src/mcp.ts`) are stateless Streamable HTTP; tools call the API through `worker.fetch` so limits and logging are shared.
- Never commit secrets; `.secrets.env`, `.dev.vars` are ignored. `eval/data/` is ignored except the summary copied to `src/vs-jev.json`.
- Measured numbers on the site come from `eval/`; do not type numbers in by hand.
- The updates roadmap is one constant, `ROADMAP` in `src/newsletter.ts`; the plain
  text, the signup form and the Markdown all render from it. Addresses go to a
  separate Neon project and the table stores nothing that could join them to API
  traffic — keep it that way.
