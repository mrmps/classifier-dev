import { expect, test } from "bun:test";
import { database } from "./support/postgres";
import { provisionTestAccount } from "./support/account";
import { performAction } from "../src/server/agents";
import { getSnapshot } from "../src/server/accounts";
import { authorizeAndReserve, completeReservation } from "../src/server/usage";
import type { AppEnv } from "../src/server/db";

test("pausing an API key blocks usage and resuming retains its credential and spend", async () => {
  const env: AppEnv = { APP_DB: database(), APP_ACCOUNTS_ENABLED: "true", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters" };
  await provisionTestAccount(
    new Request("http://localhost/login", {
      headers: { Origin: "http://localhost" },
    }),
    env,
  );
  const created = await performAction(
    "local-demo",
    { type: "create-key", name: "Script" },
    env,
  );
  const agentId = created.agentId!;
  const request = new Request("http://localhost/v1/classify", {
    headers: { Authorization: `Bearer ${created.secret}` },
  });
  await performAction("local-demo", { type: "pause", agentId }, env);
  const paused = await getSnapshot("local-demo", env);
  await expect(authorizeAndReserve(request, env, 1)).rejects.toThrow();
  expect((await getSnapshot("local-demo", env)).credits.balance).toBe(
    paused.credits.balance,
  );
  await performAction("local-demo", { type: "resume", agentId }, env);
  expect(
    (await getSnapshot("local-demo", env)).agents.find(
      (agent) => agent.id === agentId,
    )?.status,
  ).toBe("pending");
  const reservation = await authorizeAndReserve(request, env, 1);
  expect(reservation).not.toBeNull();
  await completeReservation(reservation!, env, true);
  const used = (await getSnapshot("local-demo", env)).agents.find(
    (agent) => agent.id === agentId,
  )!;
  await performAction("local-demo", { type: "pause", agentId }, env);
  await expect(authorizeAndReserve(request, env, 1)).rejects.toThrow();
  await performAction("local-demo", { type: "resume", agentId }, env);
  expect(
    (await getSnapshot("local-demo", env)).agents.find(
      (agent) => agent.id === agentId,
    ),
  ).toEqual({ ...used, status: "connected" });
  expect((await authorizeAndReserve(request, env, 1))?.agentId).toBe(agentId);
});

test("legacy tiny and zero connection caps no longer block usage and new connections have no app-level cap", async () => {
  const env: AppEnv = { APP_DB: database(), APP_ACCOUNTS_ENABLED: "true", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters" };
  await provisionTestAccount(
    new Request("http://localhost/login", {
      headers: { Origin: "http://localhost" },
    }),
    env,
  );
  await env.APP_DB.prepare(
    "UPDATE app_accounts SET bonus_granted=1 WHERE id='local-demo'",
  ).run();
  const initialBalance = (await getSnapshot("local-demo", env)).credits.balance;
  let expectedCost = 0;
  for (const legacyCap of [0, 3, null]) {
    const created = await performAction(
      "local-demo",
      { type: "create-key", name: `Cap ${legacyCap}` },
      env,
    );
    if (legacyCap !== null) {
      await env.APP_DB.prepare(
        "UPDATE app_agents SET credit_limit=? WHERE id=?",
      )
        .bind(legacyCap, created.agentId)
        .run();
    }
    const request = new Request("http://localhost/v1/classify", {
      headers: { Authorization: `Bearer ${created.secret}` },
    });
    // Exceeds both historical caps and the old database default of 1,000.
    const reservation = (await authorizeAndReserve(request, env, 1001))!;
    await completeReservation(reservation, env, true);
    expectedCost += 1001;
    const snapshot = await getSnapshot("local-demo", env);
    const connection = snapshot.agents.find(
      (agent) => agent.id === created.agentId,
    )!;
    expect(connection.used).toBe(1001);
    expect("limit" in connection).toBe(false);
    expect(
      await env.APP_DB.prepare(
        "SELECT credits,status FROM app_usage WHERE agent_id=?",
      )
        .bind(created.agentId)
        .first(),
    ).toMatchObject({ credits: 1001, status: "completed" });
    expect(snapshot.credits.balance).toBe(initialBalance - expectedCost);
    await expect(
      performAction(
        "local-demo",
        { type: "set-limit", agentId: created.agentId, limit: 10 } as never,
        env,
      ),
    ).rejects.toThrow("Unknown account action");
  }
});

test("connections atomically share workspace balance and exhausted workspaces reject further usage", async () => {
  const env: AppEnv = { APP_DB: database(), APP_ACCOUNTS_ENABLED: "true", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters" };
  await provisionTestAccount(
    new Request("http://localhost/login", {
      headers: { Origin: "http://localhost" },
    }),
    env,
  );
  const requests: Request[] = [];
  for (const name of ["First", "Second"]) {
    const created = await performAction(
      "local-demo",
      { type: "create-key", name },
      env,
    );
    requests.push(
      new Request("http://localhost/v1/classify", {
        headers: { Authorization: `Bearer ${created.secret}` },
      }),
    );
  }
  await env.APP_DB.prepare(
    "UPDATE app_accounts SET balance=7,bonus_granted=1 WHERE id='local-demo'",
  ).run();
  const results = await Promise.allSettled(
    requests.map((request) => authorizeAndReserve(request, env, 5)),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  for (const result of results)
    if (result.status === "fulfilled")
      await completeReservation(result.value!, env, true);
  expect((await getSnapshot("local-demo", env)).credits.balance).toBe(2);
  const final = (await authorizeAndReserve(requests[1], env, 2))!;
  await completeReservation(final, env, true);
  for (const request of requests)
    await expect(authorizeAndReserve(request, env, 1)).rejects.toThrow(
      "workspace balance is too low",
    );
  const snapshot = await getSnapshot("local-demo", env);
  expect(snapshot.credits.balance).toBe(0);
  expect(snapshot.agents.reduce((total, agent) => total + agent.used, 0)).toBe(
    7,
  );
  expect(
    await env.APP_DB.prepare(
      "SELECT COUNT(*) AS count FROM app_usage WHERE account_id='local-demo'",
    ).first(),
  ).toEqual({ count: 2 });
});
