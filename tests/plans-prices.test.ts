import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Plans } from "../src/features/billing/plans";
import { getSnapshot } from "../src/server/accounts";
import { provisionTestAccount } from "./support/account";
import { database } from "./support/postgres";

test("account plans identify the Beam trial rates without advertising free Gemini reviews", async () => {
  const env = { APP_DB: database(), APP_ACCOUNTS_ENABLED: "true" };
  await provisionTestAccount(new Request("http://localhost/login"), env);
  const html = renderToStaticMarkup(createElement(Plans, { snapshot: await getSnapshot("local-demo", env), navigate: () => {} }));
  const names = Array.from(html.matchAll(/<th scope="row"[^>]*>(.*?)<\/th>/g), match => match[1]);
  expect(names).toEqual(["Jev", "Gemini escalation", "jev/laya", "jev/kev", "ibm-granite/granite-4.0-h-micro", "deepseek/deepseek-v4-flash", "inclusionai/ling-3.0-flash", "inception/mercury-2.5", "ibm-granite/granite-4.2-8b"]);
  expect(html).toContain("Laya inference is free during the trial");
  expect(html).toContain("Smart reviews are still billed");
});
