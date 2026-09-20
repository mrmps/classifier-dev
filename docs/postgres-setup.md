# Neon runtime and migrations

The dashboard uses PostgreSQL through Neon's HTTP driver. `DATABASE_URL` is the
connection secret; `APP_DB` is an application adapter created from that secret,
not a Cloudflare D1 binding. Account mutations stay disabled in production until
`APP_ACCOUNTS_ENABLED` is enabled in the production template after migration,
hosted sign-in, billing, and signed-webhook checks pass.

## Development

Use a development branch in the same Neon project, with its own connection URL.
Put `DATABASE_URL` in the gitignored `.dev.vars` file using the connection string
from Neon, including TLS parameters. The file is loaded by both the Worker dev
runtime and `npm run db:local`. Keep production credentials out of this file.

Set `API_KEY_ENCRYPTION_KEY` to a securely generated secret of at least 32
characters in `.dev.vars` (and as a Worker secret for hosted environments).
Keep it stable and backed up: API keys use AES-GCM encryption for explicit
owner/admin reveal, in addition to separate authentication hashes. Changing this
secret without re-encrypting the stored keys makes existing keys unrecoverable;
their authentication hashes continue to work. `WORKOS_COOKIE_PASSWORD` is a
fallback for existing hosted configurations, but a dedicated encryption secret
avoids coupling API key storage to session-secret rotation.

Migration `0003_api_key_management.sql` preserves existing keys. Older keys that
only have a hash remain valid but cannot be revealed until rotated. New
workspaces receive one Default key on their first dashboard load. Revoking it
does not cause a replacement to be generated. Default and named keys have the
same permissions and work with both the API and supported MCP clients.

Run `npm install`, `npm run db:local`, then `npm run dev`. This applies
`migrations/postgres/*.sql` to the development branch before starting the
repository's Vite/Cloudflare runtime at http://127.0.0.1:3000. Migration
execution requires Bun. Local development uses the same product paths as hosted
deployments, backed by development credentials; only local Durable Objects/KV
use `.wrangler/state`.

Drizzle owns the typed schema in
`drizzle/schema.ts` and executes migrations over Neon's serverless transport;
`npm run db:generate` shows the SQL implied by a schema change. Review that SQL
and add the approved statements as the next ordered file in
`migrations/postgres/`, which remains the immutable deployment history.
The generated `drizzle/0001_free_wendell_rand.sql` corresponds to the already
ordered `0007_billing_identity.sql`; deploy only through `npm run db:migrate`,
not by applying the generated SQL a second time.

A regular `postgres://localhost/...` URL does **not** work in this Worker: Neon
HTTP requires Neon's query endpoint. The Drizzle migration runner uses Neon's
WebSocket transport so CI and local development exercise the same serverless
connection path. Tests use PGlite or a separately supplied test database; they
do not substitute SQLite for PG.

## Production

Set the repository Actions secret `DATABASE_URL` to the production Neon's pooled
URL and `DATABASE_URL_UNPOOLED` to its direct URL. CI migrates through the direct
URL and passes only the pooled URL to Wrangler's `--secrets-file`. Neither is
rendered into `wrangler.toml` or printed. Other existing Worker secrets remain
configured in Cloudflare.

The production account database contains the following application tables:
`app_accounts`, `app_workspaces`, `app_memberships`, `app_invitations`,
`app_sessions`, `app_agents`, `app_usage`, `app_transactions`,
`app_billing_commands`, `app_autumn_customers`, `app_autumn_events`,
`app_autumn_grants`, and `app_autumn_sync_budget`. `app_schema_migrations`
records the immutable migration name and checksum.

Newsletter addresses are in `subscriber` in the same `classify` project and
`neondb` database, using `DATABASE_URL`. Subscriber consent has no account or
workspace foreign key. Administrative credentials can access both kinds of data;
the public privacy page describes this shared storage explicitly.

The consolidation script `scripts/consolidate-newsletter.ts` takes a consistent
source snapshot, preserves every column (including identity values, microsecond
timestamps, preferences and unsubscribe state), rejects conflicting destination
rows (including destination-only rows), and verifies exact equality before
committing. Copying requires the source freeze trigger. Its transaction also
records `data:newsletter-consolidation-v1` and the source checksum in
`app_schema_migrations` and freezes the destination table. Before the first
deployment, the gate rechecks the destination checksum and write guard. After
Wrangler deploy succeeds, activation records `data:newsletter-activated-v1`
with the same checksum and atomically removes the guard. Subsequent deploys
accept the activation receipt so new subscribers and preference changes can
continue normally; the copy script refuses to overwrite an activated database.
Before production cutover,
create and verify a source backup branch. Freeze source subscriber writes with
`scripts/newsletter-freeze.sql`, run the copy, deploy, and verify source rows
against the destination again. During the brief freeze, confirmation requests
on the old Worker fail with a retryable 503; existing confirmation tokens remain
valid. Keep the source project and backup branch intact. Never replay the copy
over destination changes: conflicts deliberately abort instead of overwriting
consent. Rollback requires reconciling new destination subscribers before
removing the source freeze with `scripts/newsletter-unfreeze.sql`.

For a manual deployment, configure the Worker with the pooled URL using `npx
wrangler secret put DATABASE_URL` and supply the direct URL as `DATABASE_URL` to
`npm run db:migrate` through your secret manager or environment. Do not paste
connection strings into commands that will remain in shell history. Migrations
are transactional, ordered, and checksum-verified; editing an already-applied
migration is rejected.

The production template targets `aws:us-west-2`, supported by Wrangler 4.122's
placement schema. Cloudflare runs fetch handlers in a nearby Cloudflare data
center, not inside AWS itself. Placement does not move an existing Neon project
or Durable Object, and is not a residency guarantee. Confirm the Neon primary
and upstream latency before activating the production migration. See
[Cloudflare placement](https://developers.cloudflare.com/workers/configuration/placement/).

Do not enable the new account offering until retail token rates, Autumn events,
legacy Pro handling, reconciliation, and end-to-end production checks are ready.
Adding the database secret alone does not enable paid account traffic.
