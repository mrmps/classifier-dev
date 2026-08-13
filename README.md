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

## Multi-label

`multi: true` returns every label that applies, up to 100 of them, and switches
on by itself past 26 — a single-label answer rides on one letter token, which is
exactly why 26 was ever the cap.

Asked to pick from fifty categories at once, the small model returns the ten most
*salient* rather than every one that *applies*: it dropped topics the text named
outright while inventing one it never mentioned. So the label set is swept in
groups of twelve, concurrently, and the survivors are re-judged in a single pass
with all of them finally in view.

Each stage fixes what the other breaks. The sweep alone reaches recall 0.90 but
precision 0.71, because no group can see what the others found. The second pass
pulls precision to 0.90. Measured on a seven-task set:

| configuration                | P    | R    | F1    | latency |
| ---------------------------- | ---- | ---- | ----- | ------- |
| single call, all 50 labels   | 0.79 | 0.62 | 0.686 | 0.7s    |
| sweep only, no second pass   | 0.71 | 0.90 | 0.761 | 0.7s    |
| sweep + second pass (fast)   | 0.90 | 0.69 | 0.777 | 1.4s    |
| sweep + second pass (smart)  | 0.87 | 0.89 | 0.868 | 12s     |

Two approaches were tried and rejected. Judging each survivor alone as a yes/no
question scored 0.612 — isolating a label throws away the comparison that makes
the call, even though it is the textbook one-vs-rest method. And a deliberately
strict pruning prompt scored 0.556, dropping topics the text stated plainly.

`tier: "smart"` runs only the second pass on the smart model; the sweep stays
cheap. That measured the same as running smart throughout (0.868 vs 0.879) in
a little over half the time, so the split is strictly better.

Reasoning models need their full token budget in this mode. Capping them to the
tight multi-label allowance spends it on reasoning before any answer is emitted,
and the response comes back empty — which is exactly how it failed the first time.

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
