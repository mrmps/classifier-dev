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

const HOME_CSS = `
.prose section>*+*{margin-top:14px}
.prose>section{margin-top:28px}
.lead{color:var(--muted)}
.block{position:relative}
.block>.row{margin-top:4px}
h2{scroll-margin-top:24px}
.foot{color:var(--dim);border-top:1px solid var(--rule);padding-top:16px}
`;

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

const META = (title: string, desc: string) => `<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index,follow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="classifier.dev">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="https://classifier.dev">
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

const NAV = (here: "home" | "benchmark") =>
  `<p class="row">${btn("home", { href: "/", cls: here === "home" ? "on" : "" })}${btn("benchmark", {
    href: "/benchmark",
    cls: here === "benchmark" ? "on" : "",
  })}${btn("openapi.json", { href: "/openapi.json", cls: "dim" })}${btn("skill.md", {
    href: "/skill.md",
    cls: "dim",
  })}${btn("llms.txt", { href: "/llms.txt", cls: "dim" })}${btn("github", {
    href: "https://github.com/mrmps/classifier-dev",
    cls: "dim",
  })}</p>`;

export function homeHtml(): string {
  const desc = "Zero-shot text classification over plain HTTP. No API key, no account.";
  return page({
    title: "classifier.dev",
    head: META("classifier.dev", desc),
    css: HOME_CSS,
    body: `<div class="page"><article class="doc prose">
  <h1><span class="syn"># </span>classifier.dev</h1>
  <p class="quote">zero-shot text classification over plain HTTP — no API key, no account</p>
  ${NAV("home")}

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
    <h2><span class="syn">## </span>Connect your agent</h2>
    <p class="row">${btn("Claude Code", {
      href: `claude-cli://open?q=${encodeURIComponent(AGENT_PROMPT)}`,
    })}${btn("Codex", {
      href: `codex://threads/new?prompt=${encodeURIComponent(AGENT_PROMPT)}`,
    })}${btn("Cursor", {
      href: `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(AGENT_PROMPT)}`,
    })}${btn("Grok", {
      href: `https://grok.com/?q=${encodeURIComponent(AGENT_PROMPT)}`,
    })}${btn("copy prompt", {
      cls: "dim",
      icon: COPY_ICON,
      attrs: ` data-copy="1" data-text="${esc(AGENT_PROMPT)}"`,
    })}</p>
  </section>

  ${renderDoc(DOCS, true)}

  <p class="foot">built by <a class="inline" href="https://x.com/michael_chomsky">@michael_chomsky</a> · <a class="inline" href="https://cal.com/michaelsf/coffee">book a call</a></p>
</article></div>`,
    script: COPY_SCRIPT,
  });
}

export function benchmarkHtml(): string {
  const desc = "Measured accuracy, calibration, cost and latency for every model considered.";
  return page({
    title: "benchmark · classifier.dev",
    head: META("classifier.dev benchmark", desc),
    css: HOME_CSS,
    body: `<div class="page"><article class="doc prose">
  <h1><span class="syn"># </span>classifier.dev benchmark</h1>
  <p class="quote">${esc(desc)}</p>
  ${NAV("benchmark")}
  ${renderDoc(BENCHMARK, true)}
</article></div>`,
    script: COPY_SCRIPT,
  });
}
