import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("newsletter latency storage enforces the faster-inference preference as one invariant", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync(new URL("../migrations/postgres/0007_newsletter.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../migrations/postgres/0009_newsletter_latency.sql", import.meta.url), "utf8"));

    await db.exec(`INSERT INTO subscriber(email,wants,desired_latency_ms)
      VALUES ('valid@example.com',ARRAY['faster'],100)`);

    for (const values of [
      "'missing@example.com',ARRAY['faster'],NULL",
      "'unselected@example.com',ARRAY['private'],100",
      "'zero@example.com',ARRAY['faster'],0",
      "'large@example.com',ARRAY['faster'],60001",
    ]) {
      await expect(db.exec(`INSERT INTO subscriber(email,wants,desired_latency_ms) VALUES (${values})`)).rejects.toThrow();
    }

    const result = await db.query("SELECT email,wants,desired_latency_ms FROM subscriber");
    expect(result.rows).toEqual([{ email: "valid@example.com", wants: ["faster"], desired_latency_ms: 100 }]);
  } finally {
    await db.close();
  }
});
