// The redesigned pages besides the home page: the shared shell (head, nav, art band, footer, scripts from
// src/site/shell-template.ts) around the plain-text documents, rendered by src/site/doc.ts.
//   docPage      developers, mcp-setup, privacy, terms: a sidebar of pages, the article, its contents
//   rowsPage     about, contact: a row per section, its title and links on the left, the text on the right
//   benchmarkPage  /benchmark: charts and tables from BENCHMARK and vs-jev.json
import { esc } from "../ui";
import { sitePage } from "./shell";
import { blocks, inline, ledeHtml, parse, ruledTable, slug, type Section } from "./doc";
import VS_JEV from "../vs-jev.json";
import { PRICING_TOP } from "./pricing-template";
import { fillValues } from "./home";

const sections = (list: Section[]) => list.map((s) => `<h2 id="${s.id}">${esc(s.title)}</h2>${blocks(s.body)}`).join("");

// ---------------------------------------------------------------- docs layout

const SIDE: { group: string; pages: [string, string][] }[] = [
  { group: "Docs", pages: [["/developers", "Developers"], ["/mcp-setup", "MCP setup"], ["/benchmark", "Benchmark"]] },
  { group: "Company", pages: [["/about", "About"], ["/contact", "Contact"], ["/privacy", "Privacy"], ["/terms", "Terms"]] },
];
const CHEV = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Pages are built from constants, so each (page, signed in) is rendered once per isolate. */
const built = new Map<string, string>();
const once = (key: string, make: () => string) => {
  let html = built.get(key);
  if (html === undefined) { html = make(); if (built.size < 64) built.set(key, html); }
  return html;
};

export const docPage = (o: Parameters<typeof renderDocPage>[0]) => once(`doc|${o.path}|${!!o.signedIn}`, () => renderDocPage(o));
export const rowsPage = (o: Parameters<typeof renderRowsPage>[0]) => once(`rows|${o.path}|${!!o.signedIn}`, () => renderRowsPage(o));

function renderDocPage(o: { path: string; heading: string; title: string; desc: string; doc: string; signedIn?: boolean }): string {
  const d = parse(o.doc);
  const lede = ledeHtml(d.lede);
  const side = SIDE.map((g) => `<p class="dside__group">${esc(g.group)}</p><ul>${g.pages
    .map(([href, name]) => `<li><a href="${href}"${href === o.path ? ' aria-current="page"' : ""}>${esc(name)}</a></li>`).join("")}</ul>`).join("");
  const body = `<div class="rail docs">
  <aside class="dside" aria-label="Pages">
    <button type="button" class="dside__toggle" id="dside-toggle" aria-expanded="false" aria-controls="dside-list"><span id="dside-current">${esc(o.heading)}</span>${CHEV}</button>
    <div class="dside__list" id="dside-list"><nav aria-label="Pages">${side}</nav></div>
  </aside>
  <div class="dmain">
<article class="darticle" data-title="${esc(o.heading)}"><header><h1 class="t-title" tabindex="-1">${esc(o.heading)}</h1>${lede.text ? `<p class="t-lede">${lede.text}</p>` : ""}</header>${lede.rest}${sections(d.sections)}</article>
  </div>
  <nav class="dtoc" id="dtoc" aria-label="On this page"></nav>
</div>`;
  return sitePage({ title: o.title, desc: o.desc, path: o.path, kind: "doc", body, signedIn: o.signedIn });
}

// ---------------------------------------------------------------- rows layout (about, contact)

const headBlock = (title: string, lede: string, extra = "") => `<section class="sec pg-head">
  <div class="rail">
    <div class="pg-head__copy">
      <h1 class="t-hero pg-head__title">${title}</h1>
      ${lede ? `<p class="pg-head__lede">${lede}</p>` : ""}${extra}
    </div>
  </div>
</section>`;

/** The links a section mentions, as buttons beside its title. */
function actions(body: string[]): string {
  const text = body.join(" ");
  const out = new Map<string, string>();
  for (const m of text.matchAll(/https?:\/\/[^\s<>()"'`]+|[\w.+-]+@[\w-]+\.[\w.]+/g)) {
    const u = m[0].replace(/[.,;:]+$/, "");
    if (/github\.com\/[^/]+\/[^/]+\/issues/.test(u)) out.set(u, "Open an issue");
    else if (/cal\.com\//.test(u)) out.set(u, "Book a call");
    else if (/^https:\/\/x\.com\/(\w+)/.test(u)) out.set(u, `@${u.split("/")[3]} on X`);
    else if (u.includes("@") && !u.startsWith("http")) out.set(`mailto:${u}`, u);
    else if (/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(u)) out.set(u, "Source on GitHub");
    else if (/^https:\/\/classifier\.dev\/(benchmark|mcp-setup|pricing|developers)$/.test(u)) {
      const page = u.split("/").pop()!;
      out.set(`/${page}`, { benchmark: "Benchmark", "mcp-setup": "MCP setup", pricing: "Pricing", developers: "Developers" }[page]!);
    }
  }
  return [...out].slice(0, 3)
    .map(([href, label]) => `<a class="btn btn--soft btn--sm" href="${esc(href)}"${href.startsWith("http") ? ' target="_blank" rel="noopener"' : ""}>${esc(label)}</a>`).join("");
}

/** A section whose every line starts with a link becomes a list of links: the page's name, then what it is for. */
function linkList(body: string[]): string | null {
  const lines = body.map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2 || !lines.every((l) => /^https?:\/\//.test(l))) return null;
  const items = lines.map((l) => {
    const [url, ...rest] = l.split(/\s+/);
    const href = url.replace(/^https:\/\/classifier\.dev/, "") || "/";
    const name = href.replace(/^\//, "").replace(/[-/]/g, " ");
    const what = rest.join(" ").replace(/^for /, "").replace(/[,.]$/, "");
    return `<li><a href="${esc(href)}"><b>${esc(name.charAt(0).toUpperCase() + name.slice(1))}</b><span>${esc(what.charAt(0).toUpperCase() + what.slice(1))}</span><svg class="i" aria-hidden="true"><use href="#i-arrow-right"/></svg></a></li>`;
  });
  return `<ul class="plinks">${items.join("")}</ul>`;
}

function renderRowsPage(o: { path: string; heading: string; title: string; desc: string; doc: string; signedIn?: boolean }): string {
  const d = parse(o.doc);
  const lede = ledeHtml(d.lede);
  const rows = d.sections.map((s) => {
    const list = linkList(s.body);
    const acts = list ? "" : actions(s.body);
    return `    <div class="cells prow" id="${s.id}">
      <div class="cell prow__head"><h2 class="prow__title">${esc(s.title)}</h2>${acts ? `<div class="prow__acts">${acts}</div>` : ""}</div>
      <div class="cell prow__body">${list ?? blocks(s.body)}</div>
    </div>`;
  }).join("\n");
  const body = `${headBlock(esc(o.heading), lede.text)}\n<section class="sec prows">\n  <div class="rail">\n${rows}\n  </div>\n</section>`;
  return sitePage({ title: o.title, desc: o.desc, path: o.path, kind: "rows", body, signedIn: o.signedIn });
}

// ---------------------------------------------------------------- benchmark

type Bar = { name: string; sub?: string; v: number; us?: boolean };
const pctOf = (s: string) => (/^~?\d+(\.\d+)?%$/.test(s) ? Number(s.replace(/[~%]/g, "")) : NaN);
const fmt = (v: number) => `${v.toFixed(1)}%`;
function bars(list: Bar[], label: string): string {
  return `<div class="bars" role="img" aria-label="${esc(label)}">${list.map((b) =>
    `<div class="bars__row${b.us ? " is-us" : ""}"><span class="bars__name">${esc(b.name)}${b.sub ? `<small>${esc(b.sub)}</small>` : ""}</span><span class="bars__track"><span class="bars__bar" style="--v:${(b.v / 100).toFixed(4)}"></span></span><span class="bars__num">${fmt(b.v)}</span></div>`).join("")}</div>`;
}
const card = (title: string, body: string, wide = false) => `<div class="cell bcard${wide ? " bcard--wide" : ""}">${title ? `<h3 class="cell__title">${esc(title)}</h3>` : ""}${body}</div>`;

/** Prose paragraphs of a section (indented or not), and its preformatted blocks, apart. */
function split(body: string[]) {
  const paras: string[] = [], pres: string[][] = [];
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    if (buf.some((l) => /^\s*-{5,}\s*$/.test(l)) || buf.every((l) => /^\s{3,}/.test(l))) pres.push(buf);
    else paras.push(inline(buf.map((l) => l.trim()).join(" ")));
    buf = [];
  };
  for (const l of body) { if (!l.trim()) flush(); else buf.push(l); }
  flush();
  return { paras, pres };
}

function bsec(s: Section, cards: string, foot: string[]): string {
  const { paras } = split(s.body);
  const lede = paras[0] ?? "";
  return `<section class="sec bsec" id="${s.id}" aria-labelledby="${s.id}-t">
  <div class="rail">
    <div class="sec-head"><div class="sec-head__copy"><h2 class="t-title" id="${s.id}-t">${esc(s.title)}</h2>${lede ? `<p class="t-body">${lede}</p>` : ""}</div></div>
    ${cards ? `<div class="cells cells--2">${cards}</div>` : ""}${foot.map((f) => `<p class="bsec__foot">${f}</p>`).join("")}
  </div>
</section>`;
}

type Summary = { n: number; unsure: number; rows: Record<string, { acc: number; acc_unsure: number }> };
const SETS: Record<string, string> = { ag_news: "AG News", emotion: "Emotion" };

export function benchmarkSections(doc: string) {
  const d = parse(doc);
  const out: string[] = [];
  for (const s of d.sections) {
    const { paras, pres } = split(s.body);
    // The sign-off ("Built by …") is the footer's job on this page.
    const foot = paras.slice(1).filter((p) => !/^Built by /.test(p));
    const key = s.id.replace(/-the-smart-tier$/, "");
    if (key === "against-the-model-it-runs-on") {
      const summary = VS_JEV.summary as unknown as Record<string, Summary>;
      const cards = Object.entries(summary).filter(([k]) => SETS[k]).map(([k, x]) => card(SETS[k], bars([
        { name: "Fast", sub: `all ${x.n}`, v: x.rows.jev.acc * 100 },
        { name: "Smart", sub: `all ${x.n}`, v: x.rows.smart.acc * 100, us: true },
        { name: "Fast", sub: `the ${x.unsure} Jev was unsure about`, v: x.rows.jev.acc_unsure * 100 },
        { name: "Smart", sub: `the ${x.unsure} Jev was unsure about`, v: x.rows.smart.acc_unsure * 100, us: true },
      ], `${SETS[k]}: Fast and Smart, overall and on the items Jev was unsure about`))).join("");
      out.push(bsec(s, cards, foot));
      continue;
    }
    const tables = pres.map((p) => ({ p, t: ruledTable(p) }));
    if (key === "single-label" && tables[0]?.t) {
      const { head, rows } = tables[0].t;
      const sets = head.map((h, i) => [h, i] as const).filter(([, i]) => i > 0 && rows.some((r) => !Number.isNaN(pctOf(r[i]))));
      const others = head.map((h, i) => [h, i] as const).filter(([, i]) => i > 0 && !sets.some(([, j]) => j === i));
      const cap = (h: string) => h.charAt(0).toUpperCase() + h.slice(1);
      const cards = sets.map(([h, i]) => card(`${cap(h)} accuracy`, bars(rows.filter((r) => !Number.isNaN(pctOf(r[i]))).map((r, k) => {
        const m = r[0].match(/^(.*?)\s*\((.*)\)$/) ?? r[0].match(/^(.*?),\s*(.*)$/);
        return { name: m ? m[1] : r[0], sub: m ? m[2] : undefined, v: pctOf(r[i]), us: k === 0 };
      }), `${h} accuracy`))).join("")
        + card("Speed and cost", `<div class="dtable btable"><table><thead><tr><th scope="col">${esc(head[0])}</th>${others.map(([h]) => `<th scope="col" class="n">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r, k) => `<tr${k === 0 ? ' class="is-us"' : ""}><td>${esc(r[0])}</td>${others.map(([, i]) => `<td class="n">${esc(r[i])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`, true);
      out.push(bsec(s, cards, foot));
      continue;
    }
    if (key === "calibration") {
      const rows = s.body.map((l) => l.match(/^\s*([[(][\d.]+,\s*[\d.]+[\])])\s+(\d+)\s+([\d.]+%)\s+(\d+)\s+([\d.]+%)\s*$/)).filter(Boolean) as RegExpMatchArray[];
      const label = (b: string) => { const [lo, hi] = b.slice(1, -1).split(/,\s*/); return lo === "0.0" ? `Below ${hi}` : `${lo} to ${hi}`; };
      const cards = rows.length
        ? card("AG News", bars(rows.map((r, k) => ({ name: label(r[1]), sub: `${r[2]} items`, v: pctOf(r[3]), us: k === 0 })), "AG News accuracy by confidence"))
          + card("Emotion", bars(rows.map((r, k) => ({ name: label(r[1]), sub: `${r[4]} items`, v: pctOf(r[5]), us: k === 0 })), "Emotion accuracy by confidence"))
        : "";
      out.push(bsec(s, cards, foot));
      continue;
    }
    // Everything else: its tables as tables, the rest as prose. Column groups ("emotion, 122 uncertain")
    // head the columns under them; the row for what the service runs is marked, as on the charts.
    const cards = tables.map(({ p, t }) => {
      if (!t) return card("", blocks(p), true);
      const span = t.groups.length && (t.head.length - 1) % t.groups.length === 0 ? (t.head.length - 1) / t.groups.length : 0;
      const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
      const groupRow = span ? `<tr><td></td>${t.groups.map((g) => `<th scope="colgroup" colspan="${span}" class="n">${esc(cap(g))}</th>`).join("")}</tr>` : "";
      const ours = (r: string[], k: number) => /\((smart|fast)\)|classifier[-.]/.test(r[0]) || (key === "multi-label" && k === 0);
      return card("", `<div class="dtable btable"><table><thead>${groupRow}<tr>${t.head.map((h, i) => `<th scope="col"${i ? ' class="n"' : ""}>${esc(cap(h))}</th>`).join("")}</tr></thead><tbody>${t.rows
        .map((r, k) => `<tr${ours(r, k) ? ' class="is-us"' : ""}>${r.map((c, i) => `<td${i ? ' class="n"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${t.notes.map((n) => `<p class="cell__body bcard__note">${inline(n)}</p>`).join("")}`, true);
    }).join("");
    out.push(bsec(s, cards, foot));
  }
  return { title: d.title, lede: ledeHtml(d.lede).text, html: out.join("\n") };
}

export const benchmarkPage = (doc: string, signedIn = false) => once(`benchmark|${signedIn}`, () => renderBenchmarkPage(doc, signedIn));
function renderBenchmarkPage(doc: string, signedIn = false): string {
  const b = benchmarkSections(doc);
  const body = `${headBlock("Benchmark", b.lede, `<p class="pg-head__meta"><a class="inline" href="https://github.com/mrmps/classifier-dev/tree/main/eval">eval/ on GitHub</a></p>`)}\n${b.html}`;
  return sitePage({ title: "Benchmark, classifier.dev", desc: "classifier.dev measured on public test sets: accuracy, calibration, escalation, multi-label and speed.", path: "/benchmark", kind: "benchmark", body, signedIn });
}

export { slug };

// ---------------------------------------------------------------- pricing

/** A section's prose paragraphs; its aligned key-value lines are what the designed blocks above show. */
function prose(body: string[]): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length && !buf.some((l) => /\S {2,}\S/.test(l.trim())) && !/^\s{4,}/.test(buf[0])) out.push(inline(buf.map((l) => l.trim()).join(" ")));
    buf = [];
  };
  for (const l of body) { if (!l.trim()) flush(); else buf.push(l); }
  flush();
  return out;
}

export const pricingPage = (doc: string, signedIn = false) => once(`pricing|${signedIn}`, () => renderPricingPage(doc, signedIn));
function renderPricingPage(doc: string, signedIn = false): string {
  const d = parse(doc);
  // Sections whose aligned figures the designed blocks above already show keep only their prose;
  // the rest (pay as you go, for one) render whole, tables included.
  const SHOWN = new Set(["free", "pro", "scale", "enterprise", "usage-prices", "rate-limits"]);
  const rows = [{ title: "Before you start", id: "before-you-start", body: d.lede }, ...d.sections]
    .map((s) => ({ ...s, html: SHOWN.has(s.id) || s.id === "before-you-start" ? prose(s.body).map((p) => `<p>${p}</p>`).join("") : blocks(s.body) }))
    .filter((s) => s.html)
    .map((s) => `    <div class="cells prow" id="${s.id}">
      <div class="cell prow__head"><h2 class="prow__title">${esc(s.title)}</h2></div>
      <div class="cell prow__body">${s.html}</div>
    </div>`).join("\n");
  const body = [
    headBlock("Pricing", "Try it without an API key, account or card. Create a workspace when you want usage credits, named API keys, shared billing and usage by connection."),
    fillValues(PRICING_TOP),
    '<section class="sec pg-sub"><div class="rail"><div class="sec-head"><div class="sec-head__copy"><h2 class="t-title">Details</h2><p class="t-body">The fine print, as the plain-text pricing page has it.</p></div></div></div></section>',
    `<section class="sec prows">\n  <div class="rail">\n${rows}\n  </div>\n</section>`,
  ].join("\n");
  return sitePage({ title: "Pricing, classifier.dev", desc: "Start free, then add a workspace plan for usage credits, API keys and billing.", path: "/pricing", kind: "pricing", body, signedIn });
}

export { sitePage, messagePage } from "./shell";
