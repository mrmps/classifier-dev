CLASSIFIER PRO

Pro costs $20 USD/month. Autumn's `pro` plan owns the Stripe subscription;
`autumn.config.ts` is the version-controlled catalog. The Worker checks the
paid subscription and enforces 10x minute/day quotas in the existing limiter.
The `classifier_pro_limits` feature describes that entitlement in the catalog.
Free, operator and partner access keep their existing behavior.

SETUP

1. Use the dedicated `classifier` Autumn organization. Run `npx atmn login`,
   then `npx atmn push` to preview and `npx atmn push --yes` to apply sandbox
   changes. Use `--prod` only after checking the production preview.
2. Connect that organization's live Stripe account in Autumn. Autumn owns
   Stripe webhook processing, including payment confirmation, renewals,
   cancellation and payment failure. Do not activate access from a redirect.
   OAuth rejects a Stripe account already connected to another Autumn
   organization. Autumn's separate Secret Key connection supports sharing
   that account with a dedicated per-organization webhook. Use a persistent
   restricted Stripe key, not the expiring Stripe CLI key. Verify the new
   webhook is enabled; do not disconnect the existing integration.
3. Create restricted runtime keys in Autumn's API Keys dashboard, with
   Customers Write and Billing Write (the dashboard includes their Read
   scopes). CLI login keys manage the catalog but omit billing:write, so they
   cannot create checkout or portal sessions.
4. Set AUTUMN_SECRET_KEY to the production runtime key using Wrangler secrets.
   Set BILLING_SIGNING_KEY to a separately generated 32-byte secret. It derives
   an opaque billing ID from the normalized email when an account is first
   linked. Never rotate it casually: legacy accounts that have not yet been
   linked still depend on it to resolve to the same billing ID.
5. Browser sign-in is hosted WorkOS AuthKit. Set WORKOS_API_KEY,
   WORKOS_CLIENT_ID, a 32-byte WORKOS_COOKIE_PASSWORD and WORKOS_REDIRECT_URI
   as Wrangler secrets. WORKOS_COOKIE_PASSWORD encrypts the WorkOS provider
   session and is independent of BILLING_SIGNING_KEY; browser sessions are
   WorkOS-managed and the Worker issues no session of its own.
   WORKOS_REDIRECT_URI must exactly equal BILLING_ORIGIN plus
   /v1/billing/callback, so in production set
   WORKOS_REDIRECT_URI=https://classifier.dev/v1/billing/callback; sign-in fails
   if it differs.
   In the WorkOS dashboard add the production redirect URI
   https://classifier.dev/v1/billing/callback; for local development add the
   callback under your BILLING_ORIGIN (http://localhost:8787/v1/billing/callback
   by default).
6. Merge/deploy the Worker with the BILLING binding and v2-billing migration
   from wrangler.example.toml. Secrets are kept outside git and survive deploys.

LOCAL DEVELOPMENT

Use `npx wrangler dev` with sandbox AUTUMN_SECRET_KEY, BILLING_SIGNING_KEY and
the WORKOS_* values in ignored .dev.vars. Set BILLING_ORIGIN=http://localhost:8787
locally; omit it in production, where links and billing routes are fixed to
https://classifier.dev. The local redirect URI is BILLING_ORIGIN plus
/v1/billing/callback, so with BILLING_ORIGIN=http://localhost:8787 set
WORKOS_REDIRECT_URI=http://localhost:8787/v1/billing/callback and register that
same URI in WorkOS. Remaining local sign-in session details follow the backend
configuration.
Use sandbox credentials only for test payments. The CLI reads .env separately;
keep the CLI catalog key there and the runtime key in .dev.vars.

FLOW AND STORAGE

GET /v1/billing/login redirects the browser to hosted WorkOS AuthKit. WorkOS
returns to GET /v1/billing/callback, which establishes the session cookie and
sends the browser back to /pro. Session cookies are HttpOnly, Secure and
scoped to the billing routes; lifetime and rotation follow the backend's WorkOS
session configuration. Mutations require an exact same-origin Origin header.

Authenticated browser routes:
  GET  /v1/billing/account   email, active, plan, hasKey
  POST /v1/billing/checkout  hosted confirmation URL for Pro
  POST /v1/billing/portal    hosted Stripe subscription management URL
  POST /v1/billing/key       create/replace the API key; returned only once
  POST /v1/billing/logout    revoke the session; returns the WorkOS sign-out URL

Send API keys as Authorization: Bearer classifier_pro_... on REST or MCP;
the CLI accepts CLASSIFY_API_KEY or --api-key. Keys contain an opaque account
ID and a random credential. Only credential hashes are stored. Rotation
invalidates the old key immediately and does not change the quota bucket.

Billing email and credential hashes live in a separate BillingAccount Durable
Object. A billing ID is derived from the normalized email with
BILLING_SIGNING_KEY only when an account is first linked; the backend then
persists a WorkOS user ID to original billing customer ID mapping, and later
email changes resolve through that mapping instead of rederiving. Changing an
email, or changing how emails are normalized, therefore does not reset billing
identity or the quota bucket for a linked account. Account IDs already derived
from an email HMAC are preserved: the first sign-in with a verified email links
that existing account rather than creating a new one. Keep BILLING_SIGNING_KEY
regardless — accounts that have not been linked yet still need it.
WorkOS sees the sign-in email; Autumn/Stripe receive the billing
email; neither receives classification content.
Classification analytics continue using the existing daily caller fingerprints;
no billing customer ID or email is included in analytics or the newsletter DB.

Only an active, non-past-due Pro subscription grants access. Scheduled
cancellation remains active through expires_at. Positive access is cached for
at most 60 seconds, bounded by any known expiry; inactive access for 5 seconds.
Unknown keys return 401, unpaid/expired keys 403, provider failures 503.
Anonymous requests continue to work during billing-provider outages.

VERIFICATION

Run `npm test`, `npx tsc --noEmit`, and `cd cli && node --test`.
In sandbox, verify WorkOS sign-in, checkout for $20/month, key creation, REST
and MCP headers, key replacement, portal cancellation and expiry. Confirm
that repeated checkout requests reuse the pending checkout rather than creating
parallel subscriptions. A redirect alone must never grant Pro.

Stripe and Autumn behavior is verified: the local browser smoke test used real
Autumn/Stripe sandbox checkout and real Jev classification with Cloudflare
storage simulated, and production verification on 2026-09-19 confirmed an
enabled live Stripe webhook and a live checkout charging $20 USD per month
against deployed Durable Objects. No real payment was submitted; subscription
activation, key rotation and cancellation were exercised in the sandbox.

The WorkOS sign-in path was verified in production on 2026-09-19: sign-up,
the emailed verification code, the callback, account lookup and API key
creation all completed, and the existing active Pro subscription was retained.
A live REST fast classification and a live REST smart classification both
returned 200, with policies fast 30000/minute and 200000/day and smart
2000/minute and 20000/day. A live MCP classification returned 200.
The live Stripe portal showed the existing Pro subscription at $20/month.
Sign-out returned the browser to the signed-out page; the WorkOS CLI then
confirmed that the user had no active sessions.
