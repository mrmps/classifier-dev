# Autumn subscription integration

Autumn controls subscription checkout and portal access. Neon is the authoritative wallet. Classification requests never call Autumn. An authenticated owner uses the selected workspace, not a customer ID supplied by the browser.

## Configuration

- `AUTUMN_SECRET_KEY`: appropriate sandbox or production key.
- `AUTUMN_WEBHOOK_SECRET`: Svix signing secret for `/webhooks/autumn`.
- `AUTUMN_PRO_PLAN_ID`: the configured $20 monthly Pro plan.
- `APP_ORIGIN`: trusted HTTPS application origin for checkout/portal return URLs; defaults to `https://classifier.dev`. Set an isolated preview origin for sandbox checkout.

Configure `billing.updated` delivery. Scheduled reconciliation repairs missed events with at most ten accounts per invocation and a global maximum of sixty provider calls per UTC day. The budget counts failed attempts; webhook calls are separate. Customers rotate by last attempted reconciliation, including provider failures, so unavailable customers cannot starve the rest of the queue. This repair budget is deliberately small and must be reviewed as the paid customer count grows.

## Payment proof and scope

Activation is not proof of payment. The reconciler fetches canonical customer state and `invoices.list`, then matches a paid invoice's base-plan line to the active subscription's current billing period. Invoice ID and account/period constraints prevent a second grant. New allowances wait for pending requests to settle and replace the previous included allowance; they do not stack. An overdue-payment flag does not cancel an active subscription or erase a verified paid allowance: the current period still requires its matching paid invoice.

The initial implementation supports **exactly $20 USD paid monthly Pro invoices**, with one $20 base-plan line and no refunded amount. Discounts, taxes, prorations, bundled invoices and historical invoices without recorded line items require explicit reconciliation; they do not silently grant credits. Only the first 100 paid invoices are inspected. Unsupported cases return a retryable synchronization failure and retain `reconciliation_required`.

Refunds of a previously granted current-period invoice place the account on a billing hold immediately, preventing new reservations. Once pending work settles, the remaining included allowance is removed. The grant is marked revoked and cannot be reissued for the same period. Already consumed usage is not reverse-charged. A verified new paid period clears the hold. Pending requests are not retroactively interrupted. Refund webhooks remain retryable until those requests settle and allowance removal completes. Superseded reconciliations cannot acknowledge completion or mutate refund state.

Existing Autumn customers require an explicit workspace/customer mapping before checkout so no second customer is created. Live migration, sandbox checkout and live webhook delivery remain unverified until provider credentials are configured.

## Evidence

- `bun test tests/autumn.test.ts`: signature expiry, hostile URLs, stable customer mapping, provider retries, duplicate events, paid invoice matching, pending usage, refunds, cancellation and reconciliation budget.
- `POSTGRES_TEST_URL=postgres://localhost/postgres bun test tests/autumn-native.test.ts`: twenty simultaneous reconciliations produce one grant and one transaction in native PostgreSQL. Each run creates and removes its isolated test schema.
- `npx tsc --noEmit`: shared service and dashboard contracts.

Official contract references: [Autumn webhooks](https://docs.useautumn.com/documentation/webhooks), [invoice list](https://docs.useautumn.com/api-reference/invoices/listInvoices), [customer lookup](https://docs.useautumn.com/api-reference/customers/getCustomer), [attach](https://docs.useautumn.com/api-reference/billing/attach). REST requests pin API version 2.4.0.
