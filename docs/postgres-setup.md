# Neon runtime and migrations

The dashboard uses PostgreSQL through Neon's HTTP driver. `DATABASE_URL` is the
connection secret; `APP_DB` is an application adapter created from that secret,
not a Cloudflare D1 binding. Account mutations stay disabled in production until
`APP_ACCOUNTS_ENABLED` is explicitly enabled after migration and billing checks.

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

Run `npm install`, then `npm run demo`. This applies `migrations/postgres/*.sql`
to the development branch before starting the repository's Vite/Cloudflare
runtime at http://127.0.0.1:3000. Migration execution requires Bun. The local demo
persists its account data in that Neon branch; only local Durable Objects/KV use
`.wrangler/state`.

A regular `postgres://localhost/...` URL does **not** work in this Worker: Neon
HTTP requires Neon's query endpoint. Native PostgreSQL URLs are supported by the
Bun migration runner and optional database tests, which use TCP. Tests use PGlite
or a separately supplied test database; they do not substitute SQLite for PG.

## Production

Set the repository Actions secret `DATABASE_URL` to the production Neon's pooled
URL and `DATABASE_URL_UNPOOLED` to its direct URL. CI migrates through the direct
URL and passes only the pooled URL to Wrangler's `--secrets-file`. Neither is
rendered into `wrangler.toml` or printed. Other existing Worker secrets remain
configured in Cloudflare.

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
