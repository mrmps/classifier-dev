# AGENTS.md — working in this repository

classifier.dev is one Cloudflare Worker (`src/index.ts`) with no runtime
dependencies, a one-file CLI (`cli/classify.js`) and a Python eval harness
(`eval/`). Everything the site says is generated from constants in `src/`, so
the plain text (`curl classifier.dev`), the HTML and the Markdown never drift.

## Run and check

- `npm test` — worker unit tests (bun). `cd cli && node --test` — CLI tests.
- `npx tsc --noEmit` — typecheck. `npx wrangler deploy` — deploy by hand (secrets live in Wrangler).
- Merging to `main` deploys: `.github/workflows/deploy.yml` runs those three
  checks and then `wrangler deploy`. A hand deploy is for trying something
  before it is merged.
- `wrangler.toml` is gitignored: copy `wrangler.example.toml` once and fill in
  your `account_id` and `STATS` KV id. The example is what CI renders into a
  real `wrangler.toml`, so it is the deployed shape, not a copy of it — change
  the example whenever crons, bindings, migrations or rules change, or CI will
  deploy the old shape. Never put real ids in it.
- `npm run vs-jev` — re-measure the service against Jev; writes `src/vs-jev.json`, which the site imports.

## Conventions

- Docs are plain text with UPPERCASE headings (`src/docs.ts`, `src/pages.ts`); `renderDoc` turns them into HTML and `toMarkdown` into Markdown.
- Discovery files (`/.well-known/*`, sitemap, robots, auth.md) are generated in `src/wellknown.ts` from `SITE` and the MCP tool table — edit the source, never a served file.
- The MCP servers (`src/mcp.ts`) are stateless Streamable HTTP; tools call the API through `worker.fetch` so limits and logging are shared.
- Never commit secrets; `.secrets.env`, `.dev.vars` are ignored. `eval/data/` is ignored except the summary copied to `src/vs-jev.json`.
- Measured numbers on the site come from `eval/`; do not type numbers in by hand.
- Jev is asked through Vercel's AI Gateway first when `AI_GATEWAY_API_KEY`
  is set (free monthly credit, rate-limited) and through TypeSafe directly
  when the gateway refuses; both transports and the translation between them
  live in `src/jev.ts`. Nothing downstream should know which door answered
  beyond the `model` label.
- The updates roadmap is one constant, `ROADMAP` in `src/newsletter.ts`; the plain
  text, the signup form and the Markdown all render from it. Addresses go to a
  separate Neon project and the table stores nothing that could join them to API
  traffic — keep it that way.
- The skills directory (`src/skills.ts`, cleaners in `src/skillscan.ts`) stores
  accepted skills in the `STATS` KV under `skill:{slug}`, `skills:index` and
  `skillhash:{sha}`; rejections store nothing. The three gates run in order
  (cleaners, Jev, judge) and each is a floor on its own; change the prompt or
  a threshold there, never on the page, which renders from the same constants.
  `DELETE /v1/skills/{slug}` with the `REPORT_KEY` bearer is the takedown.
- Nothing that identifies a caller is written down. An IP and a label set both
  go through `src/privacy.ts` first — a keyed hash, day-scoped for the caller —
  before they reach Analytics Engine, KV or an email. If you add a column,
  a log line or a panel, it carries counts and fingerprints, never the caller's
  address or their words.
