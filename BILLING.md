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
   A Stripe account already connected to another Autumn organization cannot
   be reused without disconnecting that organization. Do not disconnect a
   working integration as part of this setup.
3. Create restricted runtime keys in Autumn's API Keys dashboard, with
   Customers Write and Billing Write (the dashboard includes their Read
   scopes). CLI login keys manage the catalog but omit billing:write, so they
   cannot create checkout or portal sessions.
4. Set AUTUMN_SECRET_KEY to the production runtime key using Wrangler secrets.
   Set BILLING_SIGNING_KEY to a separately generated 32-byte secret. Preserve
   it: it derives opaque account IDs from normalized billing email addresses.
   Changing it requires a deliberate account migration.
5. Email uses NEWSLETTER_RESEND_API_KEY and the verified NEWSLETTER_FROM sender.
   RESEND_API_KEY is a fallback; BILLING_FROM may override the sender.
   Confirm that the selected Resend key can send from that domain.
6. Merge/deploy the Worker with the BILLING binding and v2-billing migration
   from wrangler.example.toml. Secrets are kept outside git and survive deploys.

LOCAL DEVELOPMENT

Use `npx wrangler dev` with sandbox AUTUMN_SECRET_KEY and BILLING_SIGNING_KEY
in ignored .dev.vars. Set BILLING_ORIGIN=http://localhost:8787 locally; omit it
in production, where links and billing routes are fixed to https://classifier.dev.
Use sandbox credentials only for test payments. The CLI reads .env separately;
keep the CLI catalog key there and the runtime key in .dev.vars.

FLOW AND STORAGE

POST /v1/billing/login with {email} sends a 15-minute single-use email link.
The token is in the URL fragment, immediately removed by /pro, and exchanged
via POST /v1/billing/session with {token}. Session cookies are HttpOnly,
Secure, SameSite=Strict, expire after 30 days and are scoped to /v1/billing.
Each new sign-in replaces the previous browser session. Mutations require
an exact same-origin Origin header. Email requests are throttled per caller
and per account; unavailable throttling fails closed.

Authenticated browser routes:
  GET  /v1/billing/account   email, active, plan, hasKey
  POST /v1/billing/checkout  hosted confirmation URL for Pro
  POST /v1/billing/portal    hosted Stripe subscription management URL
  POST /v1/billing/key       create/replace the API key; returned only once
  POST /v1/billing/logout    revoke the session

Send API keys as Authorization: Bearer classifier_pro_... on REST or MCP;
the CLI accepts CLASSIFY_API_KEY or --api-key. Keys contain an opaque account
ID and a random credential. Only credential hashes are stored. Rotation
invalidates the old key immediately and does not change the quota bucket.

Billing email and credential hashes live in a separate BillingAccount Durable
Object. Autumn/Stripe receive the billing email, never classification content.
Classification analytics continue using the existing daily caller fingerprints;
no billing customer ID or email is included in analytics or the newsletter DB.

Only an active, non-past-due Pro subscription grants access. Scheduled
cancellation remains active through expires_at. Positive access is cached for
at most 60 seconds, bounded by any known expiry; inactive access for 5 seconds.
Unknown keys return 401, unpaid/expired keys 403, provider failures 503.
Anonymous requests continue to work during billing-provider outages.

VERIFICATION

Run `npm test`, `npx tsc --noEmit`, and `cd cli && node --test`.
In sandbox, verify email sign-in, checkout for $20/month, key creation, REST
and MCP headers, key replacement, portal cancellation and expiry. Confirm
that repeated checkout requests reuse the pending checkout rather than creating
parallel subscriptions. A redirect alone must never grant Pro.

The local browser smoke test for this change used real Autumn/Stripe sandbox
checkout and real Jev classification, with email delivery intercepted and
Cloudflare storage simulated. Production email delivery and live checkout
must be verified after the live Stripe connection is completed.
