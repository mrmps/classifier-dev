// Backfill users who have already signed into WorkOS. The normal sign-in path
// handles everyone else. Defaults to a read-only plan; --apply writes only Neon.
import { execFileSync } from "node:child_process";
import { neonDatabase } from "../src/server/db";
import { autumnRequest } from "../src/server/autumn";
import { provisionHostedAccount } from "../src/server/auth";
import { resolveWorkspace } from "../src/server/organizations";
import { reconcileAutumnCustomer } from "../src/server/billing-sync";

if (!process.env.DATABASE_URL || !process.env.AUTUMN_PROD_SECRET_KEY)
  throw new Error("Set DATABASE_URL and AUTUMN_PROD_SECRET_KEY.");
const apply = process.argv.includes("--apply");
const env = { APP_DB: neonDatabase(process.env.DATABASE_URL), APP_ACCOUNTS_ENABLED: "true", AUTUMN_SECRET_KEY: process.env.AUTUMN_PROD_SECRET_KEY, AUTUMN_PRO_PLAN_ID: "pro" };
const workos = (...args: string[]) => JSON.parse(execFileSync("workos", [...args, "--json"], { encoding: "utf8", env: { ...process.env, WORKOS_MODE: "agent" } }));
const active = workos("env", "list").data.find((entry: { active: boolean }) => entry.active)?.name;
if (active !== "classifier-production") throw new Error("Select the classifier-production WorkOS CLI environment before running this script.");
type User = { id: string; email: string; emailVerified: boolean; firstName?: string; lastName?: string };
type Customer = { id: string; email: string; subscriptions: Array<{ plan_id: string; status: string }> };
const customers: Customer[] = [];
let cursor: string | null = null;
do {
  const page = await autumnRequest(env, "customers.list", { limit: 100, ...(cursor ? { start_cursor: cursor } : {}) });
  if (!Array.isArray(page.list)) throw new Error("Invalid Autumn customer listing.");
  customers.push(...page.list);
  cursor = typeof page.next_cursor === "string" && page.next_cursor ? page.next_cursor : null;
} while (cursor);
const users: User[] = [];
do {
  const page = workos("user", "list", "--limit=100", ...(cursor ? [`--after=${cursor}`] : []));
  users.push(...page.data);
  cursor = page.listMetadata?.after || null;
} while (cursor);
const plan = users.filter((user) => user.emailVerified).flatMap((user) => {
  const matches = customers.filter((customer) => customer.email?.trim().toLowerCase() === user.email.trim().toLowerCase());
  if (matches.length > 1) throw new Error("Ambiguous billing identity. Resolve before migrating.");
  if (!matches.length) return [];
  const customer = matches[0];
  if (!/^[a-f0-9]{64}$/.test(customer.id)) throw new Error("Unexpected legacy customer identity.");
  return [{ user, customer }];
});
// Validate the complete plan before making any changes.
for (const { user, customer } of plan) {
  const mappings = await env.APP_DB.prepare("SELECT account_id,customer_id FROM app_autumn_customers WHERE account_id=? OR customer_id=?")
    .bind(`workos:${user.id}`, customer.id).all<{ account_id: string; customer_id: string }>();
  if (mappings.results.some((row) => row.account_id !== `workos:${user.id}` || row.customer_id !== customer.id))
    throw new Error("Conflicting existing customer mapping. No migration was started.");
}
let linked = 0;
if (apply) for (const { user, customer } of plan) {
  const accountId = await provisionHostedAccount(user, env);
  await resolveWorkspace(accountId, undefined, env);
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES(?,?) ON CONFLICT DO NOTHING").bind(accountId, customer.id).run();
  const mapping = await env.APP_DB.prepare("SELECT customer_id FROM app_autumn_customers WHERE account_id=?").bind(accountId).first<{ customer_id: string }>();
  if (mapping?.customer_id !== customer.id) throw new Error("Concurrent customer identity conflict.");
  await reconcileAutumnCustomer(env, customer.id);
  await env.APP_DB.prepare("UPDATE app_autumn_customers SET identity_verified_at=? WHERE account_id=? AND customer_id=?")
    .bind(new Date().toISOString(), accountId, customer.id).run();
  linked++;
}
console.log(JSON.stringify({ mode: apply ? "apply" : "plan", existingCustomers: customers.length, verifiedWorkosUsers: users.filter((user) => user.emailVerified).length,
  matchedUsers: plan.length, paid: plan.filter(({ customer }) => customer.subscriptions.some((s) => s.plan_id === "pro" && s.status === "active")).length,
  linked, remainingCustomersLinkOnVerifiedSignIn: customers.length - plan.length, providerWrites: 0 }));
