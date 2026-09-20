import { beforeEach, expect, test } from "bun:test";
import { database } from "./support/postgres";
import type { AppDatabase } from "../src/server/db";
import { refundTokenReservation, settleTokenReservation } from "../src/server/token-ledger";
import { completeReservation } from "../src/server/usage";

let db: AppDatabase;
const time = "2026-09-20T00:00:00.000Z";
beforeEach(async () => {
  db = database();
  for (const account of ["split", "batch"]) {
    await db.prepare("INSERT INTO app_accounts(id,email,name,balance,reset_at,created_at,period_start) VALUES(?,?,?,1000,?,?,?)")
      .bind(account, `${account}@example.com`, account, time, time, time).run();
    await db.prepare("INSERT INTO app_agents(id,account_id,name,client,token_hash,prefix,created_at) VALUES(?,?,?,'API',?,'prefix',?)")
      .bind(`key-${account}`, account, account, `hash-${account}`, time).run();
  }
});

async function reserve(account: string, credits: number, paid = 0): Promise<string> {
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("UPDATE app_accounts SET balance=balance-?,paid_balance=paid_balance-? WHERE id=?").bind(credits, paid, account),
    db.prepare("UPDATE app_agents SET used=used+? WHERE id=?").bind(credits, `key-${account}`),
    db.prepare("INSERT INTO app_usage(id,account_id,agent_id,items,credits,paid_credits,status,created_at,metering_mode) VALUES(?,?,?,1,?,?,'pending',?,'tokens')")
      .bind(id, account, `key-${account}`, credits, paid, time),
  ]);
  return id;
}
const charge = (nanodollars: bigint) => ({ nanodollars, version: "test-v1" });
async function wallet(account = "split") {
  return db.prepare("SELECT balance,paid_balance,fractional_spend_nano FROM app_accounts WHERE id=?").bind(account).first();
}

test("257 tiny token requests and one batch debit exactly the same wallet amount", async () => {
  for (let index = 0; index < 257; index++) {
    await settleTokenReservation(db, await reserve("split", 1), charge(42n));
  }
  const batch = await settleTokenReservation(db, await reserve("batch", 3), charge(257n * 42n));
  expect(batch.chargedCredits).toBe(2);
  expect(await wallet("split")).toEqual(await wallet("batch"));
  expect(await wallet()).toEqual({ balance: 998, paid_balance: 0, fractional_spend_nano: 794 });
  expect(await db.prepare("SELECT SUM(actual_nano)::text AS nano,SUM(credits) AS credits FROM app_usage WHERE account_id='split'").first())
    .toEqual({ nano: "10794", credits: 2 });
});

test("settlement returns unused credits to their original included and paid sources", async () => {
  await db.prepare("UPDATE app_accounts SET balance=100,paid_balance=60 WHERE id='split'").run();
  const id = await reserve("split", 70, 30);
  const settled = await settleTokenReservation(db, id, charge(450_001n), { inputTokens: 123, outputTokens: null });
  expect(settled).toEqual({ status: "completed", chargedCredits: 46, refundedCredits: 24, actualNanodollars: 450_001n, rateVersion: "test-v1" });
  expect(await wallet()).toEqual({ balance: 54, paid_balance: 54, fractional_spend_nano: 1 });
  expect(await db.prepare("SELECT credits,paid_credits,reserved_credits,reserved_paid_credits,input_tokens,output_tokens,reporting_status FROM app_usage WHERE id=?").bind(id).first())
    .toEqual({ credits: 46, paid_credits: 6, reserved_credits: 70, reserved_paid_credits: 30, input_tokens: 123, output_tokens: null, reporting_status: "pending" });
  expect(await refundTokenReservation(db, id)).toEqual(settled);
  expect(await settleTokenReservation(db, id, charge(0n))).toEqual(settled);
  expect(await wallet()).toEqual({ balance: 54, paid_balance: 54, fractional_spend_nano: 1 });
});

test("missing measurements remain pending for review until a measured cost is supplied", async () => {
  const id = await reserve("split", 5);
  expect(await settleTokenReservation(db, id, null, { inputTokens: 500, outputTokens: null }))
    .toEqual({ status: "review", chargedCredits: 0, refundedCredits: 0, actualNanodollars: null, rateVersion: null });
  expect(await wallet()).toEqual({ balance: 995, paid_balance: 0, fractional_spend_nano: 0 });
  expect(await db.prepare("SELECT status,actual_nano,reporting_status,output_tokens FROM app_usage WHERE id=?").bind(id).first())
    .toEqual({ status: "pending", actual_nano: null, reporting_status: "review", output_tokens: null });
  const settled = await settleTokenReservation(db, id, charge(20_000n));
  expect(settled.chargedCredits).toBe(2);
  expect(await db.prepare("SELECT input_tokens,output_tokens FROM app_usage WHERE id=?").bind(id).first()).toEqual({ input_tokens: 500, output_tokens: null });
});

test("actual charge cannot exceed its reservation even when other funds are available", async () => {
  const id = await reserve("split", 1);
  await expect(settleTokenReservation(db, id, charge(10_001n))).rejects.toThrow("exceeds the reservation");
  expect(await wallet()).toEqual({ balance: 999, paid_balance: 0, fractional_spend_nano: 0 });
  expect(await db.prepare("SELECT status,actual_nano FROM app_usage WHERE id=?").bind(id).first()).toEqual({ status: "pending", actual_nano: null });
  expect((await refundTokenReservation(db, id)).refundedCredits).toBe(1);
  expect(await wallet()).toEqual({ balance: 1000, paid_balance: 0, fractional_spend_nano: 0 });
});

test("racing settle and refund commands produce exactly one final outcome", async () => {
  await db.prepare("UPDATE app_accounts SET balance=100,paid_balance=60 WHERE id='split'").run();
  const id = await reserve("split", 70, 30);
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => index % 2
    ? refundTokenReservation(db, id)
    : settleTokenReservation(db, id, charge(120_001n))));
  expect(new Set(results.map((value) => JSON.stringify({ ...value, actualNanodollars: value.actualNanodollars?.toString() })) ).size).toBe(1);
  const completed = results[0].status === "completed";
  expect(await wallet()).toEqual({ balance: completed ? 87 : 100, paid_balance: 60, fractional_spend_nano: completed ? 1 : 0 });
  expect(await db.prepare("SELECT used FROM app_agents WHERE id='key-split'").first()).toEqual({ used: completed ? 13 : 0 });
});

test("refund restores original paid funds and preserves previously accumulated fractional spend", async () => {
  await settleTokenReservation(db, await reserve("split", 1), charge(10n));
  await db.prepare("UPDATE app_accounts SET paid_balance=60 WHERE id='split'").run();
  const before = await wallet();
  const id = await reserve("split", 50, 20);
  const results = await Promise.all(Array.from({ length: 10 }, () => refundTokenReservation(db, id)));
  expect(results.every((value) => value.status === "refunded" && value.refundedCredits === 50)).toBe(true);
  expect(await wallet()).toEqual(before);
});

test("zero-cost measurements settle a zero reservation, while invalid inputs fail closed", async () => {
  const id = await reserve("split", 0);
  expect((await settleTokenReservation(db, id, charge(0n))).chargedCredits).toBe(0);
  const legacy = await reserve("batch", 1);
  await expect(settleTokenReservation(db, legacy, charge(-1n))).rejects.toThrow("nonnegative bigint");
  await expect(settleTokenReservation(db, legacy, charge(1n), { inputTokens: -1, outputTokens: null })).rejects.toThrow("Token count");
  await expect(settleTokenReservation(db, "missing", charge(1n))).rejects.toThrow("Reservation not found");
});

test("old credit settlement and refund cannot mutate token reservations", async () => {
  const id = await reserve("split", 7);
  const reservation = { id, accountId: "split", agentId: "key-split", cost: 7 };
  for (const success of [true, false]) {
    await expect(completeReservation(reservation, { APP_DB: db }, success)).rejects.toThrow("require token settlement");
    expect(await wallet()).toEqual({ balance: 993, paid_balance: 0, fractional_spend_nano: 0 });
    expect(await db.prepare("SELECT status FROM app_usage WHERE id=?").bind(id).first()).toEqual({ status: "pending" });
  }
  await expect(db.prepare("UPDATE app_usage SET metering_mode='credits' WHERE id=?").bind(id).run()).rejects.toThrow("mode cannot change");
  await refundTokenReservation(db, id);
  expect((await settleTokenReservation(db, id, charge(1n))).status).toBe("refunded");
  expect(await wallet()).toEqual({ balance: 1000, paid_balance: 0, fractional_spend_nano: 0 });
});
