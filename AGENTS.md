# AGENTS.md — working in this repository

classifier.dev is one Cloudflare Worker (`src/index.ts`),
a one-file CLI (`cli/classify.js`) and a Python eval harness
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
- Long-context jobs in `src/long-context-job.ts` accept ordered bounded parts through a SQLite Durable Object. It holds a maximum-price workspace reservation, retains only selected evidence until completion/cancellation/24-hour expiry, and settles the original part-token total once. Keep `wrangler.example.toml`, the generated docs and the job E2E in sync with this contract.
- Never commit secrets; `.secrets.env`, `.dev.vars` are ignored. `eval/data/` is ignored except the summary copied to `src/vs-jev.json`.
- Measured numbers on the site come from `eval/`; do not type numbers in by hand.
- Jev is asked through Vercel's AI Gateway first when `AI_GATEWAY_API_KEY`
  is set and `AI_GATEWAY_DISABLED` is not `"true"` (free monthly credit,
  rate-limited) and through TypeSafe directly
  when the gateway refuses; both transports and the translation between them
  live in `src/jev.ts`. Nothing downstream should know which door answered
  beyond the `model` label.
- Laya (`jev/laya`) and Kev (`jev/kev`) are hosted by Beam, which speaks the
  same System One protocol, so they are a third transport in `src/jev.ts`
  rather than a second client: one packer, one retry policy, one validator,
  one meter, selected by a `Backend` descriptor. `src/laya.ts` owns only the
  product contract — lanes, caller limits, quota cost. `BEAM_API_KEY` is the
  single credential; there is no deployment of ours and nothing on Modal.
  Beam refuses more than 32 named questions per request and rejects an
  oversized context rather than truncating, so a context refusal is
  translated to `max_tokens_exceeded` and the batch halves and retries.
  Unlike Jev, a Beam request is never retried: a lane quota counts attempts.
- Default/explicit Jev inputs over 32,000 characters use long-context Jev:
  Chonkie RecursiveChunker with 600 cl100k_base tokens, parallel relevance/
  uncertainty screening that preserves opposing evidence and exceptions,
  then whole eligible chunks in source order for final Jev within 20,000
  cl100k_base tokens and a safe provider estimate. Eligible evidence can be
  omitted when the budget fills; disclose selection in usage.long_context.
  Limits: 250,000 original context tokens summed once across inputs, 20
  documents, 32 decisions (documents × dimensions or multi-label categories),
  1 MB request body. Fast only. Require a workspace
  with paid balance or active paid subscription; signup credit is insufficient.
  Retail is original context tokens × 2 × $0.042/M, independent of dimensions
  and actual screening/final usage. No evidence returns 422
  long_context_no_evidence without charge. Never claim universal accuracy or
  that the final call reads the full original document.
  Preserve existing trusted dedicated enterprise/operator access. Aggregate
  long-context counts go to classifier_long_context_events and appended
  account analytics fields; never record document text or caller identifiers.
- Explicit chunklaya (`chunklaya/multilingual`) is our legacy opt-in service: Laya
  behind a chunk-and-index harness, github.com/myxamediyar/chunklaya under
  `serve/`, on a RunPod pod. It speaks System One too, so it is a fourth
  transport in `src/jev.ts`, reached through `CHUNKLAYA_URL` and
  `CHUNKLAYA_TOKEN` (Worker secrets). It requires explicit model: "chunklaya",
  `CHUNKLAYA_ENABLED` set to `"true"` and both secrets; it is never selected
  automatically for long text. One document is one
  request; the service refuses rather than truncates, its 4xx become
  `chunklaya_input`, and there is no fallback to Jev or the LLM chain. It is
  billed by the hour, so no per-token provider cost is metered.
- The updates roadmap is one constant, `ROADMAP` in `src/newsletter.ts`; the plain
  text, the signup form and the Markdown all render from it. Addresses go to the
  `subscriber` table in the shared application Neon database. Preserve consent,
  timestamps, preferences and unsubscribe state; never link newsletter consent
  to account membership or write API traffic identifiers into subscriber rows.
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
