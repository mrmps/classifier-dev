import { expect, test } from "bun:test";
import { database } from "./support/postgres";
import { parseCreditInteger, postgresDatabase } from "../src/server/db";

test("Postgres binding preserves literal question marks and caller values", async () => {
  const db = database();
  const query = db.prepare("SELECT '?' AS literal, ?::text AS value /* ? */");
  const value = "Robert'); DROP TABLE app_accounts; --";
  expect(await query.bind(value).first()).toEqual({ literal: "?", value });
  expect(await query.bind("another").first()).toEqual({ literal: "?", value: "another" });
  await expect(query.first()).rejects.toThrow("parameter count");
});

test("Postgres numeric aggregates preserve integer credits", async () => {
  const db = database();
  expect(await db.prepare("SELECT SUM(v) AS total, COUNT(*) AS count FROM (VALUES (3000000000::bigint),(4000000000::bigint)) AS credits(v)").first())
    .toEqual({ total: 7000000000, count: 2 });
  expect(() => parseCreditInteger("9007199254740993")).toThrow("safe range");
});

test("transactions retry aborted serialization failures but not uncertain commits", async () => {
  let attempts = 0;
  const db = postgresDatabase(async () => {
    attempts++;
    if (attempts === 1) throw Object.assign(new Error("serialization"), { code: "40001" });
    return [{ results: [], meta: { changes: 1 } }];
  });
  expect((await db.batch([db.prepare("SELECT 1")]))[0].meta.changes).toBe(1);
  expect(attempts).toBe(2);
  let networkAttempts = 0;
  const uncertain = postgresDatabase(async () => { networkAttempts++; throw new Error("Connection lost after commit"); });
  await expect(uncertain.batch([uncertain.prepare("SELECT 1")])).rejects.toThrow("Connection lost");
  expect(networkAttempts).toBe(1);
});
