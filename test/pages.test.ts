import { describe, expect, test } from "bun:test";

import worker from "../src/index";
import type { Env } from "../src/index";
import { VS_JEV, accuracy, pct } from "../src/vsjev";

const env = {} as Env;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

const get = (path: string, headers: Record<string, string>) =>
  worker.fetch(new Request(`https://classifier.dev${path}`, { headers }), env, ctx).then((r) => r.text());
const html = (path: string) => get(path, { accept: "text/html", "user-agent": "Mozilla/5.0" });
const markdown = (path: string) => get(path, { accept: "text/markdown" });

const PAGES = ["/", "/developers", "/benchmark", "/mcp-setup", "/pricing", "/privacy", "/terms", "/about", "/contact"];

const hrefs = (page: string) => [...page.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
const htmlHeadings = (page: string) => [...page.matchAll(/<h2>(?:<span class="syn">## <\/span>)?([^<]+)<\/h2>/g)].map((m) => m[1]);
const mdHeadings = (doc: string) => [...doc.matchAll(/^## (.+)$/gm)].map((m) => m[1]);

test("removed billing routes return not found", async () => {
  for (const path of ["/pro", "/v1/billing/login", "/v1/billing/key", "/v1/billing/account"]) {
    const response = await worker.fetch(
      new Request(`https://classifier.dev${path}`, { headers: { accept: "text/html" } }),
      env,
      ctx,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  }
});

/**
 * The HTML page and the Markdown are two renderings of one plain-text
 * document, so nothing may differ between them but the markup. Each renderer
 * used to carry its own copy of the rules, and the copies drifted.
 */
describe("the HTML and the Markdown of a page agree", () => {
  test("on every section heading", async () => {
    for (const path of PAGES) {
      const fromHtml = htmlHeadings(await html(path));
      const fromMd = mdHeadings(await markdown(path === "/" ? "/index.md" : `${path}.md`));
      // The home page adds its own sections, swaps UPDATES for the form, and
      // keeps the agent-only feedback instructions out of the browser page.
      const expected = path === "/" ? fromMd.filter((h) => !["Updates", "Agent feedback"].includes(h)) : fromMd;
      for (const h of expected) expect(fromHtml).toContain(h);
      if (path !== "/") expect(fromHtml).toEqual(fromMd);
    }
  });

  test("and product names keep their case in both", async () => {
    const page = await html("/mcp-setup");
    expect(page).toContain("Cursor, VS Code, windsurf, goose, anything else");
    expect(page).toContain("Claude Code");
    expect(page).toContain("ChatGPT");
    expect(await markdown("/mcp-setup.md")).toContain("## Cursor, VS Code, windsurf, goose, anything else");
  });
});

describe("agent feedback on the landing page", () => {
  test("is actionable for shell clients and reader agents", async () => {
    const shell = await get("/", { "user-agent": "curl/8.0" });
    const reader = await get("/", { accept: "text/html", "user-agent": "ClaudeBot" });
    expect(shell).toContain("AGENT FEEDBACK");
    expect(reader).toContain("## Agent feedback");
    for (const page of [shell, reader]) {
      expect(page).toContain("https://classifier.dev/.well-known/agent-feedback.json");
      expect(page).toContain("POST https://classifier.dev/api/v1/feedback");
      expect(page).toContain("POST https://classifier.dev/api/v1/observations");
      expect(page).toContain("GET  https://classifier.dev/api/v1/receipts/{id}");
    }
  });

  test("is only a footer link on the human landing page", async () => {
    const page = await html("/");
    expect(page).not.toContain('<a class="site-link" href="/.well-known/agent-feedback.json">Agent feedback</a>');
    expect(page).not.toContain("<h2><span class=\"syn\">## </span>Agent feedback</h2>");
    expect(page).toContain('<a class="inline" href="/.well-known/agent-feedback.json">agent feedback</a>');
  });
});

/**
 * Bare URLs in the documents become links. A URL is found in the raw text,
 * before escaping: linking the escaped text turned `"https://classifier.dev/mcp"`
 * in a JSON example into a link to https://classifier.dev/mcp&quot; — a 404 on
 * the MCP setup page, and the same on /developers for /v1/classify.
 */
describe("links in a rendered document", () => {
  test("end where the URL ends", async () => {
    for (const path of PAGES) {
      for (const href of hrefs(await html(path))) {
        expect(href).not.toMatch(/&quot|&#39|&lt|&gt|[{}]/);
      }
    }
    const setup = await html("/mcp-setup");
    expect(setup).toContain('href="https://classifier.dev/mcp"');
    expect(setup).toContain('href="https://classifier.dev/mcp">https://classifier.dev/mcp</a>&quot;}}}');
    expect(await html("/developers")).toContain('href="https://classifier.dev/v1/classify"');
  });

  test("leave a template URL and trailing punctuation as text", async () => {
    const page = await html("/developers");
    expect(page).toContain("GET https://classifier.dev/{labels}/{text}");
    expect(page).not.toContain('href="https://classifier.dev/{labels}');
    expect(page).toContain('href="https://classifier.dev/auth.md">https://classifier.dev/auth.md</a>');
  });

  test("still escape the text around them", async () => {
    const page = await html("/mcp-setup");
    expect(page).toContain("-H &#39;content-type: application/json&#39;");
    expect(page).toContain("&quot;jsonrpc&quot;: &quot;2.0&quot;");
    expect(await html("/developers")).toContain("Authorization: Bearer &lt;key&gt;");
  });
});

/** A block a reader would paste into a shell gets a copy control, whatever the shell tool. */
test("command blocks carry a copy button", async () => {
  const setup = await html("/mcp-setup");
  expect(setup).toMatch(/<pre>(?:<code[^>]*>)?claude mcp add[^]*?<\/pre><p class="row"><button[^>]*data-copy="1"/);
  expect(setup).toMatch(/<pre>(?:<code[^>]*>)?codex mcp add[^]*?<\/pre><p class="row"><button[^>]*data-copy="1"/);
  const dev = await html("/developers");
  expect(dev).toMatch(/<pre>(?:<code[^>]*>)?curl <a class="inline" href="https:\/\/classifier\.dev\/spam[^]*?<\/pre><p class="row"><button[^>]*data-copy="1"/);
});

/**
 * The structured data on the home page must parse, and the accuracies its FAQ
 * quotes must be the measured ones the page's own table shows, not a
 * transcription that the next `npm run vs-jev` would leave behind.
 */
describe("the home page JSON-LD", () => {
  test("parses and quotes the measured accuracies", async () => {
    const page = await html("/");
    const m = page.match(/<script type="application\/ld\+json">([^]*?)<\/script>/);
    expect(m).not.toBeNull();
    const ld = JSON.parse(m![1]) as { "@graph": { "@type": string; mainEntity?: { acceptedAnswer: { text: string } }[] }[] };
    const faq = ld["@graph"].find((g) => g["@type"] === "FAQPage")!;
    const answer = faq.mainEntity!.map((q) => q.acceptedAnswer.text).join(" ");
    for (const set of Object.keys(VS_JEV.summary)) {
      for (const run of ["jev", "smart"]) {
        expect(answer).toContain(pct(accuracy(set, run)));
        expect(page).toContain(pct(accuracy(set, run)));
      }
    }
    expect(m![1]).not.toContain("<");
  });
});
