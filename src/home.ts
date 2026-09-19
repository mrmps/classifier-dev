/**
 * The public site, for browsers.
 *
 * curl and agents still get the plain text they always did — this is the same
 * document rendered, not a second copy of it. The plain text stays canonical:
 * everything below is derived from DOCS and BENCHMARK at request time, so the
 * page cannot drift from what `curl classifier.dev` prints.
 */

import { esc, btn, page, COPY_ICON } from "./ui";
import { DOCS, BENCHMARK } from "./docs";
import { VS_JEV, vsJevHtml, smartWins, smartGain, noiseFloor } from "./vsjev";
import { SITE, SITE_UPDATED } from "./wellknown";

const HOME_CSS = `
.prose section>*+*{margin-top:14px}
.prose>section{margin-top:28px}
.lead{color:var(--muted)}
.k{color:var(--blue)}
.block{position:relative}
.block>.row{margin-top:4px}
h2{scroll-margin-top:24px}
.foot{color:var(--dim);border-top:1px solid var(--rule);padding-top:16px}
.nb{white-space:nowrap}
.vs{width:auto;margin-top:10px}
.vs th,.vs td{padding:3px 0}
.vs th.set{text-align:center;color:var(--fg);border-bottom:1px solid var(--rule);padding:0 8px 4px}
.vs .num{text-align:right;min-width:5.5em;padding-left:14px}
.vs .gap{padding-left:32px}
.vs thead th:first-child{border-bottom:0}
.vs thead tr:last-child th{border-bottom:0;padding-top:4px}
.vs td.win{color:var(--green)}
.vs tbody th{font-weight:400;color:var(--fg);border-bottom:0;padding-right:8px}
/* The agent prompt: the one thing a first-time visitor should not miss. */
.agent{padding:16px 16px 18px;border:1px solid rgba(63,185,80,.45);background:rgba(63,185,80,.06);
  box-shadow:inset 3px 0 0 var(--green)}
.agent h2{color:var(--bright)}
.agent .prompt>pre{white-space:pre-wrap;word-break:break-word;color:var(--bright);
  border-color:rgba(63,185,80,.5);background:#0d1a12}
.agent .block>.row{margin-top:10px}
.b.cta{background:var(--green);color:#04120a;font-weight:700;font-size:16px;padding:10px 18px;
  box-shadow:0 0 0 1px var(--green),0 0 28px rgba(63,185,80,.35)}
.b.cta .br{color:rgba(4,18,10,.55)}
.b.cta:hover,.b.cta:focus-visible{background:#56d364;color:#04120a;box-shadow:0 0 0 1px #56d364,0 0 36px rgba(86,211,100,.5)}
.b.cta:hover .br,.b.cta:focus-visible .br{color:rgba(4,18,10,.7)}
.b.cta svg{width:18px;height:18px}
.agent .alt{margin-top:12px}
.or{color:var(--dim)}
`;

/** The headline: what the service adds over calling its own model directly. */
function vsJevSection() {
  const gains = smartGain();
  const fmt = (p: number) => `${p >= 0 ? "+" : ""}${p.toFixed(1)}`;
  const n = Object.values(VS_JEV.summary)[0]?.n ?? 0;
  const floor = noiseFloor(n);
  const clear = gains.filter((g) => g.points > floor || g.unsurePoints > floor * 2);
  const title = smartWins() ? "Better than calling its own model directly" : "Against the model it runs on";
  const lead =
    `The model behind this service is Jev. The smart tier re-asks only what Jev was unsure about, and comes out ` +
    gains.map((g) => `${fmt(g.points)} points on ${g.set} (${fmt(g.unsurePoints)} on the unsure items)`).join(", ") +
    `. On ${n} items a gap under about ${floor.toFixed(0)} points is noise` +
    (clear.length ? `; ${clear.map((g) => g.set).join(" and ")} clears it.` : ".");
  return `<section>
    <h2><span class="syn">## </span>${esc(title)}</h2>
    <p class="lead">${esc(lead)} Same public test sets, measured live over this API on <span class="nb">${esc(VS_JEV.measured)}</span>. No key, no cost.</p>
    ${vsJevHtml()}
    <p class="row">${btn("full benchmark", { href: "/benchmark" })}${btn("npm run vs-jev", { href: "https://github.com/mrmps/classifier-dev/blob/main/eval/vs_jev.py", cls: "dim" })}</p>
  </section>`;
}

/** Bare URLs become links; trailing sentence punctuation stays outside. */
function linkify(escaped: string) {
  return escaped.replace(/https?:\/\/[^\s<>()"]+/g, (u) => {
    const trail = u.match(/[.,;:]+$/)?.[0] ?? "";
    const href = u.slice(0, u.length - trail.length);
    return `<a class="inline" href="${href}">${href}</a>${trail}`;
  });
}

const isHeading = (l: string) => /^[A-Z][A-Z0-9 ,/()'-]{2,}$/.test(l) && l.trim() === l;

/**
 * A block keeps its own spacing when it is a command, a table, or anything
 * else whose columns carry meaning. Prose is re-flowed so it wraps to the
 * reader's width instead of the terminal's 80.
 */
const isPre = (lines: string[]) =>
  lines.some((l) => /\S {2,}\S/.test(l) || /^\s*(curl|npm|npx|classify|GET|POST|\{|\/)/.test(l) || /^\s{4,}\S/.test(l));

const isCommand = (lines: string[]) => lines.some((l) => /^\s*(curl|npm|npx|classify)\b/.test(l));

function renderBlocks(body: string[]): string {
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    const lines = buf;
    buf = [];
    if (isPre(lines)) {
      const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
      const text = lines.map((l) => l.slice(indent)).join("\n");
      const copy = isCommand(lines)
        ? `<p class="row">${btn("copy", { cls: "dim", icon: COPY_ICON, attrs: ' data-copy="1"' })}</p>`
        : "";
      out.push(`<div class="block"><pre>${linkify(esc(text))}</pre>${copy}</div>`);
    } else {
      out.push(`<p>${linkify(esc(lines.map((l) => l.trim()).join(" ")))}</p>`);
    }
  };
  for (const line of body) {
    if (!line.trim()) flush();
    else buf.push(line);
  }
  flush();
  return out.join("");
}

/** Turn one of the plain-text documents into sections. */
function renderDoc(doc: string, skipTitle: boolean) {
  const lines = doc.split("\n");
  const out: string[] = [];
  let i = 0;
  // The lead paragraph, before any heading.
  const preamble: string[] = [];
  if (skipTitle) {
    while (i < lines.length && !isHeading(lines[i])) {
      preamble.push(lines[i]);
      i++;
    }
    // Only the title line is dropped — the header already shows it. The
    // opening paragraphs are real documentation and stay.
    const rest = preamble.slice(1).join("\n");
    if (rest.trim()) out.push(renderBlocks(rest.split("\n")));
  }
  while (i < lines.length) {
    if (!isHeading(lines[i])) {
      i++;
      continue;
    }
    const title = lines[i].trim();
    i++;
    const body: string[] = [];
    while (i < lines.length && !isHeading(lines[i])) body.push(lines[i++]);
    const name = (title.charAt(0) + title.slice(1).toLowerCase()).replace(
      /\b(cli|api|json|ndjson|url|http|rfc)\b/gi,
      (m) => m.toUpperCase(),
    );
    out.push(
      `<section><h2><span class="syn">## </span>${esc(name)}</h2>${renderBlocks(body)}</section>`,
    );
  }
  return out.join("");
}

const AGENT_PROMPT =
  "Set up the classifier.dev skill: run `npx skills add https://classifier.dev`, " +
  "then read https://classifier.dev/skill.md and follow it all the way through.";

const META = (title: string, desc: string, path = "/") => `<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="https://classifier.dev${path === "/" ? "/" : path}">
<link rel="alternate" type="text/markdown" href="https://classifier.dev${path === "/" ? "/index.md" : `${path}.md`}" title="Markdown">
<link rel="alternate" type="application/openapi+json" href="https://classifier.dev/openapi.json" title="OpenAPI">
<link rel="alternate" type="application/json" href="https://classifier.dev/.well-known/mcp/server-card.json" title="MCP server card">
<link rel="sitemap" type="application/xml" href="https://classifier.dev/sitemap.xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="classifier.dev">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="https://classifier.dev${path === "/" ? "" : path}">
<meta property="og:image" content="https://classifier.dev/og-v3.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="https://classifier.dev/og-v3.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">
<link rel="alternate" type="text/markdown" href="/skill.md">`;

/**
 * Structured data for the home page: what this is, that it is free, who runs
 * it, and the three questions agents ask first. JSON-LD is how crawlers and
 * answer engines read identity without parsing prose.
 */
const JSON_LD = () => {
  const graph = [
    {
      "@type": "SoftwareApplication",
      "@id": "https://classifier.dev/#app",
      name: SITE.name,
      alternateName: "classifier.dev API",
      url: "https://classifier.dev/",
      description: SITE.tagline + " Send text and a list of labels, get back the label that fits and a calibrated confidence. Up to 1,000 texts per request.",
      applicationCategory: "DeveloperApplication",
      applicationSubCategory: "Text classification API",
      operatingSystem: "Any",
      softwareVersion: "1.0.0",
      dateModified: SITE_UPDATED,
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD", availability: "https://schema.org/InStock", url: "https://classifier.dev/pricing", description: "Free within per-IP limits: 3,000 classifications a minute on the fast tier." },
      featureList: ["Zero-shot classification into your own labels", "Calibrated confidence per answer", "1,000 texts per request", "Multi-label mode", "MCP server", "CLI", "No API key"],
      author: { "@id": "https://classifier.dev/#author" },
      publisher: { "@id": "https://classifier.dev/#org" },
      sameAs: [SITE.repo, SITE.author.x, "https://www.npmjs.com/package/classifier-dev", "https://registry.modelcontextprotocol.io/v0/servers?search=dev.classifier"],
      softwareHelp: { "@type": "CreativeWork", url: "https://classifier.dev/developers" },
      installUrl: "https://classifier.dev/mcp-setup",
      license: "https://github.com/mrmps/classifier-dev/blob/main/LICENSE",
    },
    {
      "@type": "Service",
      "@id": "https://classifier.dev/#service",
      name: "Text classification as a service",
      serviceType: "Zero-shot text classification API",
      provider: { "@id": "https://classifier.dev/#org" },
      areaServed: "Worldwide",
      url: "https://classifier.dev/",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD", url: "https://classifier.dev/pricing" },
      termsOfService: "https://classifier.dev/privacy",
      availableChannel: [
        { "@type": "ServiceChannel", serviceUrl: "https://classifier.dev/v1/classify", name: "REST API" },
        { "@type": "ServiceChannel", serviceUrl: "https://classifier.dev/mcp", name: "MCP server" },
      ],
    },
    {
      "@type": "BreadcrumbList",
      "@id": "https://classifier.dev/#breadcrumbs",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "classifier.dev", item: "https://classifier.dev/" },
        { "@type": "ListItem", position: 2, name: "Developers", item: "https://classifier.dev/developers" },
        { "@type": "ListItem", position: 3, name: "Benchmark", item: "https://classifier.dev/benchmark" },
        { "@type": "ListItem", position: 4, name: "MCP setup", item: "https://classifier.dev/mcp-setup" },
      ],
    },
    {
      "@type": "WebAPI",
      "@id": "https://classifier.dev/#api",
      name: "classifier.dev API",
      url: "https://classifier.dev/",
      documentation: "https://classifier.dev/openapi.json",
      description: "REST and MCP interfaces for zero-shot text classification. No authentication.",
      provider: { "@id": "https://classifier.dev/#org" },
      termsOfService: "https://classifier.dev/privacy",
    },
    {
      "@type": "Organization",
      "@id": "https://classifier.dev/#org",
      name: SITE.name,
      url: "https://classifier.dev/",
      logo: "https://classifier.dev/favicon.svg",
      founder: { "@id": "https://classifier.dev/#author" },
      sameAs: [SITE.repo, SITE.author.x, "https://github.com/mrmps", "https://www.npmjs.com/package/classifier-dev"],
      contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: SITE.email, url: "https://classifier.dev/contact", availableLanguage: "English" },
      address: { "@type": "PostalAddress", addressLocality: "San Francisco", addressRegion: "CA", addressCountry: "US" },
    },
    {
      "@type": "Person",
      "@id": "https://classifier.dev/#author",
      name: SITE.author.name,
      url: SITE.author.x,
      sameAs: [SITE.author.x, "https://twitter.com/michael_chomsky", "https://github.com/mrmps", "https://www.npmjs.com/~mrmps"],
    },
    {
      "@type": "WebSite",
      "@id": "https://classifier.dev/#site",
      url: "https://classifier.dev/",
      name: SITE.name,
      publisher: { "@id": "https://classifier.dev/#org" },
      inLanguage: "en",
    },
    {
      "@type": "FAQPage",
      "@id": "https://classifier.dev/#faq",
      mainEntity: [
        {
          "@type": "Question",
          name: "Do I need an API key to use classifier.dev?",
          acceptedAnswer: { "@type": "Answer", text: "No. Every endpoint is public and keyless. Limits are per IP: 3,000 classifications a minute on the fast tier and 200 on smart. A partner key lifts them." },
        },
        {
          "@type": "Question",
          name: "When should an agent call classifier.dev instead of classifying text itself?",
          acceptedAnswer: { "@type": "Answer", text: "When reading the input is the expensive part: filtering search results before opening them, bucketing logs or tickets, routing a pipeline branch deterministically. One request classifies up to 1,000 texts in about a second. Under about five items you can already see, just decide yourself." },
        },
        {
          "@type": "Question",
          name: "How accurate is it, and what does the confidence mean?",
          acceptedAnswer: { "@type": "Answer", text: "On public test sets the fast tier scores 87.5% on four-way AG News and 61.8% on six-way emotion; the smart tier 90.0% and 62.7%. The confidence is calibrated: answers at or above 0.9 were right 82-92% of the time, answers under 0.5 about 30-60%. Details at classifier.dev/benchmark." },
        },
        {
          "@type": "Question",
          name: "Can I use it from Claude or ChatGPT?",
          acceptedAnswer: { "@type": "Answer", text: "Yes. It is an MCP server at https://classifier.dev/mcp (Streamable HTTP, no auth). Add it as a custom connector in Claude, as a developer-mode app in ChatGPT, or with `claude mcp add --transport http classifier https://classifier.dev/mcp`. Steps at classifier.dev/mcp-setup." },
        },
      ],
    },
  ];
  return `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c")}</script>`;
};

/**
 * WebMCP: the same classify tool, registered on the page for browser agents
 * (Chrome's origin trial, the ChatGPT desktop browser). Feature-detected, so
 * a browser without document.modelContext runs none of it.
 */
const WEBMCP_SCRIPT = `<script>
(() => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || typeof mc.registerTool !== "function") return;
  const classify = async (body) => {
    const r = await fetch("https://classifier.dev/v1/classify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  };
  mc.registerTool({
    name: "classify_texts",
    description: "Sort up to 1,000 texts into exactly one of your own labels each, with a calibrated 0-1 confidence per answer. Use for triage, routing, filtering and bucketing many items without reading them all. No API key.",
    inputSchema: { type: "object", properties: {
      inputs: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 1000, description: "Texts to classify, results come back in order." },
      labels: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 100, description: "Category names, 2 to 100." },
      instructions: { type: "string", description: "Optional extra criteria." } }, required: ["inputs", "labels"] },
    annotations: { readOnlyHint: true, idempotentHint: true },
    async execute({ inputs, labels, instructions }) { return classify({ inputs, labels, instructions }); }
  });
  mc.registerTool({
    name: "classify_multi_label",
    description: "Tag each text with every label that applies (possibly none), with an independent 0-1 score per label. Up to 1,000 texts.",
    inputSchema: { type: "object", properties: {
      inputs: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 1000 },
      labels: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 100 },
      max_labels: { type: "integer", minimum: 1, description: "Cap per text." } }, required: ["inputs", "labels"] },
    annotations: { readOnlyHint: true, idempotentHint: true },
    async execute({ inputs, labels, max_labels }) { return classify({ inputs, labels, multi: true, max_labels }); }
  });
})();
</script>`;

const COPY_SCRIPT = `<script>
// Every [ copy ] control copies the block it belongs to; the prompt button
// carries its own text.
for (const b of document.querySelectorAll("[data-copy]")) {
  b.addEventListener("click", async () => {
    const pre = b.closest(".block")?.querySelector("pre");
    const text = b.dataset.text || (pre ? pre.innerText : "");
    const label = b.querySelector(".lbl"), was = label.textContent;
    try { await navigator.clipboard.writeText(text); label.textContent = "copied"; }
    catch { label.textContent = "press ctrl+c"; }
    setTimeout(() => { label.textContent = was; }, 1500);
  });
}
</script>`;

const NAV = (here: string) =>
  `<nav><p class="row">${btn("home", { href: "/", cls: here === "home" ? "on" : "" })}${btn("benchmark", {
    href: "/benchmark",
    cls: here === "benchmark" ? "on" : "",
  })}${btn("developers", { href: "/developers", cls: here === "developers" ? "on" : "" })}${btn("mcp", {
    href: "/mcp-setup",
    cls: here === "mcp-setup" ? "on" : "",
  })}${btn("openapi.json", { href: "/openapi.json", cls: "dim" })}${btn("skill.md", {
    href: "/skill.md",
    cls: "dim",
  })}${btn("llms.txt", { href: "/llms.txt", cls: "dim" })}${btn("github", {
    href: "https://github.com/mrmps/classifier-dev",
    cls: "dim",
  })}</p></nav>`;

const FOOT = `<footer><p class="foot">built by <a class="inline" href="${SITE.author.x}">@${SITE.author.handle}</a> · <a class="inline" href="${SITE.author.cal}">book a call</a> · <a class="inline" href="/about">about</a> · <a class="inline" href="/contact">contact</a> · <a class="inline" href="/pricing">pricing</a> · <a class="inline" href="/privacy">privacy</a> · <a class="inline" href="/developers">developers</a></p></footer>`;

export function homeHtml(): string {
  const desc = "Zero-shot text classification over plain HTTP. No API key, no account.";
  return page({
    title: "classifier.dev",
    head: META("classifier.dev", desc) + JSON_LD(),
    css: HOME_CSS,
    body: `<div class="page"><main><article class="doc prose">
  <header><h1><span class="syn"># </span>classifier.dev</h1></header>
  <p class="quote">zero-shot text classification over plain HTTP — no API key, no account</p>
  ${NAV("home")}

  <section class="agent" id="agent">
    <h2><span class="syn">## </span>Give your agent this prompt</h2>
    <p class="lead">Paste it into any coding agent. It installs the skill and teaches the agent to classify text through this API &#8212; no key, no setup.</p>
    <div class="block prompt"><pre>${esc(AGENT_PROMPT)}</pre>
    <p class="row">${btn("copy prompt", {
      cls: "cta",
      icon: COPY_ICON,
      attrs: ` data-copy="1" data-text="${esc(AGENT_PROMPT)}"`,
    })}</p></div>
    <p class="row alt"><span class="or">or open it in</span>${btn("Claude Code", {
      cls: "dim",
      href: `claude-cli://open?q=${encodeURIComponent(AGENT_PROMPT)}`,
    })}${btn("Codex", {
      cls: "dim",
      href: `codex://threads/new?prompt=${encodeURIComponent(AGENT_PROMPT)}`,
    })}${btn("Cursor", {
      cls: "dim",
      href: `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(AGENT_PROMPT)}`,
    })}${btn("Grok", {
      cls: "dim",
      href: `https://grok.com/?q=${encodeURIComponent(AGENT_PROMPT)}`,
    })}</p>
  </section>

  ${vsJevSection()}

  <section>
    <h2><span class="syn">## </span>Try it</h2>
    <div class="block"><pre>curl https://classifier.dev/spam,not+spam/Win+a+free+iPhone
<span class="out">spam</span></pre>
    <p class="row">${btn("copy", {
      cls: "dim",
      icon: COPY_ICON,
      attrs: ' data-copy="1" data-text="curl https://classifier.dev/spam,not+spam/Win+a+free+iPhone"',
    })}</p></div>
  </section>

  <section>
    <h2><span class="syn">## </span>Install the CLI</h2>
    <div class="block"><pre>npm i -g classifier-dev</pre>
    <p class="row">${btn("copy", {
      cls: "dim",
      icon: COPY_ICON,
      attrs: ' data-copy="1" data-text="npm i -g classifier-dev"',
    })}</p></div>
    <p>Then sort a file, one <span class="k">label &#8677; confidence &#8677; text</span> line per
      input, in input order — a thousand lines a request, and rows appear as they land:</p>
    <div class="block"><pre>classify bug,feature,praise &lt; feedback.txt
classify relevant,"not relevant" --review 0.7 &lt; snippets.txt   <span class="out"># only the unsure ones</span></pre>
    <p class="row">${btn("copy", {
      cls: "dim",
      icon: COPY_ICON,
      attrs: ' data-copy="1" data-text="classify bug,feature,praise &lt; feedback.txt"',
    })}</p></div>
  </section>

  ${renderDoc(DOCS, true)}

  ${FOOT}
</article></main></div>`,
    script: COPY_SCRIPT + WEBMCP_SCRIPT,
  });
}

/** Any other plain-text document, rendered the same way the home page is. */
export function docHtml(o: { title: string; desc: string; doc: string; path: string; here: string }): string {
  return page({
    title: `${o.title} · classifier.dev`,
    head: META(o.title, o.desc, o.path),
    css: HOME_CSS,
    body: `<div class="page"><main><article class="doc prose">
  <header><h1><span class="syn"># </span>${esc(o.doc.split("\n")[0].trim())}</h1></header>
  <p class="quote">${esc(o.desc)}</p>
  ${NAV(o.here)}
  ${renderDoc(o.doc, true)}
  ${FOOT}
</article></main></div>`,
    script: COPY_SCRIPT,
  });
}

export function benchmarkHtml(): string {
  const desc = "Measured accuracy, calibration, cost and latency for every model considered.";
  return page({
    title: "benchmark · classifier.dev",
    head: META("classifier.dev benchmark", desc, "/benchmark"),
    css: HOME_CSS,
    body: `<div class="page"><main><article class="doc prose">
  <header><h1><span class="syn"># </span>classifier.dev benchmark</h1></header>
  <p class="quote">${esc(desc)}</p>
  ${NAV("benchmark")}
  ${renderDoc(BENCHMARK, true)}
  ${FOOT}
</article></main></div>`,
    script: COPY_SCRIPT,
  });
}
