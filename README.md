# classifier.dev

Zero-shot text classification. Plain text in, a label out. No key, no signup.

    curl https://classifier.dev/spam,not+spam/Win+a+free+iPhone
    spam

Single Cloudflare Worker. No database, no framework, no build step beyond esbuild.

## Layout

    src/index.ts    routing, validation, OpenRouter calls, analytics
    src/limiter.ts  Durable Object: per-IP rate limiting
    src/report.ts   daily digest — Analytics Engine SQL -> Resend
    src/docs.ts     the site (GET / and GET /benchmark), plain text
    finish-dns.sh   one-shot DNS wiring, see below

## Deploy

    npx wrangler deploy

Secrets already set: `OPENROUTER_API_KEY`, `RESEND_API_KEY`, `CF_ANALYTICS_TOKEN`, `REPORT_KEY`.
Add one with `npx wrangler secret put NAME`.

## Analytics

Every request writes one Analytics Engine datapoint (tier, label-set fingerprint,
country, status, count, latency). No request text is ever stored.

A cron at 15:00 UTC queries it and emails a digest via Resend.

Preview it any time without sending:

    curl "https://classifier.dev/report?key=$REPORT_KEY"

Append `&send=1` to actually email it.

Cloudflare's Analytics Engine SQL is a narrow ClickHouse subset — no `uniq()`,
no `SELECT DISTINCT`, and a bare `SELECT col ... GROUP BY col` is rejected.
Distinct counts therefore use `SELECT col, count() ... GROUP BY col` and count
the returned rows. Each query is isolated so one failure cannot blank the report.

## Rate limiting

Per IP, per minute, in a Durable Object: 60 fast, 10 smart.

Two other approaches were tried and rejected:
- Cloudflare's native `ratelimit` binding registers fine but never decremented
  (70 calls against a limit of 60 all returned `success: true`).
- KV is edge-cached and eventually consistent, so a counter written this second
  is invisible to the next read — every request saw `remaining: 59`.

A Durable Object is single-threaded and strongly consistent, which is what a
counter needs. Verified: 75 requests -> 60 × 200, 15 × 429.

## DNS

The domain is registered at Porkbun; the Worker is on Cloudflare. Cloudflare
Workers custom domains require the zone to live in Cloudflare, and neither API
token here has `zone.create`, so that one step is manual:

1. https://dash.cloudflare.com -> Add a domain -> `classifier.dev` -> Free plan
2. `./finish-dns.sh` — reads the assigned nameservers, points Porkbun at them
   via the Porkbun API, and attaches the Worker to the apex and `www`.

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
