WORKSPACE BILLING

Pro is $20/month with $20 of usage, three seats and 10x classification quotas.
WorkOS handles sign-in. Workspace API keys use the classifier_agent_ prefix.
REST and MCP share the workspace balance and quota bucket.

Autumn manages Stripe checkout and subscriptions. Verified paid invoices grant
each period's allowance once; returning from checkout does not activate Pro.
Customers manage subscriptions at /app/plans and credentials at /app/keys.

SETUP

- Set AUTUMN_SECRET_KEY, AUTUMN_WEBHOOK_SECRET and AUTUMN_PRO_PLAN_ID as Worker
  secrets. The runtime key needs customer and billing read/write permissions.
- Keep BILLING_SIGNING_KEY stable: it derives personal billing customer IDs
  from verified email addresses. Customer mappings and subscriptions remain
  in place when credentials rotate.
- Configure /webhooks/autumn for billing.updated events. Scheduled reconciliation
  repairs missed events. Billing state and credit reservations live in Neon.
- Use npm run dev with sandbox credentials in ignored .dev.vars. Production
  builds and deployments use wrangler.example.toml through CI.

VERIFICATION

Run npm test, npm run typecheck and the CLI tests. Account integration checks
are documented in docs/account-verification.md. Verify checkout, invoice grants,
repeat reconciliation, cancellation and key revocation with sandbox accounts.
