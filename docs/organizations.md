# Organization management

WorkOS owns organization membership, invitation delivery/acceptance and roles.
Every organization read or mutation checks active WorkOS membership and current
permissions. The workspace cookie selects a workspace; it grants no access.
The app stores each organization's balance, keys and separate Autumn customer.
Organizations receive no additional personal signup credit.

Before deploying to another WorkOS environment, run:

```
bun scripts/configure-workos-organizations.ts
```

Supply that environment's `WORKOS_API_KEY`. The script adds environment-level
`owner`, `admin`, and `member` roles as needed and preserves existing permissions.
`classifier:workspace:manage` allows invitations and workspace management;
`classifier:workspace:own` additionally allows billing and member role/removal
changes. Custom roles with those permissions work too. No organization-level
role overrides are created.

Invitations use WorkOS's default email delivery and hosted AuthKit acceptance.
The application's initiate-login URI must point to `/api/auth/sign-in`; that
route preserves invitation tokens and AuthKit's PKCE flow. Switching to an
organization refreshes the AuthKit session. Accepted memberships appear on the
next dashboard load, without a webhook or a local membership synchronization job.

Seats follow the workspace's plan (Free: one, Pro: three). Pending, unexpired
invitations reserve a seat. Team mutations take a two-minute database lease so
concurrent app requests cannot consume the same final seat or remove the last
owner. External changes in the WorkOS dashboard are outside this lease; they are
reflected on the next request. Removed members fall back to their personal
dashboard, but explicit requests for the old workspace fail closed. Shared API
keys remain active after a person is removed, as stated in the removal dialog.

Verification:

```
bun test tests/organizations.test.ts
bun scripts/smoke-organizations.ts
```

The smoke script requires a sandbox (`sk_test_`) key, uses isolated in-memory
PostgreSQL, and cleans up its WorkOS users and organization. It exercises actual
WorkOS creation, invitation acceptance, role changes and revocation. Sandbox
email delivery is simulated; it does not prove production mailbox delivery.
