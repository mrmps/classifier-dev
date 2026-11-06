import { expect, test } from "bun:test";
import worker, { type Env } from "../src/index";
import { BENCHMARK } from "../src/docs";
import { ABOUT, CONTACT } from "../src/pages";
import { benchmarkSections } from "../src/site/pages";
import { blocks, parse } from "../src/site/doc";

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const page = async (path: string, headers: Record<string, string> = { accept: "text/html", "user-agent": "Mozilla/5.0" }) =>
  (await worker.fetch(new Request(`https://classifier.dev${path}`, { headers }), {} as Env, ctx)).text();

test("doc pages render in the redesigned layout with their Markdown alternate", async () => {
  for (const path of ["/developers", "/mcp-setup", "/privacy", "/terms"]) {
    const html = await page(path);
    expect(html).toContain('<div class="rail docs">');
    expect(html).toContain(`<link rel="alternate" type="text/markdown" href="${path}.md"`);
    expect(html).toContain(`<a href="${path}" aria-current="page">`);
    expect(html).not.toContain("<pre></pre>");
  }
});

test("curl still gets the plain text of every page", async () => {
  for (const path of ["/developers", "/about", "/benchmark"]) {
    const text = await page(path, { accept: "*/*", "user-agent": "curl/8.0" });
    expect(text).not.toContain("<html");
  }
});

test("aligned columns become tables, and a value with gaps of its own stays one cell", () => {
  const html = blocks(["  REST API        POST https://classifier.dev  or  GET https://classifier.dev/{labels}/{text}", "                  Query form: GET https://classifier.dev/?labels={a,b}&text={text}", "  OpenAPI 3.1     https://classifier.dev/openapi.json", "  CLI             npm i -g classifier-dev  ->  classify a,b < f.txt"]);
  expect(html).toContain("<table>");
  expect((html.match(/<tr>/g) ?? []).length).toBe(3);
  expect((html.match(/<td>/g) ?? []).length).toBe(6);
  expect(html).toContain("<br>Query form:");
});

test("about and contact are a row per section, with the links they mention as buttons", async () => {
  const contact = await page("/contact");
  for (const s of parse(CONTACT).sections) expect(contact).toContain(`id="${s.id}"`);
  expect(contact).toContain('href="mailto:contact@classifier.dev"');
  expect(contact).toContain(">Open an issue</a>");
  expect(contact).toContain(">Book a call</a>");
  const about = await page("/about");
  expect(about).toContain('<ul class="plinks">');
  expect(parse(ABOUT).sections.length).toBeGreaterThan(2);
});

test("the benchmark page charts what /benchmark publishes, section by section", () => {
  const b = benchmarkSections(BENCHMARK);
  for (const s of parse(BENCHMARK).sections) expect(b.html).toContain(`id="${s.id}"`);
  // Charts for the comparisons, tables for the rest; no table falls back to a code block.
  expect((b.html.match(/class="bars__row/g) ?? []).length).toBeGreaterThanOrEqual(20);
  expect(b.html).not.toContain('class="codeblock"');
  for (const figure of ["87.7%", "91.6%", "82.0%", "43.4%", "0.887"]) expect(b.html).toContain(figure);
});

test("the pricing page keeps every term the text states, not only the ones the plans show", async () => {
  const html = await page("/pricing");
  for (const s of ["Auto recharge", "https://classifier.dev/app/credits", "whole dollars", "long_context_no_evidence"]) expect(html).toContain(s);
});

test("a message page names the home page's Markdown, which exists", async () => {
  const { messagePage } = await import("../src/site/shell");
  const html = messagePage({ title: "t", heading: "h", message: "<b>x</b>" });
  expect(html).toContain('href="/index.md"');
  expect(html).not.toContain('href="/.md"');
  expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
});

test("a command's printed output is marked so Copy leaves it out", async () => {
  const html = await page("/developers");
  expect(html).toMatch(/<code class="language-bash">curl <a [^>]*>https:\/\/classifier\.dev\/spam[^<]*<\/a><\/code>\n<span class="out">spam<\/span>/);
});
