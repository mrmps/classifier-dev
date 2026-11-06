import { expect, test } from "bun:test";
import worker, { type Env, ESCALATE_BELOW, MAX_INPUTS, TIERS } from "../src/index";
import { siteHomeHtml, siteValues, fillValues } from "../src/site/home";
import { HOME_TEMPLATE } from "../src/site/home-template";
import { BILLING_PLANS } from "../src/lib/billing";
import { BENCHMARK } from "../src/docs";
import VS_JEV from "../src/vs-jev.json";

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const get = (headers: Record<string, string>, signedIn = false, url = "https://classifier.dev/") =>
  worker.fetch(new Request(url, { headers }), {} as Env, ctx, { viewer: { signedIn } });

test("a browser gets the redesigned page, with its files from /site/", async () => {
  const html = await (await get({ accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0" })).text();
  expect(html).toContain('<link rel="stylesheet" href="/site/signal.css">');
  expect(html).toContain('<script type="module" src="/site/signal.js"></script>');
  expect(html).not.toContain("agentation");
  expect(html).not.toContain("noindex");
});

test("curl and agents still get the generated text, unchanged", async () => {
  const text = await (await get({ accept: "*/*", "user-agent": "curl/8.0" })).text();
  expect(text).not.toContain("<html");
  expect(text).toContain("classifier.dev");
  const md = await (await get({ accept: "text/markdown" })).text();
  expect(md).not.toContain("/site/");
});

test("the page's own policy lets in its files from /site/ and nothing from elsewhere", async () => {
  for (const origin of ["https://classifier.dev", "http://127.0.0.1:3000"]) {
    const csp = (await get({ accept: "text/html" }, false, `${origin}/`)).headers.get("content-security-policy")!;
    const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `))!;
    expect(directive("script-src")).toMatch(new RegExp(`^script-src ${origin}/site/( 'sha256-[A-Za-z0-9+/=]+')+$`));
    for (const name of ["font-src", "media-src"]) expect(directive(name)).toBe(`${name} ${origin}/site/`);
    expect(directive("style-src")).toBe(`style-src ${origin}/site/ 'unsafe-inline'`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("'self' 'unsafe-inline'");
    expect(csp).not.toContain("cdnjs");
  }
});

test("signed in, the nav offers the dashboard instead of logging in", () => {
  const html = siteHomeHtml({ signedIn: true });
  expect(html).toContain('href="/app">Dashboard</a>');
  expect(html).not.toContain('href="/login"');
});

test("every value the design names is filled from the constants, and none is left over", () => {
  const keys = new Set([...HOME_TEMPLATE.matchAll(/<data value="([a-z0-9.-]+)">/g)].map((m) => m[1]));
  const values = siteValues();
  expect([...keys].sort()).toEqual(Object.keys(values).sort());
  expect(() => fillValues('<data value="nope">1</data>')).toThrow();
});

test("the prices and limits on the page are the ones the service enforces", () => {
  const html = siteHomeHtml();
  const has = (key: string, text: string) => expect(html).toContain(`<data value="${key}">${text}</data>`);
  has("plan.pro.price", `$${BILLING_PLANS.pro.priceCents / 100}`);
  has("plan.scale.price", `$${BILLING_PLANS.scale.priceCents / 100}`);
  has("plan.pro.seats", String(BILLING_PLANS.pro.seatLimit));
  has("plan.scale.rate", `${BILLING_PLANS.scale.rateLimitMultiplier}×`);
  has("free.fast.rpm", TIERS.fast.rpm.toLocaleString("en-US"));
  has("free.smart.daily", TIERS.smart.daily.toLocaleString("en-US"));
  has("max.inputs", MAX_INPUTS.toLocaleString("en-US"));
  has("smart.below", `${ESCALATE_BELOW * 100}%`);
  has("rate.input", "$0.042");
  has("rate.web", "$2.20");
});

test("the updates form asks only for an email and posts to /subscribe", () => {
  const html = siteHomeHtml();
  const form = html.slice(html.indexOf('<form class="cell upd"'), html.indexOf("</form>", html.indexOf('<form class="cell upd"')));
  expect(form).toContain('action="/subscribe"');
  expect(form).toContain('type="email" name="email" required');
  expect(form).not.toContain('name="wants"');
});

test("every benchmark figure on the page is one /benchmark publishes", () => {
  const section = HOME_TEMPLATE.slice(HOME_TEMPLATE.indexOf('id="benchmarks"'), HOME_TEMPLATE.indexOf('id="inputs"'));
  const published = new Set(BENCHMARK.match(/\d+(?:\.\d+)?%/g));
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  for (const set of Object.values(VS_JEV.summary)) for (const row of Object.values(set.rows)) published.add(pct(row.acc_unsure)), published.add(pct(row.acc));
  // Headlines a second are 1,000 ms over the ms/item column of the single-label table.
  for (const ms of BENCHMARK.match(/^ {2}\S.*?%\s+\S+\s+([\d,]+)\s+[\d.]+$/gm) ?? []) {
    const n = Number(ms.trim().split(/\s+/).at(-2)!.replace(/,/g, ""));
    const perSecond = 1000 / n;
    published.add(perSecond >= 10 ? String(Math.round(perSecond)) : perSecond.toFixed(1));
  }
  const shown = [...section.matchAll(/<span class="bars__num">([\d.]+%?)<\/span>/g)].map((m) => m[1]);
  expect(shown.length).toBeGreaterThan(10);
  for (const figure of shown) expect(published).toContain(figure);
});
