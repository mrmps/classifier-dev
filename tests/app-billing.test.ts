import { beforeEach, describe, expect, test } from "bun:test";
import { database } from "./support/postgres";
import { demoLogin } from "../src/server/auth";
import { performAction, validateAppAction } from "../src/server/agents";
import { getSnapshot } from "../src/server/accounts";
import { authorizeAndReserve, completeReservation } from "../src/server/usage";
import { performBillingAction } from "../src/server/billing";
import { centsToCredits, formatCreditsUsd } from "../src/lib/billing";
import type { AppEnv } from "../src/server/db";
let env: AppEnv;
beforeEach(async () => {
  env = { APP_DB: database(), APP_DEMO: "true", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters" };
  await demoLogin(
    new Request("http://localhost/login", {
      headers: { Origin: "http://localhost" },
    }),
    env,
  );
});
/** Existing paid funds remain usable, even though new purchases are unavailable. */
async function seedHistoricalBalance() {
  await env.APP_DB.batch([
    env.APP_DB.prepare(
      "INSERT INTO app_transactions(id,account_id,idempotency_key,kind,amount_cents,credits,created_at) VALUES('historical','local-demo','historical','top_up',1000,1000000,'2026-01-01')",
    ),
    env.APP_DB.prepare(
      "UPDATE app_accounts SET balance=balance+1000000,paid_balance=paid_balance+1000000 WHERE id='local-demo'",
    ),
  ]);
}
async function key() {
  const k = await performAction(
    "local-demo",
    { type: "create-key", name: "Billing test" },
    env,
  );
  return {
    id: k.agentId!,
    request: new Request("http://localhost/v1/classify", {
      headers: { Authorization: `Bearer ${k.secret}` },
    }),
  };
}
describe("dollar billing ledger", () => {
  test("uses exact integer credit conversion and meaningful sub-cent spend", () => {
    expect(centsToCredits(1)).toBe(1000);
    expect(formatCreditsUsd(1)).toBe("$0.00001");
    expect(formatCreditsUsd(50000)).toBe("$0.50");
  });
  test("stale top-up and automatic purchase actions are rejected without changing balances", async () => {
    const before = await getSnapshot("local-demo", env);
    for (const action of [
      { type: "billing-top-up", amountCents: 1000, idempotencyKey: "stale" },
      {
        type: "billing-auto-top-up",
        enabled: true,
        thresholdCents: 100,
        amountCents: 500,
        monthlyCapCents: 500,
      },
      {
        type: "billing-auto-top-up",
        enabled: false,
        thresholdCents: 100,
        amountCents: 500,
        monthlyCapCents: 500,
      },
    ]) {
      await expect(
        performAction("local-demo", action as never, env),
      ).rejects.toThrow("Only subscriptions");
      await expect(
        performBillingAction("local-demo", action as never, env),
      ).rejects.toThrow("Only subscriptions");
    }
    const after = await getSnapshot("local-demo", env);
    expect(after.billing.availableCredits).toBe(
      before.billing.availableCredits,
    );
    expect(after.billing.transactions).toEqual(before.billing.transactions);
  });
  test("consumes included funds first, then restores the exact paid portion on failure", async () => {
    const k = await key();
    await seedHistoricalBalance();
    await env.APP_DB.prepare(
      "UPDATE app_accounts SET balance=paid_balance+2 WHERE id='local-demo'",
    ).run();
    const r = (await authorizeAndReserve(k.request, env, 5))!;
    let s = await getSnapshot("local-demo", env);
    expect(s.billing.paidCredits).toBe(999997);
    expect(s.billing.includedCredits).toBe(0);
    await completeReservation(r, env, false);
    await completeReservation(r, env, false);
    s = await getSnapshot("local-demo", env);
    expect(s.billing.paidCredits).toBe(1000000);
    expect(s.billing.includedCredits).toBe(2);
  });
  test("paid funds survive expiry and stale reservation recovery", async () => {
    const k = await key();
    await seedHistoricalBalance();
    await env.APP_DB.prepare(
      "UPDATE app_accounts SET balance=paid_balance,reset_at='2020-01-02' WHERE id='local-demo'",
    ).run();
    const r = (await authorizeAndReserve(k.request, env, 5))!;
    await env.APP_DB.prepare(
      "UPDATE app_usage SET created_at='2020-01-01' WHERE id=?",
    )
      .bind(r.id)
      .run();
    await env.APP_DB.prepare(
      "UPDATE app_accounts SET reset_at='2020-01-02' WHERE id='local-demo'",
    ).run();
    const s = await getSnapshot("local-demo", env);
    expect(s.billing.paidCredits).toBe(1000000);
    expect(s.billing.availableCredits).toBe(1000000);
  });
  test("subscription is idempotent; cancellation retains allowance until reset", async () => {
    await seedHistoricalBalance();
    const action = {
      type: "billing-subscribe" as const,
      plan: "pro" as const,
      idempotencyKey: "plan1",
    };
    await performAction("local-demo", action, env);
    await performAction("local-demo", action, env);
    let s = await getSnapshot("local-demo", env);
    expect(s.billing.availableCredits).toBe(3000000);
    expect(
      s.billing.transactions.filter((t) => t.kind === "subscription"),
    ).toHaveLength(1);
    await performAction(
      "local-demo",
      { type: "billing-subscribe", plan: "free", idempotencyKey: "cancel1" },
      env,
    );
    s = await getSnapshot("local-demo", env);
    expect(s.billing.cancelAtPeriodEnd).toBe(true);
    expect(s.billing.availableCredits).toBe(3000000);
    await env.APP_DB.prepare(
      "UPDATE app_accounts SET reset_at='2020-01-02' WHERE id='local-demo'",
    ).run();
    s = await getSnapshot("local-demo", env);
    expect(s.billing.plan).toBe("free");
    expect(s.billing.paidCredits).toBe(1000000);
    expect(s.billing.availableCredits).toBe(1000000);
  });
  test("previously enabled automatic purchases cannot refill an exhausted paid subscription", async () => {
    const k = await key();
    await performAction(
      "local-demo",
      { type: "billing-subscribe", plan: "pro", idempotencyKey: "p" },
      env,
    );
    await env.APP_DB.prepare(
      "UPDATE app_accounts SET auto_top_up_enabled=1,auto_top_up_threshold_cents=100,auto_top_up_amount_cents=500,auto_top_up_cap_cents=500,balance=1,bonus_granted=1 WHERE id='local-demo'",
    ).run();
    const reservation = (await authorizeAndReserve(k.request, env, 1))!;
    await completeReservation(reservation, env, true);
    await completeReservation(reservation, env, true);
    const snapshot = await getSnapshot("local-demo", env);
    expect(snapshot.billing.availableCredits).toBe(0);
    expect(
      snapshot.billing.transactions.filter((t) => t.kind === "auto_top_up"),
    ).toHaveLength(0);
    await expect(authorizeAndReserve(k.request, env, 1)).rejects.toThrow();
  });
  test("aggregates complete history beyond latest 100 logs and preserves unknown tokens", async () => {
    const k = await key();
    for (let i = 0; i < 101; i++) {
      const r = (await authorizeAndReserve(k.request, env, 1, 1, {
        type: "API · Single-label",
      }))!;
      await completeReservation(
        r,
        env,
        true,
        i === 0 ? undefined : { inputTokens: 10, outputTokens: 1 },
      );
    }
    const s = await getSnapshot("local-demo", env);
    expect(s.usage).toHaveLength(100);
    expect(s.usageAggregates[0].requests).toBe(101);
    expect(s.usageAggregates[0].credits).toBe(101);
    expect(s.usageAggregates[0].inputTokens).toBeNull();
    expect(s.usageAggregates[0].keyId).toBe(k.id);
  });
  test("concurrent requests cannot overdraw the shared workspace balance", async () => {
    const k = await key();
    await env.APP_DB.prepare(
      "UPDATE app_accounts SET balance=3 WHERE id='local-demo'",
    ).run();
    const results = await Promise.allSettled([
      authorizeAndReserve(k.request, env, 2),
      authorizeAndReserve(k.request, env, 2),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const snapshot = await getSnapshot("local-demo", env);
    expect(snapshot.credits.balance).toBe(1);
    expect(snapshot.agents[0].used).toBe(2);
  });
  test("historical purchase records remain visible after subscribing", async () => {
    await seedHistoricalBalance();
    await performAction(
      "local-demo",
      { type: "billing-subscribe", plan: "pro", idempotencyKey: "p" },
      env,
    );
    const snapshot = await getSnapshot("local-demo", env);
    expect(snapshot.billing.paidCredits).toBe(1000000);
    expect(
      snapshot.billing.transactions.find((t) => t.id === "historical"),
    ).toMatchObject({ kind: "top_up", amountCents: 1000, credits: 1000000 });
  });
  test("simultaneous identical subscription commands grant one allowance", async () => {
    const action = {
      type: "billing-subscribe" as const,
      plan: "pro" as const,
      idempotencyKey: "same",
    };
    await Promise.all([
      performAction("local-demo", action, env),
      performAction("local-demo", action, env),
    ]);
    const snapshot = await getSnapshot("local-demo", env);
    expect(snapshot.billing.includedCredits).toBe(2000000);
    expect(snapshot.billing.transactions).toHaveLength(1);
  });
  test("subscription renewal is idempotent and resets per-key usage counters", async () => {
    const k = await key();
    const r = (await authorizeAndReserve(k.request, env, 3))!;
    await completeReservation(r, env, true);
    await performAction(
      "local-demo",
      { type: "billing-subscribe", plan: "pro", idempotencyKey: "p" },
      env,
    );
    expect((await getSnapshot("local-demo", env)).agents[0].used).toBe(0);
    await env.APP_DB.prepare(
      "UPDATE app_accounts SET reset_at='2020-01-02' WHERE id='local-demo'",
    ).run();
    await getSnapshot("local-demo", env);
    const snapshot = await getSnapshot("local-demo", env);
    expect(
      snapshot.billing.transactions.filter((t) => t.kind === "subscription"),
    ).toHaveLength(2);
    expect(snapshot.billing.includedCredits).toBe(2000000);
  });
  test("upgrades grant only the difference, preserve period and key usage, and replay safely", async () => {
    const k = await key();
    await seedHistoricalBalance();
    await performAction(
      "local-demo",
      { type: "billing-subscribe", plan: "pro", idempotencyKey: "pro" },
      env,
    );
    const r = (await authorizeAndReserve(k.request, env, 3))!;
    await completeReservation(r, env, true);
    const before = await getSnapshot("local-demo", env);
    const change = {
      type: "billing-subscribe" as const,
      plan: "max" as const,
      idempotencyKey: "max",
    };
    await performAction("local-demo", change, env);
    await performAction("local-demo", change, env);
    const after = await getSnapshot("local-demo", env);
    expect(after.billing.plan).toBe("max");
    expect(after.billing.availableCredits).toBe(
      before.billing.availableCredits + 11000000,
    );
    expect(after.billing.paidCredits).toBe(1000000);
    expect(after.credits.resetAt).toBe(before.credits.resetAt);
    expect(after.agents[0].used).toBe(3);
    const upgrades = after.billing.transactions.filter(
      (t) => t.kind === "subscription",
    );
    expect(upgrades).toHaveLength(2);
    expect(upgrades.find((t) => t.amountCents === 8000)?.credits).toBe(
      11000000,
    );
    await expect(
      performAction("local-demo", { ...change, plan: "scale" }, env),
    ).rejects.toThrow("different details");
  });
  test("downgrades wait for renewal; selecting the current plan cancels without granting credits", async () => {
    await performAction(
      "local-demo",
      { type: "billing-subscribe", plan: "scale", idempotencyKey: "scale" },
      env,
    );
    const initial = await getSnapshot("local-demo", env);
    await performAction(
      "local-demo",
      { type: "billing-subscribe", plan: "pro", idempotencyKey: "down" },
      env,
    );
    let snapshot = await getSnapshot("local-demo", env);
    expect(snapshot.billing.scheduledPlan).toBe("pro");
    expect(snapshot.billing.plan).toBe("scale");
    expect(snapshot.billing.availableCredits).toBe(
      initial.billing.availableCredits,
    );
    await performAction(
      "local-demo",
      { type: "billing-subscribe", plan: "scale", idempotencyKey: "keep" },
      env,
    );
    snapshot = await getSnapshot("local-demo", env);
    expect(snapshot.billing.scheduledPlan).toBeNull();
    expect(snapshot.billing.transactions).toHaveLength(1);
    await performAction(
      "local-demo",
      { type: "billing-subscribe", plan: "pro", idempotencyKey: "down-again" },
      env,
    );
    await env.APP_DB.prepare(
      "UPDATE app_accounts SET reset_at='2020-01-02' WHERE id='local-demo'",
    ).run();
    snapshot = await getSnapshot("local-demo", env);
    expect(snapshot.billing.plan).toBe("pro");
    expect(snapshot.billing.includedCredits).toBe(2000000);
    expect(
      snapshot.billing.transactions.filter((t) => t.amountCents === 2000),
    ).toHaveLength(1);
  });
  test("a period renewal clears legacy automatic-purchase settings without buying balance", async () => {
    await performAction(
      "local-demo",
      { type: "billing-subscribe", plan: "pro", idempotencyKey: "p" },
      env,
    );
    await env.APP_DB.prepare(
      "UPDATE app_accounts SET auto_top_up_enabled=1,reset_at='2020-01-02' WHERE id='local-demo'",
    ).run();
    const snapshot = await getSnapshot("local-demo", env);
    const settings = await env.APP_DB.prepare(
      "SELECT auto_top_up_enabled FROM app_accounts WHERE id='local-demo'",
    ).first<{ auto_top_up_enabled: number }>();
    expect(settings?.auto_top_up_enabled).toBe(0);
    expect(
      snapshot.billing.transactions.filter((t) => t.kind === "auto_top_up"),
    ).toHaveLength(0);
    expect(snapshot.billing.includedCredits).toBe(2000000);
  });
  test("a downgrade cannot put existing members and prepared invitations above the plan seat limit", async () => {
    await performAction(
      "local-demo",
      { type: "billing-subscribe", plan: "scale", idempotencyKey: "s" },
      env,
    );
    await env.APP_DB.prepare(
      "INSERT INTO app_workspaces(account_id,kind,mode,created_at) VALUES('local-demo','personal','demo','2026-09-20') ON CONFLICT DO NOTHING",
    ).run();
    await env.APP_DB.prepare(
      "INSERT INTO app_memberships(identity_account_id,workspace_id,role,joined_at) VALUES('local-demo','local-demo','owner','2026-09-20') ON CONFLICT DO NOTHING",
    ).run();
    for (let i = 0; i < 3; i++)
      await env.APP_DB.prepare(
        "INSERT INTO app_invitations(id,workspace_id,email,role,created_at,created_by,status) VALUES(?,'local-demo',?,'member','2026-09-20','local-demo','prepared')",
      )
        .bind(`invite${i}`, `member${i}@test.dev`)
        .run();
    await expect(
      performAction(
        "local-demo",
        { type: "billing-subscribe", plan: "pro", idempotencyKey: "p" },
        env,
      ),
    ).rejects.toThrow("3 seats");
    const snapshot = await getSnapshot("local-demo", env);
    expect(snapshot.billing.plan).toBe("scale");
    expect(snapshot.billing.scheduledPlan).toBeNull();
  });
  test("production cannot mint credits and rejects invalid payment settings", async () => {
    await expect(
      performBillingAction(
        "workos:user",
        { type: "billing-subscribe", plan: "pro", idempotencyKey: "x" },
        env,
      ),
    ).rejects.toThrow("No charge");
    for (const a of [
      { type: "billing-top-up", amountCents: 1, idempotencyKey: "x" },
      {
        type: "billing-auto-top-up",
        enabled: true,
        thresholdCents: 1000,
        amountCents: 500,
        monthlyCapCents: 500,
      },
      { type: "billing-top-up", amountCents: Infinity, idempotencyKey: "x" },
    ])
      expect(() => validateAppAction(a)).toThrow();
  });
});
