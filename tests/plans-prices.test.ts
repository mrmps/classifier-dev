import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Plans } from "../src/features/billing/plans";
import { getSnapshot } from "../src/server/accounts";
import { provisionTestAccount } from "./support/account";
import { database } from "./support/postgres";

test("account plans show one input rate and one successful escalation price", async () => {
  const env = { APP_DB: database(), APP_ACCOUNTS_ENABLED: "true" };
  await provisionTestAccount(new Request("http://localhost/login"), env);
  const html = renderToStaticMarkup(createElement(Plans, { snapshot: await getSnapshot("local-demo", env), navigate: () => {} }));
  const names = Array.from(html.matchAll(/<th scope="row"[^>]*>(.*?)<\/th>/g), match => match[1]);
  expect(names).toEqual(["Input tokens", "Smart escalations"]);
  expect(html).toContain("$0.042");
  expect(html).toContain("+$2.00 / 1,000");
  expect(html).toContain("Output tokens are free");
});
