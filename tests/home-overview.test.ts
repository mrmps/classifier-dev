import { beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Home } from "../src/features/dashboard/home";
import { getSnapshot } from "../src/server/accounts";
import { demoLogin } from "../src/server/auth";
import { performAction } from "../src/server/agents";
import { authorizeAndReserve, completeReservation } from "../src/server/usage";
import type { AppEnv } from "../src/server/db";
import { database } from "./support/postgres";
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
async function render(skipSetup = false) {
  return renderToStaticMarkup(
    createElement(Home, {
      snapshot: await getSnapshot("local-demo", env),
      act: (action) => performAction("local-demo", action, env),
      navigate: () => {},
    }),
  );
}
test("a new or unused-key workspace starts with both setup paths, not empty charts", async () => {
  await performAction("local-demo", { type: "create-key", name: "App" }, env);
  const html = await render();
  expect(html).toContain("Connect your agent");
  expect(html).toContain("Your API key");
  expect(html).not.toContain("Skip setup");
  expect(html).not.toContain("Spend by hour");
});
test("home always exposes balance and setup without an onboarding link", async () => {
  const html = await render(true);
  expect(html).toContain("Used this period");
  expect(html).toContain("Remaining balance");
  expect(html).toContain("Current plan");
  expect(html).toContain("Try an API request");
  expect(html).not.toContain("/app/onboarding");
  expect(html).not.toContain('aria-label="Agent client"');
});
test("successful attributed use unlocks the overview with activity and hourly usage", async () => {
  const created = await performAction(
    "local-demo",
    { type: "create-key", name: "Feedback app" },
    env,
  );
  const reservation = await authorizeAndReserve(
    new Request("http://localhost/v1/classify", {
      headers: { Authorization: `Bearer ${created.secret}` },
    }),
    env,
    3,
  );
  await completeReservation(reservation!, env, true);
  const html = await render();
  expect(html).toContain("Spend by hour, in UTC");
  expect(html).toContain("Feedback app");
  expect(html).toContain("Succeeded");
  expect(html).toContain("Your API key");
  expect(html).not.toContain("Continue setup");
  expect(html).not.toContain(created.secret!);
});
