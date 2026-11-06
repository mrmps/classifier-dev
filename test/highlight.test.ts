import { describe, expect, test } from "bun:test";

import worker from "../src/index";
import type { Env } from "../src/index";
import { codeLang, HL_ORIGIN } from "../src/ui";
import { DEVELOPERS, toMarkdown } from "../src/pages";

const env = {} as Env;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const fetchPage = (path: string, accept = "text/html,application/xhtml+xml") =>
  worker.fetch(new Request(`https://classifier.dev${path}`, { headers: { accept } }), env, ctx);

describe("code blocks", () => {
  test("a caption like 'curl:' is prose, not a command of its own", async () => {
    const html = await (await fetchPage("/developers")).text();
    expect(html).not.toMatch(/<pre>(<code[^>]*>)?curl:/);
    expect(html).toContain("<p>curl:</p>");
    const md = toMarkdown(DEVELOPERS, { title: "t", canonical: "c", description: "d" });
    expect(md).not.toMatch(/```\w*\ncurl:\n/);
  });

  test("carry the language they are in, read off the block", () => {
    expect(codeLang(["  curl https://classifier.dev/a,b/text", "  a"])).toBe("bash");
    expect(codeLang(["    const res = await fetch(\"https://classifier.dev\");"])).toBe("javascript");
    expect(codeLang(["    from classifier_dev import classify", "    print(r.label)"])).toBe("python");
    expect(codeLang(["    results, err := classifier.Classify(ctx, texts, nil)"])).toBe("go");
    expect(codeLang(['    {"error": "Provide at least 2 labels", "code": "too_few_labels"}'])).toBe("json");
    // A table is columns, not code; the word "fetch" in a cell does not make it JavaScript.
    expect(codeLang(["  JavaScript      fetch() is the SDK; see EXAMPLES.", "  Python          pip install classifier-dev"])).toBeUndefined();
    expect(codeLang(["  Method  Path        Purpose", "  GET     /{labels}   classify"])).toBeUndefined();
  });

  test("are marked for the highlighter on the pages, and fenced by language in Markdown", async () => {
    const html = await (await fetchPage("/developers")).text();
    const langs = [...html.matchAll(/<code class="language-(\w+)">/g)].map((m) => m[1]);
    expect(new Set(langs)).toEqual(new Set(["bash", "javascript", "python", "go", "json"]));
    // The redesigned pages mark the language but load no highlighter from a CDN.
    expect(html).not.toContain("cdnjs.cloudflare.com");
    const md = toMarkdown(DEVELOPERS, { title: "t", canonical: "c", description: "d" });
    expect(md).toContain("```python\nfrom classifier_dev import classify");
  });

  test("the redesigned pages let in their own files from /site/ and nothing from a CDN", async () => {
    for (const path of ["/developers", "/benchmark"]) {
      const csp = (await fetchPage(path)).headers.get("content-security-policy")!;
      const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src "))!;
      expect(scriptSrc).toStartWith("script-src https://classifier.dev/site/");
      expect(csp).not.toContain(HL_ORIGIN);
    }
  });
});

describe("links in code", () => {
  test("stop at the quote around them, not at its entity's semicolon", async () => {
    const html = await (await fetchPage("/developers")).text();
    expect(html).toContain('<a class="inline" href="https://classifier.dev/v1/classify">https://classifier.dev/v1/classify</a>&quot;');
    expect(html).not.toContain("classify&quot</a>");
  });
});
