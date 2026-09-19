# classifier.dev

Zero-shot text classification. Plain text in, a label and a calibrated
confidence out. No key, no signup. Up to a thousand texts per request.

    curl https://classifier.dev/spam,not+spam/Win+a+free+iPhone
    spam

    curl "https://classifier.dev/?labels=spam,not+spam&text=Win+a+free+iPhone"   # same call, query form
    spam

Single Cloudflare Worker. No database, no framework, no build step beyond esbuild.

## CLI

    npm i -g classifier-dev
    classify bug,feature,praise < feedback.txt

`cli/` is a separate npm package (`classifier-dev`, bin `classify`): one
dependency-free Node file, tests against a mock API (`npm test`), semver with
its own CHANGELOG, released with `npm run release patch|minor|major` which
tags `cli-v<version>` and lets `.github/workflows/publish-cli.yml` publish
(needs an `NPM_TOKEN` repo secret). It talks to the API exactly like curl does.

## Layout

    src/index.ts    routing, validation, tiers, LLM fallback chain, analytics
    src/query.ts    the GET query form, read and written with nuqs; the URL an error suggests
    src/jev.ts      TypeSafe's Jev: packs inputs into requests, reads probabilities
    src/limiter.ts  Durable Object: per-IP rate limiting
    src/report.ts   digest — Analytics Engine SQL -> Resend, flags model fallbacks
    src/alerts.ts   every 15 minutes; emails only when something is wrong
    src/feedback.ts agent feedback, feedback.now protocol -> email
    src/admin.ts    /admin — the operator dashboard, same data as the digest
    src/cost.ts     per-request upstream spend, from the providers' own accounting
    src/docs.ts     the site (GET / and GET /benchmark), plain text
    src/home.ts     the same two documents rendered, for browsers only
    src/ui.ts       the shared look: markdown in a terminal
    cli/            the `classify` command, published to npm as classifier-dev
    eval/           benchmarks; read eval/README.md before quoting a number
    finish-dns.sh   one-shot DNS wiring, see below
    wrangler.example.toml  the Worker config, minus the account-specific ids

## The site

`curl classifier.dev` prints plain text, exactly as it always has. A browser
sends `Accept: text/html` and gets the same document rendered — headings,
bracketed links, copy buttons — from `src/home.ts`. Nothing is duplicated: the
page is generated from `DOCS` and `BENCHMARK` at request time, so the text
stays canonical and the two cannot drift. `?format=text` opts out by hand, and
both responses carry `Vary: accept`.

## Agent feedback

Implements the [feedback.now](https://feedback.now) protocol (schema 1.1), so
any agent that speaks it can report a problem without being told how:

    GET  /.well-known/agent-feedback.json   what this host accepts
    GET  /api/v1/policy                     categories, severities, limits
    POST /api/v1/feedback                   full structured report
    POST /api/v1/observations               lighter signal
    POST /api/v1/feedback/{id}/attachments  more evidence, later
    GET  /api/v1/receipts/{id}              did it land, and was it any good

Accepted submissions are emailed to `REPORT_TO`. Reports are kept in KV for 90
days. A repeat of the same domain + surface + category + title is stored and
acknowledged as a duplicate but not emailed again, so one looping agent cannot
empty itself into the inbox; the hourly budget is 100 per IP and the remainder
comes back on every receipt.

`quality_score` is a deterministic function of how complete the report is — an
agent can read the rule and write a better one next time. Nothing here calls
the classifier or Analytics Engine: this is where reports arrive saying those
are broken, so it must work when they do not.

## Deploy

Merging to `main` deploys. `.github/workflows/deploy.yml` typechecks, runs the
Worker and CLI tests, runs `wrangler deploy`, and then asks the live service for
`/v1/health` and one classification, so a deploy that uploads a broken Worker
fails in CI rather than in somebody's terminal.

By hand, to try something before it is merged:

    cp wrangler.example.toml wrangler.toml     # once, then fill in your own ids
    npx wrangler deploy

`wrangler.toml` is gitignored and holds the two values that are specific to one
Cloudflare account: `account_id`, and the `STATS` KV namespace id that
`npx wrangler kv namespace create STATS` hands back. The tracked
`wrangler.example.toml` carries everything else — crons, bindings, migrations —
so the deployment shape is in the repository and only the identifiers are not.

CI has no `wrangler.toml`, so `.github/render-wrangler.mjs` writes one from the
example and three repository secrets. That makes the example the deployed shape
rather than a copy of it: change a binding in `wrangler.toml` alone and CI keeps
deploying the old one.

Repository secrets the deploy needs:

    CLOUDFLARE_API_TOKEN    dash.cloudflare.com > My Profile > API Tokens >
                            Create Token > "Edit Cloudflare Workers"
    CLOUDFLARE_ACCOUNT_ID   the account_id from wrangler.toml
    STATS_KV_ID             the STATS namespace id from wrangler.toml
    REPORT_TO               where the daily digest goes

Secrets set with `wrangler secret put` live on the Worker, not in the script
bundle, so a deploy leaves them alone and CI never needs to know them.

Secrets the Worker reads: `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`,
`RESEND_API_KEY`, `CF_ANALYTICS_TOKEN`, `REPORT_KEY`, `ADMIN_PASSWORD`,
`ADMIN_SIGNING_KEY`. Add one with `npx wrangler secret put NAME`; none of them
are ever read from the repository.

Secrets are compared with `secretEquals` (src/secrets.ts), never `===`: a
plain comparison returns on the first wrong byte and tells a caller how much
of a guess was right. `ADMIN_SIGNING_KEY` is random and unrelated to the
password, so a leaked session cookie cannot be ground back into it.

## The model

Both tiers answer from [TypeSafe's Jev](https://docs.typesafe.ai), a decision
model rather than a language model: it takes a state and typed questions and
returns a calibrated probability per option, in ~150ms. That shape is why the
API can do three things the LLM version could not.

**A thousand inputs per request.** State is an array of `{id, text}` and each
input gets its own question, so the whole batch is one upstream call. The
documented limit is 64k tokens per request; `jev.ts` packs to a conservative
budget and runs the resulting requests eight at a time. Measured: 400 news
headlines classified in 650ms end to end, and packing 100 items scored the
same as sending them one at a time.

**Confidence that means something.** On 400 six-way emotion items, answers at
>= 0.9 confidence were right 82% of the time and answers below 0.5 were right
29%. The previous model's logprob "confidence" put 87% of news items above 0.9
and was right on 68% of those. So `tier: "smart"` now means: re-ask the
single-label answers below 0.7 of a fast reasoning model and replace them,
marked `escalated: true`. Nothing else changes. Which model matters: on
exactly the items Jev is unsure about, deepseek-v4-flash, qwen3.7-flash and
mercury-2.5 were no better than Jev; gemini-3.8-flash took news topics from
87.5% to 90.0% and emotion from 61.8% to 63.7%, so that is the chain. A
frontier model (claude-fable-5.1) gets 72.3% / 90.7% at ~3x the price; the
numbers are on /benchmark if that trade ever looks worth it.

**Multi-label in one pass.** One yes/no question per label, labels at >= 0.7
returned most-likely-first with the full score map. F1 0.887 on the seven-case
set against 0.799 for the sweep-and-verify LLM cascade it replaced, in 230ms
instead of 1.5s. Re-judging its candidates with the reasoning model made it
worse (and took 23s), so multi-label ignores the tier.

The LLM chains in `index.ts` remain as the fallback when TypeSafe is
unavailable, limited to twenty inputs because they are one call per input.
The digest reports which model actually answered, with a `FALLBACK` marker,
because the previous primary was delisted upstream and served its backup for
weeks at F1 0.546 without anything saying so.

## Updates list

The form at the foot of the home page posts to `POST /subscribe`, which appends
the address to Postgres in its own Neon project (`classifier-newsletter`; the
id is in `.secrets.env`, or from `neonctl projects list`). The table has four
columns and no others: the address, where it came from, when it arrived, and a
column for unsubscribing.
There is deliberately no IP and no request id, so there is no column an address
could be joined on. `on conflict (email) do nothing` makes a repeat submission a
no-op, which also stops the response being used to test whether an address is
already on the list.

    npx wrangler secret put NEWSLETTER_DATABASE_URL

The Worker writes over Neon's HTTP SQL endpoint rather than a Postgres driver:
a Worker has no TCP, and this is one parameterised INSERT.

Read the list:

    neonctl connection-string --project-id "$NEWSLETTER_PROJECT_ID" \
      --role-name neondb_owner --database-name neondb \
      | xargs -I{} psql {} -c "select email, created_at from subscriber order by id"

The Worker connects as `newsletter_writer`, which is granted `INSERT` on that
one table and nothing else. Do not read more into that than it deserves: Neon
puts every role it creates into `neon_superuser`, which can read any table
whatever the grants say, and neither the project owner nor `ALTER ROLE` can
revoke that membership. So the connection string can in fact read the list.
What actually keeps the addresses apart is the separate project and the absent
columns, not the grant. To rotate the credential, delete and recreate the role
(`neonctl roles delete newsletter_writer`, then `create`) and put the new
string back with `wrangler secret put`.

The copy is one constant — `ROADMAP` in `src/newsletter.ts`. The plain text at
`curl classifier.dev`, the form on the rendered page and `index.md` all read it,
so a change to the roadmap changes all three or none.

## Analytics

Every request writes one Analytics Engine datapoint (tier, label-set fingerprint,
country, status, count, latency). No request text is ever stored.

Every request also records what it cost us: OpenRouter returns the charge for
a call when asked, and Jev is billed on the input tokens it reports, at the
rate `eval/bench.py` prices the benchmarks with. Spend accumulates in a
per-request meter (`src/cost.ts`) and lands in `double3`. That column was added
after launch, so it reads 0 for anything older than that deploy.

A cron at 15:00 UTC queries it and emails a digest via Resend.

### Alerts

A separate cron runs every fifteen minutes and stays silent unless something
fires. It only watches conditions with an action attached: the Jev key being
refused, Jev not answering (the fallback chain serving quietly, which has
happened), 5xx rates, smart-tier escalations failing (the shape an exhausted
`OPENROUTER_API_KEY` takes), mean latency, a spend spike against the trailing
day, and traffic stopping outright. 4xx is ignored — that is scanners probing
for `/wp-admin`, not a fault.

**Jev credits.** TypeSafe publishes no balance endpoint — its API is
`/v1/systemone` and `/v1/models`, nothing else — so there is no number to
watch. Instead the check calls `/v1/models` with the key every fifteen
minutes and reports back whatever TypeSafe says: a 401, 402 or 403 there means
out of credit, revoked or wrong, and raises a critical alert quoting TypeSafe's
own message rather than guessing which status means what. Because it probes
rather than waiting for traffic, it fires on a quiet host before any caller
meets the fallback chain, and it runs even when Analytics Engine is down.

Each condition emails once when it starts, again every six hours while it
lasts, and once when it clears, with the state in KV under `alert:`. Thresholds
are the `T` object at the top of `src/alerts.ts`.

    curl -H "authorization: Bearer $REPORT_KEY" https://classifier.dev/alerts
    curl -H "authorization: Bearer $REPORT_KEY" "https://classifier.dev/alerts?demo=1&send=1"

The first previews without sending or touching state; the second emails a
sample through the real path, to prove delivery works.

### /admin

The same dataset, rendered: <https://classifier.dev/admin>. Requests,
classifications, upstream spend, cost per 1,000, latency, error rate, unique
IPs and distinct label sets, over 24h / 7d / 30d, plus breakdowns by tier,
model, status and country, and the busiest label sets. Every chart is backed by
a table, so nothing is readable by colour alone.

One shared password, in the `ADMIN_PASSWORD` secret — never in the source. A
correct password mints an HMAC-signed cookie that expires in 12 hours; there is
no session store. Wrong guesses go through the same Durable Object limiter the
API uses, capped at 10 a minute per IP.

Preview it any time without sending:

    curl -H "authorization: Bearer $REPORT_KEY" https://classifier.dev/report

A query string lands in logs, browser history and Referer headers, so the
header is the way in; `?key=` still works for compatibility.

Append `&send=1` to actually email it.

Cloudflare's Analytics Engine SQL is a narrow ClickHouse subset — no `uniq()`,
no `SELECT DISTINCT`, and a bare `SELECT col ... GROUP BY col` is rejected.
Distinct counts therefore use `SELECT col, count() ... GROUP BY col` and count
the returned rows. Each query is isolated so one failure cannot blank the report.

## Eval

    npm run bench                 # multi-label, 7 cases: jev vs any OpenRouter model
    npm run single -- --dataset emotion --backend jev
    npm run single -- --dataset ag_news --backend openrouter:qwen/qwen3.7-flash
    python3 eval/escalate.py --dataset emotion     # what the smart tier buys

`single.py` downloads AG News and dair-ai/emotion test rows on first use and
caches raw results under `eval/data/results/` so `escalate.py` can combine
backends without re-spending. `eval/README.md` lists the caveats.

## Rate limiting

Per IP in a Durable Object, counted in classifications: 3,000/min and
20,000/day on fast, 200/min and 2,000/day on smart.

Two other approaches were tried and rejected:
- Cloudflare's native `ratelimit` binding registers fine but never decremented
  (70 calls against a limit of 60 all returned `success: true`).
- KV is edge-cached and eventually consistent, so a counter written this second
  is invisible to the next read — every request saw `remaining: 59`.

A Durable Object is single-threaded and strongly consistent, which is what a
counter needs. Verified at the original 60/min: 75 requests -> 60 × 200, 15 × 429.

## DNS

The domain is registered at Porkbun; the Worker is on Cloudflare. Cloudflare
Workers custom domains require the zone to live in Cloudflare, and neither API
token here has `zone.create`, so that one step is manual:

1. https://dash.cloudflare.com -> Add a domain -> `classifier.dev` -> Free plan
2. `./finish-dns.sh` — reads the assigned nameservers, points Porkbun at them
   via the Porkbun API, and attaches the Worker to the apex and `www`.

## Agent skill

    npx skills add https://classifier.dev

Served from this domain over RFC 8615 well-known discovery, so there is no
repository in the middle:

    src/SKILL.md                          the skill, bundled as a Text module
    GET /skill.md                         the artifact
    GET /.well-known/agent-skills/index.json   discovery, schema v0.2.0

The index must carry a sha256 of the artifact, and an index that disagrees with
the file makes the skill uninstallable. Rather than commit a digest that a later
edit would silently invalidate, `src/skill.ts` hashes the bytes it actually
serves, once per isolate. Editing SKILL.md is therefore enough; nothing else
needs updating.

The skill teaches the case the API pitch misses: you are already a model and can
classify anything you can see, so the reason to call out is context, not
capability — filtering forty search results down to six without reading forty.

Two things it documents because testing found them the hard way. Cloudflare
403s Python's stdlib `urllib` User-Agent before the request reaches the Worker,
so the recipe sets one explicitly. And filters should be told "when in doubt,
keep it": on a ten-snippet research filter that took signal kept from 4/6 to
6/6 with no extra noise, where adding a third "possibly relevant" label did
nothing.

## Discovery surfaces

    GET /openapi.json               OpenAPI 3.1, also at /.well-known/openapi.json
    GET /llms.txt                   short index for agents, linked from robots.txt
    GET /benchmark                  measured accuracy, cost, latency

Both are linked from the third paragraph of `GET /` so an agent reading the
landing page finds them immediately.

## Known issue: Cloudflare's managed robots.txt

Adding the zone enabled Cloudflare AI Crawl Control, which prepends a managed
block to `/robots.txt` disallowing GPTBot, ClaudeBot, CCBot, Google-Extended,
Bytespider, Amazonbot and meta-externalagent. The Worker's own robots.txt is
appended after it and cannot override it.

This blocks *training* crawlers, not runtime API consumers — any agent can still
call the API. But it does keep the docs out of future model training data, which
works against discovery. The toggles at
dash.cloudflare.com -> classifier.dev -> AI Crawl Control -> Security did not
persist when flipped, so this likely needs a plan-level change or support.
