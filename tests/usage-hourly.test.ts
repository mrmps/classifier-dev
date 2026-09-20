import { expect, test } from "bun:test";
import { database } from "./support/postgres";
import { demoLogin } from "../src/server/auth";
import { performAction } from "../src/server/agents";
import { getSnapshot } from "../src/server/accounts";
import type { AppEnv } from "../src/server/db";

test("snapshot groups complete usage by UTC hour, credential, and type beyond the log cap", async () => {
  const env: AppEnv = { APP_DB: database(), APP_DEMO: "true", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters" };
  await demoLogin(
    new Request("http://localhost/login", {
      headers: { Origin: "http://localhost" },
    }),
    env,
  );
  const first = await performAction(
    "local-demo",
    { type: "create-key", name: "Production" },
    env,
  );
  const second = await performAction(
    "local-demo",
    { type: "create-key", name: "Preview" },
    env,
  );
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const previous = new Date(today.getTime() - 3_600_000);
  const writes = Array.from({ length: 111 }, (_, index) => {
    const timestamp = new Date(index < 101 ? previous : today);
    timestamp.setUTCMinutes(index % 60);
    return env.APP_DB.prepare(
      "INSERT INTO app_usage(id,account_id,agent_id,items,credits,status,created_at,usage_type,input_tokens,output_tokens) VALUES(?,'local-demo',?,1,1,'completed',?,'API',?,1)",
    ).bind(
      `request-${index}`,
      first.agentId,
      timestamp.toISOString(),
      index === 0 ? null : 10,
    );
  });
  writes.push(
    env.APP_DB.prepare(
      "INSERT INTO app_usage(id,account_id,agent_id,items,credits,status,created_at,usage_type) VALUES('other','local-demo',?,2,2,'completed',?,'MCP')",
    ).bind(second.agentId, today.toISOString()),
  );
  for (const status of ["pending", "refunded"])
    writes.push(
      env.APP_DB.prepare(
        "INSERT INTO app_usage(id,account_id,agent_id,items,credits,status,created_at,usage_type) VALUES(?,'local-demo',?,9,9,?,?,'API')",
      ).bind(status, first.agentId, status, today.toISOString()),
    );
  await env.APP_DB.batch(writes);
  const snapshot = await getSnapshot("local-demo", env);
  expect(snapshot.usage).toHaveLength(100);
  expect(snapshot.usageAggregates).toHaveLength(3);
  const priorHour = snapshot.usageAggregates.find(
    (row) => row.hour === previous.toISOString().replace(".000Z", "Z"),
  );
  expect(priorHour).toMatchObject({
    day: previous.toISOString().slice(0, 10),
    requests: 101,
    credits: 101,
    inputTokens: null,
    outputTokens: 101,
    keyId: first.agentId,
  });
  const currentHour = snapshot.usageAggregates.find(
    (row) =>
      row.hour === today.toISOString().replace(".000Z", "Z") &&
      row.keyId === first.agentId,
  );
  expect(currentHour).toMatchObject({
    requests: 10,
    credits: 10,
    inputTokens: 100,
    outputTokens: 10,
  });
  expect(
    snapshot.usageAggregates.find((row) => row.keyId === second.agentId),
  ).toMatchObject({ type: "MCP", requests: 1, credits: 2 });
});
