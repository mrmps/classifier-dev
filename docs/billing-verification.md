# Billing migration verification — 2026-09-20

These are historical foundation checks. The later
[customer-continuity verification](existing-customer-migration.md#production-verification--2026-09-20)
records the production activation checks. This release intentionally activates
hosted accounts while preserving legacy anonymous and Pro key behavior.

## Observed behavior

- PostgreSQL reservations and settlement conserve account/credential balances;
  concurrent requests cannot overspend and duplicate refunds apply once.
- Token pricing uses provider-reported input/output/cache counts and versioned
  decimal rate cards. Unknown measurements remain unknown, not zero.
- NanoUSD accumulation makes 257 tiny requests cost the same as one batch;
  included/paid refund sources are retained. Token and old item-credit settlement
  cannot be mixed. Grandfathered accounts cannot enter either reservation mode.
- Personal signup credit does not replenish, teams start unfunded, and returning
  to Free grants nothing. Hosted Pro is $20/month with $20 included; personal
  Free signup grants $5 once. Runtime demo billing has been removed.

## Checks run

- `npm run test:e2e`: 12 passed against real classifier.dev. Includes 100-item
  dimensional classification, multi-label, MCP, validation, and three real Gemini
  Smart escalations. This checks current production inference, not new billing.
- Explicit `LIVE_TOKEN_BILLING=true` run of `tests/token-billing-flow.test.ts`:
  the real TypeSafe model `jev-1.13.0` reported 312 input tokens. A **test-only**
  $0.042/million input rate produced 13,104 nanoUSD and a conservative two-credit
  wallet debit; actual counts appeared in the PostgreSQL-backed snapshot.
  This uses isolated PGlite, not hosted Neon or Autumn.
- Native PostgreSQL contention suites: five passed against an isolated schema on
  the Oregon Neon project, including 20 concurrent
  reservations, 20 token settlements, and competing settlement/refund commands.
  Temporary test schemas were removed. Production-main migration apply/reapply
  passed after the same operation was rehearsed on a clone and a snapshot taken.
- CLI: 25 passed. Production Vite build and typecheck passed before subsequent
  concurrent key/agent UI edits.
- Latest whole-repository run: 662 passed, 13 opt-in tests/hooks skipped, zero
  failures (3,550 assertions). Typecheck and production build passed; CLI tests
  passed 25/25. The remote native run separately exercised the gated tests.

## Not yet verified or implemented

The production Neon schema and secrets are configured, with pooled runtime and
direct migration URLs kept separate. Customer linkage, signup/current-paid-period
grants, checkout session creation, payment portal access, signed webhook
idempotency, and hosted Fast/Smart/MCP settlement were verified in the later
rollout. No real new charge, cancellation, future renewal or natural provider
webhook delivery was exercised. Aggregated Autumn usage reporting remains
unimplemented; missing token measurements require explicit reconciliation.

Datacenter-specific authenticated-free limits and optional key budgets are not
yet implemented. Rich PostHog transport is tested but disconnected: enable it
only with classifier.dev credentials and updated collection disclosures. Current
PostHog CLI credentials belong to a different project. No live payment test,
100M-request capacity guarantee or zero-cost guarantee is claimed. See
[customer continuity](existing-customer-migration.md) for the verified migration
and [the billing plan](billing-plan.md) for broader rollout goals.
