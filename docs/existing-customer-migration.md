# Existing customer continuity

The hosted dashboard links a verified WorkOS email to the original billing
customer: HMAC-SHA256 of the normalized email with `BILLING_SIGNING_KEY`. Keep
that secret stable. Never create a `workspace_…` customer as a fallback for a
personal account. An ambiguous or conflicting mapping requires manual recovery,
not another checkout. Once verified, the mapping survives email changes and
temporary Autumn outages.

Paid customers retain their Autumn customer and Stripe subscription. The current
paid invoice grants the dashboard's $20 period allowance once. Non-paying
customers remain Free and receive the existing $5 signup allowance once. Retry,
refresh and repeated backfill do not replenish spent balances. Existing legacy
Pro API keys and their 10× limits remain on the original billing path; they are
not replaced or listed as newly issued dashboard keys.

Existing subscribers opening checkout go to their existing billing portal,
including scheduled or past-due subscriptions. This migration does not charge,
cancel or replace subscriptions.

## Operations

Apply the normal PostgreSQL migrations first, including
`0007_billing_identity.sql`. Deploy with the existing billing secrets and
`APP_ACCOUNTS_ENABLED=true`.

`scripts/link-existing-customers.ts` defaults to a read-only plan. It matches
verified WorkOS users against unique existing Autumn billing emails. Supply
`DATABASE_URL` and `AUTUMN_PROD_SECRET_KEY` through the environment and select the
`classifier-production` WorkOS CLI profile. Add `--apply` to link those accounts
and reconcile their current paid invoices. Restore the previous CLI profile
afterwards. Remaining legacy customers link automatically when they next visit
the dashboard with their verified billing email.

The deployed Autumn runtime credential needs customer and billing read/write
scopes. The `atmn` 2.0.8 OAuth credential does not include billing scopes and
cannot open the payment portal or create checkout sessions. Do not replace a
working runtime credential with that CLI credential. Use a restricted dashboard
key and install it as the Worker's `AUTUMN_SECRET_KEY`.

`scripts/verify-customer-migration.ts` requires `POSTGRES_TEST_URL` and
`AUTUMN_PROD_SECRET_KEY`. It reads actual provider records into an isolated,
temporary PostgreSQL schema, checks paid/free entitlements and repeat-sync
balance preservation, then removes only that temporary schema. It never writes
to Autumn or Stripe.

`npm run test:e2e:accounts` accepts `CLASSIFIER_ACCOUNT_API_KEY` and optionally
`CLASSIFIER_BASE_URL` (defaults to production). Run it separately with a paid and
a free account's disposable key. It makes small, billable Fast/Smart/MCP requests,
checks settlement, invalid-request refunds, usage reads and authentication.
Revoke disposable keys afterwards; never substitute a real customer's secret.

## Production verification — 2026-09-20

- Rehearsed all 17 existing billing customers: 5 paid, 12 non-paying. Every paid
  invoice matched the current period and the repeated reconciliation preserved
  spent credit.
- Linked all 3 verified WorkOS users: 1 Pro, 2 Free. Repeated the production
  backfill and confirmed unchanged customer IDs, balances and signup grants.
- Stripe still had exactly 5 active $20/month subscriptions, none canceling.
- Observed the live signed-in Pro dashboard with its $20 balance and existing
  renewal date, and the separate non-paying dashboard showing Free.
- Retried initial identity verification through the live paid dashboard. It
  recovered the original mapping and retained its balance; Autumn still had
  exactly 17 customers, all with their original legacy IDs.
- Unit coverage includes conflicting identities, unverified email, provider
  failures, exhausted signup allowance and duplicate-checkout prevention. The
  duplicate-checkout regression test failed when its guard was disabled and
  passed after restoration. Native PostgreSQL coverage includes 20 simultaneous
  initial links with one customer mapping and one paid grant.

Snapshot before migration: `pre-existing-customer-link-2026-09-20`
(`snap-lively-breeze-a6hnlig4`). Final deployment, including the updated #79
prerequisite: `5bcc39b0-f350-4e15-a8ad-8aecfafaa8e0`.

No new purchase or cancellation was exercised against real customers. Legacy
key compatibility was checked through the existing automated billing suite;
customer secrets were not rotated or extracted for live testing.
