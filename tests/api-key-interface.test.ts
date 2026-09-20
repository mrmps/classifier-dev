import { beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Keys } from "../src/features/keys/keys";
import { AgentCatalog } from "../src/features/agents/agent-catalog";
import { ApiKeyCreator } from "../src/features/keys/api-key-creator";
import { getSnapshot } from "../src/server/accounts";
import { demoLogin } from "../src/server/auth";
import { performAction } from "../src/server/agents";
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
const act = (action: Parameters<typeof performAction>[1]) =>
  performAction("local-demo", action, env);
async function render() {
  return renderToStaticMarkup(
    createElement(Keys, {
      snapshot: await getSnapshot("local-demo", env),
      act,
    }),
  );
}
test("empty key management offers one creation entry, without a second connection flow", async () => {
  const html = await render();
  expect(html.match(/Create API key/g)).toHaveLength(1);
  expect(html).not.toContain("Set up a connection");
  expect(html).not.toContain('aria-label="Connection type"');
});
test("one API key table includes app and agent keys without exposing secrets", async () => {
  const app = await act({ type: "create-key", name: "Feedback service" });
  const agent = await act({
    type: "enroll",
    client: "Codex",
    name: "Research assistant",
  });
  const html = await render();
  expect(html).toContain("Feedback service");
  expect(html).toContain("Research assistant");
  expect(html).not.toContain("Consumer key");
  expect(html).not.toContain(app.secret!);
  expect(html).not.toContain(agent.secret!);
});
test("shared creator opens a dialog instead of rendering an inline creation form", () => {
  const html = renderToStaticMarkup(
    createElement(ApiKeyCreator, {
      canManage: true,
      act,
      onCreated: () => {},
    }),
  );
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain("Create API key");
  expect(html).not.toContain('type="submit"');
  expect(html).not.toContain("Key name");
});
test("agents catalog separates setup from credential management", async () => {
  const html = renderToStaticMarkup(
    createElement(AgentCatalog, {
      snapshot: await getSnapshot("local-demo", env),
      act,
      navigate: () => {},
    }),
  );
  for (const client of ["Claude Code", "Codex", "Cursor"])
    expect(html).toContain(`Set up ${client}`);
  for (const logo of ["claude.svg", "codex.svg", "cursor.svg"])
    expect(html).toContain(`/icons/agents/${logo}`);
  expect(html).toContain("MCP server");
  expect(html).toContain("Workspace connections for hosted chat apps are not available yet");
  expect(html).toContain('href="/app/keys"');
  expect(html).not.toContain("Create API key");
});
