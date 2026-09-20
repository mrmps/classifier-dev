# Account integration evidence

Historical foundation checks from 2026-09-20 are recorded below. The later
[customer-continuity verification](existing-customer-migration.md#production-verification--2026-09-20)
supersedes the activation blockers: hosted sign-in, existing customer linkage,
paid/free API paths, checkout, payment portal and signed webhook handling have
now been checked in production. Account activation is intentional in this release.

- `RUN_LIVE_AE=1 bun --env-file=.secrets.env tests/live/account-analytics.live.ts`:
  actual Cloudflare writes and all four SQL query shapes passed. One synthetic
  tenant returned one request, three items, 120 input tokens and the exact fixture
  cost; the second tenant was excluded. The temporary protected Worker was
  deleted. Two synthetic events remain until AE retention expires.
- `LIVE_TOKEN_BILLING=true bun --env-file=.dev.vars --env-file=.secrets.env test tests/app-http.test.ts`:
  real pinned TypeSafe inference passed through the account HTTP reservation and
  settlement adapter. 314 input tokens cost 13,188 nanodollars; two integer credits
  were debited with the fractional remainder preserved. This test uses an isolated
  local PostgreSQL-compatible database, not the deployed account endpoint.
- Native PostgreSQL tests cover twenty simultaneous paid-period reconciliations
  producing one grant and transaction, concurrent fractional settlements, and
  settlement/refund contention. A remote run against an isolated schema on the
  Oregon Neon project passed all five native tests (33 assertions); the tests use
  a 30-second bound because cold remote contention exceeds Bun's 5-second default.
- Account analytics/access/query-budget tests: 15 passed, 51 assertions. Hosted
  queries enforce tenant and global budgets before provider reads and fail closed.
- Final combined check after parallel edits froze: 662 passed, 13 skipped, zero
  failures (3,550 assertions). Typecheck and Vite production build passed; CLI
  tests passed (25). The three final HTTP regressions failed before their fixes
  and passed afterward: scalar input aliases and settlement-error request IDs.
- Browser checks covered Home, API keys and modal cancellation, agent catalog and
  Codex setup, Usage, Billing and plans. The agent guide also fits a 390px viewport
  without horizontal overflow. Captures are attached to the draft PR.

## Deployment prerequisites

The production `classification_api` Neon project is in Oregon. Its default
`main` branch was snapshotted as `pre-account-dashboard-2026-09-20`; migration
was first rehearsed twice on a disposable clone, then applied twice to `main`.
All six checksummed migrations are present and the 107 legacy
`classification_requests` rows remain intact. GitHub Actions now has a pooled
`DATABASE_URL` for the Worker and a direct `DATABASE_URL_UNPOOLED` for
migrations; the Worker has the pooled URL and a dedicated API-key encryption
secret. The later customer-continuity rollout also applied migration 0007 and
verified the hosted billing paths before enabling account access.

## Historical activation blockers and remaining limitations

Production Worker secrets include the WorkOS credentials, restricted Autumn
customer/billing key, verified `pro` plan ID, database URL, API-key encryption key,
and webhook signing secret. The configured webhook passed direct signed and
duplicate-delivery checks; a natural provider delivery and a real new purchase
or cancellation were not exercised. Existing customer mapping was rehearsed
and applied after a snapshot; snapshot restoration was not tested. Hosted organization management
remains disabled pending its full membership lifecycle. Stricter free-tier
datacenter policy and aggregated Autumn usage outbox are not implemented. No
100M-request load/cost claim is proven. Exact per-request Neon accounting still
needs capacity measurement. Conservative Smart holds may reject large batches;
missing token measurements require explicit reconciliation. Autumn paid-invoice
support is deliberately narrow; see `autumn-integration.md`.

These limits remain explicit; activation does not claim untested payment
lifecycle events, organization management, disaster recovery or high-volume capacity.
