# Account dashboard

The dashboard runs in the same Cloudflare Worker as the public API. Start the
local application with `npm install`, `npm run db:local`, and `npm run dev` after
configuring development credentials in `.dev.vars`; see
[PostgreSQL setup](postgres-setup.md). Open http://127.0.0.1:3000/login.

## Product flow

- Home provides a copyable setup prompt, a Default API key, client installation
  shortcuts, examples, and usage after the first request.
- API keys manages the same credentials used by applications and MCP clients.
  A workspace receives one Default key; additional named keys help attribute
  traffic. Owners/admins can reveal, copy, rename, rotate, pause and revoke keys.
  Revoking Default does not silently recreate it. Rotation invalidates the old
  secret while preserving the key's identity and usage history.
- Agents & MCP lists clients with dedicated instructions and manual setup.
  Workspace-attributed ChatGPT/hosted Claude OAuth is not implemented. Public,
  anonymous MCP remains available where a client supports it.
- Usage provides hourly/daily charts and filters. Activity lists recent requests.
  Analytics can be delayed or sampled and must not be used as a billing ledger.
- Billing displays the plan, available funds, usage and upgrade actions. No
  pay-as-you-go purchases or automatic top-ups are offered.
- All app pages retain the sidebar. `/app/onboarding` remains directly accessible
  for testing, with no ordinary navigation back to the completed onboarding.

## Local verification

Sign in through the configured WorkOS development environment, then use the
Default key with a small REST or MCP request from the client guide. Local and
hosted deployments run the same account, billing, and analytics paths against
their respective development or production credentials. Inference uses the
configured upstream model providers; inputs leave the machine.

Use API keys to verify modal creation, rename, pause/resume and rotation. Check
Usage and Activity for the actual request, switch between Pure Light and Black,
and verify navigation at desktop and mobile sizes. Invitations and membership
management remain unavailable until their hosted implementation is complete.

Run `npm run typecheck`, `npm test`, `cd cli && node --test`, and `npm run build`.
Native database/provider tests require explicit test configuration. Never point
destructive test fixtures at the production database.

## Accounting and privacy

Neon stores identity, workspace membership, encrypted API keys plus independent
hashes, and an exact transactional ledger. A personal account receives its signup
allowance once, including when first signed in before account activation. Teams
receive no duplicate signup grant. API and MCP use the same token reservation and
settlement path. Unknown provider usage remains pending rather than being guessed
or treated as free. See [billing plan](billing-plan.md) for pricing and holds.

Account analytics uses a separate Cloudflare Analytics Engine dataset, scoped by
workspace. Reads have bounded filters and query budgets. Request content capture
is disabled by default; enabling it requires the published privacy disclosure and
explicit deployment configuration. Account read endpoints are documented in
`/openapi.json`: exact balance is separate from sampled usage/activity.

## Production activation

Opening the draft does not deploy or enable the new account offering.

Before enabling APP_ACCOUNTS_ENABLED:

1. Configure and migrate the production Neon database. Set the stable dedicated
   API_KEY_ENCRYPTION_KEY secret and back it up; losing it prevents key reveal.
2. Configure WorkOS API/client credentials, cookie secret and the allowlisted
   `/api/auth/callback` redirect. Verify hosted sign-in, sign-out and identity isolation.
3. Configure Autumn products, credentials and signed webhook delivery. Verify a
   sandbox subscription, renewal, cancellation, refund and duplicate/out-of-order
   event reconciliation against the ledger.
4. Verify the retail rate card covers every routed model; exercise paid REST and
   MCP requests, insufficient funds, unknown usage and recovery on a hosted
   preview. Confirm conservative reservation amounts are acceptable.
5. Configure the account Analytics Engine binding and a scoped read token. Verify
   workspace isolation, hourly charts and activity against an actual hosted event.
6. Reconcile existing customer subscriptions and credentials before changing
   their production path.

Hosted team management and workspace OAuth clients remain separate unfinished
features, not capabilities unlocked by setting a secret. Production activation
must not advertise either as available.

## Structure

Routes compose feature components under AppShell. Server functions authenticate
requests and delegate to server modules. `src/server.ts` dispatches account,
authentication and app routes before the existing public Worker. Public text,
HTML and Markdown documentation still share source constants.

The design system uses shadcn Base UI, Nucleo icons, and shared Pure Light/Black
tokens. Keep changes to buttons, modals, tabs and surfaces in the shared primitives.
Use restrained table borders where needed for readability and spacing for other
groups. Copy prompts never contain a secret unless an explicit key-copy action
is being performed.
