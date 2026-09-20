# Dollar billing and usage

Users see dollars; classification usage is priced per token and accounted for with integer credits. The new Pro plan is **$20/month including $20 of usage**. Launch policy is Jev at published inference cost and Gemini escalation at 20% above its published token cost. Smart without escalation has no surcharge. The candidate versioned card and subsidy/margin analysis are in [pricing economics](pricing-economics.md); production activation remains gated on complete billing integration.

This document distinguishes implemented account metering from production activation. Token charging and account analytics have real-provider evidence; hosted sign-in, sandbox payments and customer migration still require end-to-end verification before charging production customers.

## Delivery plan and acceptance evidence

This is one change: dashboard, account API, token wallet, subscription control plane,
analytics, and deployment configuration ship together in one reviewable PR. The
current production deployment stays intact until the replacement is verified.

1. Implement the versioned Jev-at-cost/Gemini-plus-20% rate card and exact Neon
   settlement. Prove concurrent reservations cannot overspend, fractional charges
   accumulate correctly, and duplicate settlement cannot charge twice.
2. Connect authenticated REST and MCP to the same inference/metering path. Prove
   provider failures, missing usage, unsupported models, and exhausted balances
   are handled deliberately before enabling paid requests.
3. Connect Autumn checkout, portal, signed webhooks, and paid-period grants. Prove
   payment from canonical invoice data, not redirects or active subscription
   status alone; duplicate events must never replenish twice.
4. Connect dashboard and account API analytics to Analytics Engine. Prove tenant
   isolation, bounded queries, sampling-aware aggregates, unavailable states, and
   exact wallet figures independent of analytics availability.
5. Exercise the complete regional preview with real inference and sandbox billing;
   capture dashboard desktop/mobile evidence and run migrations, typecheck,
   tests, CLI checks, and the production build.
6. Rehearse customer/data migration and rollback before production cutover. A
   passing local simulator is not proof of this last step.

Each acceptance item remains open until its corresponding behavior has actually
been observed. Missing deployment credentials or unverified external contracts
must be recorded as blockers, not bypassed with fabricated success.

## Agreed product behavior

- **Signup credit is $5, one-time and personal.** Each user gets only one personal workspace/plan and one initial grant. There is no daily or monthly free replenishment.
- **Teams have independent balances.** New team workspaces start with zero usage credit. Creating or switching to a team neither transfers personal credit nor creates another free grant. Members consume the team's balance; per-key/agent budgets are an optional further control.
- **Subscriptions replenish paid usage.** Pro costs $20/month and includes $20 at the published retail token rates. Paid tiers have higher rate/usage limits. Other tier prices, allowances, seat counts, rollover rules, and exact rate limits in the demo are provisional unless separately approved.
- **No top-ups for this release.** Neither manual purchases of extra credit nor automatic top-ups are enabled. An exhausted account receives a clear API error and can select an available subscription plan; there are no surprise overage charges.
- **Anonymous access stays as it is today.** Do not reduce its allowance or require signup as part of this migration. Authenticated free accounts on hosting/datacenter IPs should have stricter limits; paid plans retain their documented limits. Country alone does not identify abuse. No specific Jina residential-versus-datacenter rule has been verified; see [migration research](./migration-research.md).
- **One pricing and limits system for everyone.** Existing customers migrate into the new system at the verified cutover. No grandfathered tier or permanent parallel legacy billing path. Keep the current deployment working until the replacement and customer migration are ready.
- **Use one dollar presentation.** Balances, consumption, budgets, and subscription allowances display USD. The current accounting scale is 100,000 integer credits per dollar; choose rounding and minimum-charge rules explicitly with the retail token schedule before billing is enabled.

Token usage should come from provider-reported counts, preserving unknown values as unavailable. The production schedule must define Fast/Smart input and output rates, how Smart escalation is charged, cached tokens if relevant, and what happens when a provider omits usage. Counting one item as one credit is only the existing demo meter; it is not the approved token pricing model.

## Storage, billing, and analytics

**One Neon project** holds accounts, memberships, organizations, API credentials, agent configuration, newsletter data, exact local credit consumption/reservations, and durable billing-report state. Newsletter access remains scoped with database permissions. The target region is Oregon (`aws-us-west-2`) with Cloudflare Worker execution nearby; TypeSafe's current ingress maps there. The existing newsletter project is in Virginia, so this target requires an explicit consolidation/migration. Region evidence and its limitations are in [migration research](./migration-research.md).

**Autumn manages commercial state:** plans, subscriptions, entitlements, hosted checkout/Stripe lifecycle, verified purchases, renewal, cancellation, and the billing portal. Neon owns immediate request authorization and consumed-credit accounting. Verified provider changes reconcile into Neon; an arbitrary checkout return URL never grants funds.

**Autumn usage reporting is aggregated by active account**, outside the request path. The design target is 100M HTTP requests/month, so calling Autumn once or twice per classification is unsuitable for the desired cost structure. A durable outbox sends immutable usage batches with retries and reconciliation. A strict reporting-call budget must count retries, reconciliation, and billing operations, alert before exhaustion, and delay reports locally when needed. Batching alone does not guarantee a free bill: active-account count, interval, and Autumn's separate customer/revenue allowances matter. Do not promise permanent free hosted Autumn service.

**Neon serves exact current customer balances and billing records**, so billing does not wait for Autumn synchronization or sampled analytics. **Cloudflare Analytics Engine owns customer-facing and operational analytics**: account/key/agent attribution, requests, tokens, estimated cost breakdowns, latency, errors and sampled activity. Credentials and transport secrets are excluded/redacted; any content capture must be bounded and disclosed. Anonymous collection stays unchanged. Account-scoped dashboard queries must enforce tenant access and account for sampling. This dashboard wiring remains to be implemented.

Do not introduce PostHog or Tinybird during this migration. The user explicitly accepts Analytics Engine's three-month retention and potentially sampled activity, without guaranteed complete request logs. AE does not supply exact invoices or a permanent raw-content archive. Current limits and capacity assumptions are documented in [migration research](./migration-research.md); its earlier PostHog recommendation is superseded by this decision.

## Accounting requirements

The intended paid path reserves the account's available credits atomically before inference, then settles actual token-priced usage or refunds failure once. Optional per-key/agent budgets must be checked in the same transaction as the shared balance. Concurrent requests, retries, stale reservations, plan renewals, cancellations, and organization switching must conserve the balance. Network errors with unknown commit outcomes require reconciliation rather than blind re-execution.

The local subscription simulator uses synthetic periods and grants for demonstration. Production grants must follow verified billing events and their actual periods. Downgrading or canceling to Free must never grant the signup allowance again. Team creation, invitation acceptance, and personal-workspace recreation must not multiply or transfer free funds.

Autumn idempotency keys are not a permanent exactly-once guarantee. Its inspected source uses a default 24-hour claim, permits queued acceptance, and returns duplicate 409 before proving completion. Store a stable outbox ID in the event properties and verify uncertain outcomes; never resend old ambiguous batches with a fresh key to clear a conflict. Details, source commit, and hosted-version caveats are in [migration research](./migration-research.md#autumn-tracking-retries-are-not-a-permanent-exactly-once-guarantee).

## Product surfaces

- **Billing (`/app/credits`):** dollar balance, selected subscription, included usage, renewal/cancellation information, and transaction history. No Add funds or auto-top-up flow. Local actions must be labeled simulated.
- **Usage (`/app/usage`):** Spend / Tokens / Requests, date and credential filters, timeline, and sampling-aware AE aggregates. Show unknown token counts as unavailable and distinguish estimated retail charges from exact wallet balances.
- **Keys and agents:** credentials belong to the selected organization, and any optional spending cap uses the same dollar units and server-side policy as billing.
- **Onboarding and team creation:** one personal signup allowance; teams start unfunded. UI navigation or successful checkout navigation is never payment proof.

Keep existing shared layout and formatting conventions. These requirements do not by themselves assert that every screen or backend path has completed the migration.

## Implemented foundation and production boundary

The implementation includes the Postgres/Neon account and key model, one-time personal signup credit, dollar balances, token reservations and settlement, Autumn paid-invoice reconciliation, and account-scoped AE dashboard/API queries. No PostHog transport remains. Local subscription actions are still explicitly simulated; hosted actions use Autumn.

Account REST and MCP now reserve before each provider attempt and settle actual reported tokens using the versioned retail card. Direct Jev is pinned; unpriced fallback transports/models cannot spend account funds. Missing measurements retain a review hold instead of inventing a zero charge. Conservative provider-context bounds reserve $0.00276 per Jev attempt and approximately $0.953 per Gemini attempt until the whole request settles. Large Smart batches can therefore fail admission despite a low eventual charge: reservation sizing remains a launch limitation. Merely finding an existing Autumn customer does not establish a verified workspace mapping or authorize a grant.

Production rollout is blocked until these are complete:

1. Validate the implemented versioned token charging on a regional deployment. Resolve conservative Smart reservation sizing and operational reconciliation of missing provider usage before exposing it to paying customers.
2. Configure the correct Neon project, WorkOS identity, Autumn environment/customer mapping and webhook verification, and account-scoped AE bindings/read credentials. Publish the rich-data collection disclosure before enabling it.
3. Test real provider sandbox checkout, renewal, cancellation, failed payment, duplicate/out-of-order billing hooks, existing customer mappings, ambiguous tracking outcomes, and the reporting-call budget. Local simulations or transport mocks do not satisfy this requirement.
4. Run end-to-end request and account flows against the regional deployment, plus realistic burst/concurrency tests. Verify conservation of credits, one-time grants, team isolation, no surprise charges, and anonymous compatibility.
5. Rehearse the database/customer migration and rollback, compare balances/entitlements, then migrate production. Do not retire existing storage or overwrite customer entitlements merely because the new build passes unit tests.

See [migration research](./migration-research.md) for verified access limitations, region evidence, provider sources, and capacity estimates. No particular throughput, provider cost, or completed production migration is claimed by this document.
