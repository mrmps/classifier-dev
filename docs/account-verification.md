# Account integration evidence

Verified on 2026-09-20; production account activation remains disabled.

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
  settlement/refund contention. Focused HTTP/reservation/native tests: 13 passed,
  70 assertions before the extra live test.
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

The deploy workflow now requires the GitHub Actions `DATABASE_URL` secret. The
repository secret-name inventory on 2026-09-20 did not contain it. Merging this PR
will not complete deployment until an approved production Neon database is
configured and its migrations/rollback have been rehearsed. Do not substitute
the local development branch URL. The workflow also provisions that URL as a
Worker secret; account access still remains disabled independently.

## Activation blockers

Real WorkOS sign-in and Autumn sandbox checkout/webhook lifecycle have not been
verified: their credentials are not configured locally. Existing customer/key
migration and production rollback have not been rehearsed. Hosted organization
management remains disabled pending its full membership lifecycle. Stricter
free-tier datacenter policy and aggregated Autumn usage outbox are not implemented.
No 100M-request load/cost claim is proven. Exact per-request Neon accounting needs
capacity measurement. Conservative Smart holds may reject large batches; missing
token measurements require explicit reconciliation. Autumn paid-invoice support
is deliberately narrow; see `autumn-integration.md`.

These limitations prohibit describing the full migration as production-ready.
