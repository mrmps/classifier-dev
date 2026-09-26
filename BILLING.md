WORKSPACE BILLING

Plans change rate limits and included credits, nothing else. Pro is $20/month
with $20 of usage, three seats and 10x classification quotas. Scale is
$200/month with $200 of usage, unlimited seats and 100x quotas.
WorkOS handles sign-in. Workspace API keys use the classifier_agent_ prefix.
REST and MCP share the workspace balance and quota bucket.

Pay-as-you-go top-ups ($5-$1,000, whole dollars) add purchased funds that
never expire. Owners may enable auto recharge: when the balance falls below
their threshold, the saved payment method is charged their recharge amount,
bounded by an optional calendar-month maximum. Auto charges are claimed in
app_auto_topup_attempts first (single-flight lock, one-hour failure cooldown,
monthly-cap ledger) and the wallet is only ever credited by invoice-verified
reconciliation, exactly once per invoice id.

Autumn manages Stripe checkout and subscriptions. Verified paid invoices grant
each period's allowance once; returning from checkout does not activate a plan.
Customers manage subscriptions at /app/plans, top-ups and auto recharge at
/app/credits, and credentials at /app/keys.

SETUP

- Set AUTUMN_SECRET_KEY, AUTUMN_WEBHOOK_SECRET, AUTUMN_PRO_PLAN_ID,
  AUTUMN_SCALE_PLAN_ID and AUTUMN_TOPUP_PLAN_ID as Worker secrets. The runtime
  key needs customer and billing read/write permissions. Plan ids are the
  autumn.config.ts slugs (pro, scale, top_up); push config with npx atmn push.
- Keep BILLING_SIGNING_KEY stable: it derives personal billing customer IDs
  from verified email addresses. Customer mappings and subscriptions remain
  in place when credentials rotate.
- Configure /webhooks/autumn for billing.updated events. Scheduled reconciliation
  repairs missed events and sweeps auto recharges. Billing state and credit
  reservations live in Neon.
- Use npm run dev with sandbox credentials in ignored .dev.vars. Production
  builds and deployments use wrangler.example.toml through CI.

VERIFICATION

Run npm test, npm run typecheck and the CLI tests. Account integration checks
are documented in docs/account-verification.md. Verify checkout, invoice grants,
top-up purchases, auto recharge caps, repeat reconciliation, cancellation and
key revocation with sandbox accounts.
