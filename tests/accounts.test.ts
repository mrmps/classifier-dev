import { describe, test, expect, beforeEach } from "bun:test";
import { database } from "./support/postgres";
import { clearWorkspaceSelection, demoLogin, isLocalDemo, logout, requireAccount } from "../src/server/auth";
import { getSnapshot } from "../src/server/accounts";
import { performAction } from "../src/server/agents";
import { authorizeAndReserve, completeReservation } from "../src/server/usage";
import type { AppEnv } from "../src/server/db";

let env: AppEnv;
const request = (token?: string) =>
  new Request("http://localhost/v1/classify", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
async function enroll() {
  return performAction(
    "local-demo",
    { type: "enroll", client: "Claude Code" },
    env,
  );
}
beforeEach(async () => {
  env = { APP_DB: database(), APP_DEMO: "true", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters" };
  await demoLogin(
    new Request("http://localhost/login", {
      headers: { Origin: "http://localhost" },
    }),
    env,
  );
});
describe("local account lifecycle", () => {
  test("authentication transitions clear previous workspace selection without losing auth cookies", async () => {
    const request = new Request("http://localhost/auth/demo", {
      headers: { Origin: "http://localhost", Cookie: "classifier_workspace=old-team" },
    });
    const login = await demoLogin(request, env);
    expect(login.headers.getSetCookie()).toHaveLength(2);
    expect(login.headers.getSetCookie()[1]).toContain("classifier_workspace=;");
    expect(login.headers.getSetCookie()[1]).toContain("Max-Age=0");
    const cookie = login.headers.getSetCookie()[0];
    const signedOut = await logout(new Request("http://localhost/auth/logout", {
      headers: { Origin: "http://localhost", Cookie: cookie },
    }), env);
    expect(signedOut.headers.getSetCookie()).toHaveLength(2);
    expect(signedOut.headers.getSetCookie()[1]).toContain("classifier_workspace=;");
    await expect(requireAccount(new Request("http://localhost/app", {
      headers: { Cookie: cookie },
    }), env)).rejects.toThrow("session expired");

    const callback = clearWorkspaceSelection(new Response(null, {
      status: 302,
      headers: { "Set-Cookie": "wos-session=session; Secure; HttpOnly", Location: "/app" },
    }), new Request("https://classifier.dev/auth/callback"));
    expect(callback.headers.getSetCookie()[0]).toBe("wos-session=session; Secure; HttpOnly");
    expect(callback.headers.getSetCookie()[1]).toContain("Secure");
    expect(callback.headers.get("Location")).toBe("/app");
  });
  test("local auth rejects deployed origins, proxied requests and missing opt-in", () => {
    expect(isLocalDemo(new Request("https://classifier.dev"), env)).toBe(false);
    expect(
      isLocalDemo(
        new Request("http://localhost", { headers: { "CF-Ray": "remote" } }),
        env,
      ),
    ).toBe(false);
    expect(
      isLocalDemo(
        new Request("http://localhost", {
          headers: { "X-Forwarded-For": "8.8.8.8" },
        }),
        env,
      ),
    ).toBe(false);
    expect(isLocalDemo(request(), { ...env, APP_DEMO: "false" })).toBe(false);
  });
  test("login session survives requests and cookie never contains a key", async () => {
    const login = await demoLogin(
      new Request("http://localhost/login", {
        headers: { Origin: "http://localhost" },
      }),
      env,
    );
    const cookie = login.headers.get("Set-Cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(
      await requireAccount(
        new Request("http://localhost/app", { headers: { Cookie: cookie } }),
        env,
      ),
    ).toBe("local-demo");
    await expect(
      requireAccount(
        new Request("https://classifier.dev/app", {
          headers: { Cookie: cookie },
        }),
        env,
      ),
    ).rejects.toThrow();
  });
  test("successful first call settles usage only once without granting extra credits", async () => {
    const enrolled = await enroll();
    const reservation = (await authorizeAndReserve(
      request(enrolled.secret),
      env,
      3,
    ))!;
    await completeReservation(reservation, env, true);
    await completeReservation(reservation, env, true);
    const snap = await getSnapshot("local-demo", env);
    expect(snap.credits.balance).toBe(499997);
    expect(snap.agents[0].used).toBe(3);
    expect(snap.agents[0].status).toBe("connected");
    expect(snap.usage[0].status).toBe("completed");
    expect(JSON.stringify(snap)).not.toContain(enrolled.secret!);
  });
  test("upstream failure refunds once and does not activate", async () => {
    const enrolled = await enroll();
    const reservation = (await authorizeAndReserve(
      request(enrolled.secret),
      env,
      5,
    ))!;
    await completeReservation(reservation, env, false);
    await completeReservation(reservation, env, false);
    const snap = await getSnapshot("local-demo", env);
    expect(snap.credits.balance).toBe(500000);
    expect(snap.agents[0].used).toBe(0);
    expect(snap.onboarding.completed).toBe(false);
  });
  test("onboarding completes only on success and survives revoked credentials and period rollover", async () => {
    const enrolled = await enroll();
    const failed = (await authorizeAndReserve(
      request(enrolled.secret),
      env,
      1,
    ))!;
    await completeReservation(failed, env, false);
    // A late success for an already refunded reservation cannot complete onboarding.
    await completeReservation(failed, env, true);
    let snapshot = await getSnapshot("local-demo", env);
    expect(snapshot.onboarding.completed).toBe(false);
    expect(snapshot.agents[0].lastUsed).toBeNull();

    const succeeded = (await authorizeAndReserve(
      request(enrolled.secret),
      env,
      1,
    ))!;
    await completeReservation(succeeded, env, true);
    snapshot = await getSnapshot("local-demo", env);
    const successfulAt = snapshot.agents[0].lastUsed;
    expect(snapshot.onboarding.completed).toBe(true);
    expect(successfulAt).not.toBeNull();

    await performAction(
      "local-demo",
      { type: "revoke", agentId: enrolled.agentId! },
      env,
    );
    await env.APP_DB.prepare(
      "UPDATE app_usage SET created_at='2020-01-01T00:00:00.000Z'",
    ).run();
    await env.APP_DB.prepare(
      "UPDATE app_accounts SET reset_at='2020-01-02T00:00:00.000Z' WHERE id='local-demo'",
    ).run();
    snapshot = await getSnapshot("local-demo", env);
    expect(snapshot.agents[0]).toMatchObject({
      status: "revoked",
      used: 1,
      lastUsed: successfulAt,
    });
    expect(snapshot.usage).toHaveLength(0);
    expect(snapshot.onboarding.completed).toBe(true);
  });
  test("pause and revoke stop inference; revoked credentials cannot resume", async () => {
    const enrolled = await enroll();
    const agentId = enrolled.agentId!;
    await authorizeAndReserve(request(enrolled.secret), env, 3);
    await performAction("local-demo", { type: "pause", agentId }, env);
    await expect(
      authorizeAndReserve(request(enrolled.secret), env, 1),
    ).rejects.toThrow();
    await performAction("local-demo", { type: "revoke", agentId }, env);
    await expect(
      performAction("local-demo", { type: "resume", agentId }, env),
    ).rejects.toThrow();
  });
  test("two agents share one account balance and ownership is enforced", async () => {
    const a = await enroll();
    const b = await enroll();
    await env.APP_DB.prepare(
      "UPDATE app_accounts SET balance=1000 WHERE id='local-demo'",
    ).run();
    await authorizeAndReserve(request(a.secret), env, 800);
    await expect(
      authorizeAndReserve(request(b.secret), env, 300),
    ).rejects.toThrow();
    await expect(
      performAction(
        "other-account",
        { type: "revoke", agentId: a.agentId! },
        env,
      ),
    ).rejects.toThrow();
    expect((await getSnapshot("local-demo", env)).credits.balance).toBe(200);
  });
});

describe("credit periods and reservation recovery", () => {
  test("signup allowance never replenishes after a calendar period", async () => {
    const connection = await enroll();
    const reservation = (await authorizeAndReserve(
      request(connection.secret),
      env,
      3,
    ))!;
    await completeReservation(reservation, env, true);
    await env.APP_DB.prepare(
      "UPDATE app_usage SET created_at='2020-01-01T00:00:00.000Z'",
    ).run();
    await env.APP_DB.prepare(
      "UPDATE app_accounts SET reset_at='2020-01-02T00:00:00.000Z' WHERE id='local-demo'",
    ).run();
    const snapshot = await getSnapshot("local-demo", env);
    expect(snapshot.credits.balance).toBe(499997);
    expect(snapshot.credits.bonus).toBe(0);
    expect(snapshot.agents[0].used).toBe(3);
    expect(snapshot.usage).toHaveLength(0);
    expect(snapshot.usageTotals.credits).toBe(0);
    const next = (await authorizeAndReserve(
      request(connection.secret),
      env,
      1,
    ))!;
    await completeReservation(next, env, true);
    expect((await getSnapshot("local-demo", env)).credits.balance).toBe(499996);
  });
  test("does not renew while a live inference has reserved old-period credits", async () => {
    const connection = await enroll();
    const reservation = (await authorizeAndReserve(
      request(connection.secret),
      env,
      3,
    ))!;
    await env.APP_DB.prepare(
      "UPDATE app_accounts SET reset_at='2020-01-02T00:00:00.000Z' WHERE id='local-demo'",
    ).run();
    expect((await getSnapshot("local-demo", env)).credits.balance).toBe(499997);
    await completeReservation(reservation, env, false);
    expect((await getSnapshot("local-demo", env)).credits.balance).toBe(500000);
    expect((await getSnapshot("local-demo", env)).agents[0].used).toBe(0);
  });
  test("stale reservations refund exactly once; late success cannot grant a bonus", async () => {
    const connection = await enroll();
    const reservation = (await authorizeAndReserve(
      request(connection.secret),
      env,
      3,
    ))!;
    await env.APP_DB.prepare(
      "UPDATE app_usage SET created_at='2020-01-01T00:00:00.000Z' WHERE id=?",
    )
      .bind(reservation.id)
      .run();
    await getSnapshot("local-demo", env);
    await getSnapshot("local-demo", env);
    await completeReservation(reservation, env, true);
    const snapshot = await getSnapshot("local-demo", env);
    expect(snapshot.credits.balance).toBe(500000);
    expect(snapshot.credits.bonus).toBe(0);
    expect(snapshot.agents[0].used).toBe(0);
    expect(snapshot.onboarding.completed).toBe(false);
  });
  test("rejects expired sessions and malformed runtime actions", async () => {
    const login = await demoLogin(
      new Request("http://localhost/login", {
        headers: { Origin: "http://localhost" },
      }),
      env,
    );
    await env.APP_DB.prepare(
      "UPDATE app_sessions SET expires_at='2020-01-01T00:00:00.000Z'",
    ).run();
    await expect(
      requireAccount(
        new Request("http://localhost/app", {
          headers: { Cookie: login.headers.get("Set-Cookie")! },
        }),
        env,
      ),
    ).rejects.toThrow("expired");
    for (const action of [
      null,
      {},
      { type: "enroll", client: 123 },
      { type: "set-limit", agentId: "a", limit: "5" },
      { type: "set-name", name: [] },
      { type: "delete-all" },
    ]) {
      await expect(
        performAction("local-demo", action as any, env),
      ).rejects.toThrow();
    }
  });
});
