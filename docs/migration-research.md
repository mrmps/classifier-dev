# Migration research

Verified September 20, 2026. This records evidence and planning estimates, not a production deployment or a capacity benchmark. No project, account, plan, or hosted analytics configuration was created or changed during these checks.

## Region recommendation

**AWS Oregon (`aws-us-west-2`) is the leading Neon region**, because TypeSafe's public API ingress resolves there. Cloudflare can execute nearby using `[placement] region = "aws:us-west-2"`. Autumn is a background dependency in this design, so its location should not determine the classification path.

| Finding | Evidence | Confidence and limitation |
| --- | --- | --- |
| TypeSafe API ingress is allocated in Oregon | `dig api.typesafe.ai` returned `44.227.31.201` and `100.20.85.248`. The [official AWS ranges](https://ip-ranges.amazonaws.com/ip-ranges.json) place both in AMAZON/EC2 `us-west-2` (`44.224.0.0/11`, `100.20.0.0/14`). | High for ingress at inspection time; this does not prove the GPU backend region. |
| Neon supports Oregon | Authenticated, read-only `neonctl api /regions` returned `aws-us-west-2`, named `AWS US West 2 (Oregon)`. Neon's [regional latency page](https://neon.com/demos/regional-latency) also includes it. | High; no project provisioned. |
| Current newsletter database is in Virginia | Read-only Neon project/branch metadata: `classifier-newsletter`, `aws-us-east-1`, PostgreSQL 18; main branch ready. `pg_stat_user_tables` lists only `public.subscriber`, approximately 76 live rows. | High for region/schema; row estimate is approximate. No subscriber content read. |
| Existing `classify` project is empty and in Virginia | Read-only Neon metadata: `aws-us-east-1`, PostgreSQL 18, one main branch and `neondb`; `pg_stat_user_tables` returned zero rows. Branch was archived before the read-only connection. | High; not a western consolidation target. |
| Autumn ingress resolves to Ohio | `api.useautumn.com` CNAME contains `us-east-2.elb.amazonaws.com`; returned IPs `18.227.181.225`, `3.19.122.86`. | High for current load-balancer region; no guarantee about internal storage. |
| Worker can run near the chosen region | Cloudflare [Placement documentation](https://developers.cloudflare.com/workers/configuration/placement/) supports explicit cloud-region hints. | It executes in Cloudflare's nearest suitable data center, not inside AWS; this is not a strict residency guarantee. |

Reusing the newsletter project avoids moving its table, but retains an east/west hop to TypeSafe. Consolidating in Oregon better matches the desired single-region application. Region selection should be confirmed with a small regional request-path test before production migration; local-machine latency cannot compare Cloudflare regions.

### Read-only network probes

Five sequential, unauthenticated HEAD requests per endpoint, each from the local workstation with a fresh curl process and a ten-second timeout. No inference request or billable model invocation was made. Milliseconds include DNS/TCP/TLS; there was no connection reuse. The workstation's timezone is not proof of its network egress location.

| Endpoint | Status | TCP connect median | TLS complete median | First byte median | Total range |
| --- | --- | ---: | ---: | ---: | ---: |
| `https://api.typesafe.ai/v1/systemone` | 405, all five | 31.34 ms | 68.86 ms | 103.30 ms | 97.26–106.32 ms |
| `https://api.useautumn.com/v1/products` | 401, all five | 77.36 ms | 241.20 ms | 321.34 ms | 312.90–339.32 ms |

These measure rejection paths, not authenticated API work, model inference, production p95, or regional Worker latency. They demonstrate reachability only and must not be presented as an application benchmark.

## Jina free access and datacenter policy

The [official Reader page](https://jina.ai/reader/) documents 20 RPM without an API key, 500 RPM with a free key, 500 RPM paid, and 5,000 RPM premium. It says rate limits use IP identity for anonymous requests and key identity when a key is supplied, with RPM/TPM enforcement. New keys receive a one-time 10M-token allowance.

The public [ASN service](https://github.com/jina-ai/reader/blob/main/src/services/ipasn.ts) uses a local MaxMind database for ASN and organization lookup. Its existence alone does not establish a hosting-provider restriction. The [architecture document](https://github.com/jina-ai/reader/blob/main/architecture.md) says the SaaS rate-limiting implementation is outside the public branch. It documents reduced anonymous capabilities and temporary target-domain blocks after abuse.

**No confirmed distinct policy was found saying residential anonymous requests are accepted while datacenter anonymous requests require a key.** Official documentation, public source, and targeted searches did not establish that rule. References to residential/datacenter proxy pools concern Jina's outbound scraping traffic and must not be mistaken for a caller-IP policy.

Our stricter hosting-IP limits for authenticated free accounts are therefore our own product decision, not a verified reproduction of Jina's rule. Preserve current anonymous behavior as requested. Classify hosting by a maintained ASN/provider signal, rather than country; Germany is not evidence of abuse. Paid plans and grandfathered Pro retain their promised limits.

## Tinybird versus Cloudflare Analytics Engine

| | Tinybird | Cloudflare Analytics Engine |
| --- | --- | --- |
| Best use | Custom SQL analytics, joins/transforms, materialized aggregates, customer-facing analytics APIs | Worker-native operational aggregates |
| Free/current billing | [Free plan](https://www.tinybird.co/docs/forward/pricing/free): 10GB, 1,000 requests/day per organization, 0.25 vCPU with limited burst | [Pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/) currently says usage is not billed |
| Published paid model | [Pricing](https://guides.tinybird.co/pricing) starts Developer at $25/month; compute, storage, and transfer affect cost | Workers Paid: 10M points/month included; then $0.25/M. 1M queries included; then $1/M |
| 100M classification requests | Not automatically 100M Tinybird reads: ingest batching, reads, compressed data size, transformations, retention, and compute must be modeled separately | One point per request would cost $22.50/month under the published future write pricing, excluding queries above the allowance and Workers cost |
| Exact billing authority? | Analytics ingestion is not the synchronous transactional account ledger | No: [adaptive sampling](https://developers.cloudflare.com/analytics/analytics-engine/sampling/) requires weighted aggregate queries |
| Retention | Depends on provisioned storage and retention design | [Three months](https://developers.cloudflare.com/analytics/analytics-engine/limits/) |

Recommendation: **do not add Tinybird for this migration**. Neon owns exact balances and recent usage summaries; PostHog owns rich account/product/AI analytics. Existing Analytics Engine panels can continue during the transition. Tinybird is worth revisiting if customer-facing historical queries require performance or retention PostHog/Neon cannot provide. Analytics Engine cannot produce exact invoices, and neither analytics product fixes credit reservation races.

The user's free PostHog arrangement was not independently verified for volume or retention. The configured CLI credential currently belongs to a different project (`Context.dev`) and is project-scoped; it cannot list organization projects. A classifier-specific ingestion configuration is still required. No classifier events were sent during research.

## Capacity arithmetic: 100 million requests per month

These are planning scenarios, **not measured capacity**. Use a 30-day month (2,592,000 seconds), one incoming HTTP request per classification request, and no assumption that batches reduce the request count.

| Shape | Incoming RPS | With two database transactions/request | In-flight requests at 500 ms average completion |
| --- | ---: | ---: | ---: |
| Monthly average | 38.58 | 77.16 transactions/s | 19.29 |
| 10x average burst | 385.80 | 771.60 transactions/s | 192.90 |
| 100x average burst | 3,858.02 | 7,716.05 transactions/s | 1,929.01 |

Two transactions is an illustrative reserve/settle design; each can execute several SQL statements. Authentication, UI reads, cleanup, billing sync, retries, analytics, and failure handling add work. Hot organization balance rows can serialize otherwise independent requests. Provider quotas and burst concurrency, rather than monthly average RPS, may be the binding constraint. Actual database sizing requires representative multi-account and single-hot-account tests with conservation assertions for balances and duplicate settlements.

Reporting Autumn usage per active account changes the number of metering calls:

| Reporting interval, continuously active accounts | 1,000 accounts | 10,000 accounts |
| --- | ---: | ---: |
| Every minute | 43.2M reports/month | 432M reports/month |
| Every five minutes | 8.64M | 86.4M |
| Every ten minutes | 4.32M | 43.2M |

This upper-bound model assumes one report every interval for every account. Send only changed accounts and aggregate compatible usage, while maintaining a durable local outbox. Ten-minute reporting does not imply ten-minute dashboard lag: serve current balances and usage from Neon. Reconciliation must survive retries, timeouts, and duplicate webhooks without charging twice. Aggregation can control Autumn call volume, but it cannot promise permanent free service or bypass separate revenue/customer limits.

Storing 100M request records at an illustrative 1KB each produces approximately 100GB of raw records each month before indexes, replication, and backups. This is arithmetic, not a measured row-size or compressed-storage estimate. Keep billing records compact; broad content analytics require explicit retention and bounded payloads. Input length and model escalation still dominate provider spend independently of request count.

## Autumn tracking: retries are not a permanent exactly-once guarantee

Source inspection is pinned to official `useautumn/autumn` commit `1f589b6ac12fa0b20e6c785ee91f0849cb6b0804`. Hosted deployment/API-version parity has not been verified; exercise these cases in the sandbox before enabling paid reporting.

- **Keys are claimed before the work completes.** Header `Idempotency-Key` and body `idempotency_key` are independent claims, with the body claim prefixed `track:`. Both are scoped to organization/environment. A duplicate returns 409 while work may be running, queued, or complete. A 409 is not proof of completed deduction. [Official track idempotency design](https://github.com/useautumn/autumn/blob/1f589b6ac12fa0b20e6c785ee91f0849cb6b0804/server/src/internal/balances/idempotency/README.md)
- **Default retention is 24 hours**, configurable per organization/route group from one hour to 30 days. After expiry the same key can be claimed again even if DynamoDB has not yet physically removed its row. Do not retry an unknown outcome indefinitely under the assumption the key deduplicates forever. [TTL configuration](https://github.com/useautumn/autumn/blob/1f589b6ac12fa0b20e6c785ee91f0849cb6b0804/shared/models/orgModels/idempotencyConfig.ts), [claim implementation](https://github.com/useautumn/autumn/blob/1f589b6ac12fa0b20e6c785ee91f0849cb6b0804/server/src/external/aws/dynamodb/idempotencyKeys/operations/claimDynamoIdempotencyKey.ts)
- **The idempotency store fails open when unavailable.** The claim implementation returns `unavailable`; the caller proceeds unless it receives `duplicate`. This prevents claiming unconditional exactly-once downstream accounting from the key alone. [Claim caller](https://github.com/useautumn/autumn/blob/1f589b6ac12fa0b20e6c785ee91f0849cb6b0804/server/src/internal/misc/idempotency/actions/checkIdempotencyKey.ts)
- **Retryable failures release the claim.** Non-409 4xx/5xx, unknown errors, and failed queue submission can release keys. Duplicate 409 keeps the key. This is an acceptance claim rather than a cached successful response/body comparison. [Wrapper](https://github.com/useautumn/autumn/blob/1f589b6ac12fa0b20e6c785ee91f0849cb6b0804/server/src/internal/misc/idempotency/withIdempotencyKey.ts)
- **Async and sync fallback can return 202.** The handler returns 200 for synchronous completion and 202 when queued, including fallback after a Redis problem. Queued responses have a null balance. The schema description currently mentions 204 for async while the handler returns 202, another reason to test the selected hosted API version. [Handler](https://github.com/useautumn/autumn/blob/1f589b6ac12fa0b20e6c785ee91f0849cb6b0804/server/src/internal/balances/handlers/handleTrack.ts), [fallback](https://github.com/useautumn/autumn/blob/1f589b6ac12fa0b20e6c785ee91f0849cb6b0804/server/src/internal/balances/track/runTrackWithRollout.ts)

For correlation, attach the immutable local outbox ID as `properties.classifier_batch_id` on each track event, alongside its immutable amount. The [public event-list schema](https://github.com/useautumn/autumn/blob/1f589b6ac12fa0b20e6c785ee91f0849cb6b0804/shared/api/events/list/eventsListResponse.ts) exposes event ID, timestamp, feature/customer, value, properties, and deductions; **it does not expose the idempotency key**. Per the schema, empty deductions mean accepted but no balance moved; null deductions mean historical/unknown breakdown. Confirm the reported quantity and intended deduction rather than checking only that an event exists.

The [event-list request schema](https://github.com/useautumn/autumn/blob/1f589b6ac12fa0b20e6c785ee91f0849cb6b0804/shared/api/events/list/eventsListParamsV2_3.ts) supports customer/feature/time filters and cursor pagination. A `filter_by` property filter also exists in source but is marked internal; avoid making public-contract guarantees about it. The documented fallback is a bounded customer/feature/time listing with local correlation-property matching. Event absence is not proof that a queued operation will never execute.

Recommended outbox states distinguish pending, accepted/awaiting confirmation, confirmed, and needs reconciliation. Keep one sender lease per immutable batch. A confirmed synchronous result may advance to confirmed; 202, transport ambiguity, or a duplicate key should trigger confirmation rather than automatic final settlement. Retrying within a verified TTL uses the same key and identical payload. Unknown outcomes approaching TTL expiry require reconciliation before a resend; never manufacture a fresh key to clear a conflict. Preserve Neon as the immediate local consumption authority and surface reporting discrepancies instead of silently double-debiting or marking them delivered.

## Access and rollout limitations

- Neon CLI read access works. No database or branch was created and no SQL mutation performed.
- Global and repository Autumn CLIs are installed, but their environment checks report no local `AUTUMN_SECRET_KEY`; existing production secrets may differ.
- PostHog CLI read access works for its configured Context.dev project only. No new project was provisioned and no external analytics event was emitted.
- Signed-in rich analytics collection must be reflected in public disclosures before enabling the ingestion key. No change to anonymous data collection is implied.
- Keep exact billing/quota checks in the request path and analytics outside it. The best-effort PostHog transport intentionally drops events on timeout/failure; it is not an accounting journal.
