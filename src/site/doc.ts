// The plain-text documents (src/docs.ts, src/pages.ts) rendered for the redesigned pages. The text is the
// same text curl and the Markdown get; only the markup differs: UPPERCASE headings become sections, aligned
// columns become tables, commands and code become copyable blocks, everything else is prose.
import { esc, codeLang } from "../ui";
import { headingTitle, isCommandBlock, isHeading, isPreBlock } from "../pages";

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Escape a run of text, link its URLs, emails and site paths, and set `ticked` spans as code. */
export function inline(text: string): string {
  return text
    .split(/(`[^`]+`|https?:\/\/[^\s<>()"'`]+|[\w.+-]+@[\w-]+\.[\w.]+)/)
    .map((part, i) => {
      if (i % 2 === 0) return esc(part);
      if (part.startsWith("`")) return `<code>${esc(part.slice(1, -1))}</code>`;
      const trail = part.match(/[.,;:]+$/)?.[0] ?? "";
      const core = part.slice(0, part.length - trail.length);
      if (/[{}]/.test(core)) return esc(part);
      const href = core.includes("@") && !core.startsWith("http") ? `mailto:${core}` : core;
      return `<a class="inline" href="${esc(href)}">${esc(core)}</a>${esc(trail)}`;
    })
    .join("");
}

/** Code keeps its text as typed; only its URLs become links (a quote after one ends it). */
function linkUrls(text: string): string {
  return text.split(/(https?:\/\/[^\s<>()"'`]+)/).map((part, i) => {
    if (i % 2 === 0) return esc(part);
    const trail = part.match(/[.,;:]+$/)?.[0] ?? "";
    const href = part.slice(0, part.length - trail.length);
    return /[{}]/.test(href) ? esc(part) : `<a class="inline" href="${esc(href)}">${esc(href)}</a>${esc(trail)}`;
  }).join("");
}

const COPY = '<button type="button" class="copy" aria-label="Copy"><span class="swap"><span>Copy</span><span>Copied</span></span></button>';

/** Column starts of an aligned line: 0, then wherever text resumes after two or more spaces. */
function columns(line: string): number[] {
  const first = line.search(/\S/);
  const starts = [first];
  for (const m of line.matchAll(/ {2,}(?=\S)/g)) if (m.index! > first) starts.push(m.index! + m[0].length);
  return starts;
}

const RULE = /^\s*-{5,}\s*$/;
// A bracketed aside ("gemini-3.8-flash  (smart)") belongs to the cell before it.
const cellsOf = (l: string) => l.trim().split(/\s{2,}/).reduce<string[]>((out, c) => {
  if (/^\(.*\)$/.test(c) && out.length) out[out.length - 1] += ` ${c}`;
  else out.push(c.replace(/^->\s*/, "→ "));
  return out;
}, []);

/** A table whose header is underlined with dashes: rows split at runs of two or more spaces. */
export function ruledTable(lines: string[]): { head: string[]; rows: string[][]; group: string; notes: string[] } | null {
  const rows = lines.filter((l) => l.trim());
  const r = rows.findIndex((l) => RULE.test(l));
  if (r < 1) return null;
  const head = cellsOf(rows[r - 1]);
  const all = rows.slice(r + 1).map(cellsOf);
  const body = all.filter((c) => c.length === head.length);
  if (!body.length || body.length < all.length / 2) return null;
  // A row that does not fit the columns ("0.43 (parse failures)") is kept as a note under the table.
  const notes = rows.slice(r + 1).filter((_, i) => all[i].length !== head.length).map((l) => l.trim().replace(/\s{2,}/g, " "));
  // A second header line above names the column groups ("AG News", "emotion").
  const group = r >= 2 ? cellsOf(rows[r - 2]).join(" · ") : "";
  return { head, rows: body, group, notes };
}

const tableHtml = (head: string[] | null, rows: string[][]) =>
  `<div class="dtable"><table>${head ? `<thead><tr>${head.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead>` : ""}<tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c.split("\n").map(inline).join("<br>")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

/** A block of aligned columns as a table, or null when it is not one. */
function table(lines: string[]): string | null {
  const ruled = ruledTable(lines);
  if (ruled) return tableHtml(ruled.head, ruled.rows) + ruled.notes.map((n) => `<p class="dtable__note">${inline(n)}</p>`).join("");
  const rows = lines.filter((l) => l.trim());
  if (rows.length < 2 || isCommandBlock(rows) || codeLang(rows)) return null;
  const base = rows[0].search(/\S/);
  const starts = rows.filter((l) => l.search(/\S/) === base);
  // Every row of a table has text in its first column and a gap before the next.
  if (starts.some((l) => !/\S {2,}\S/.test(l.trim()))) return null;
  // As many columns as the sparest row has; a value with gaps of its own stays one cell.
  const n = Math.min(...starts.map((l) => columns(l).length));
  if (n < 2) return null;
  const tidy = (c: string) => c.trim().replace(/\s{2,}/g, " ");
  const out: string[][] = [];
  for (const l of rows) {
    const indent = l.search(/\S/);
    if (indent !== base) {
      // A line that starts further in continues the last cell of the row above it.
      if (indent < base || !out.length) return null;
      const prev = out[out.length - 1];
      prev[n - 1] = `${prev[n - 1]}\n${tidy(l)}`;
      continue;
    }
    const st = columns(l);
    out.push(Array.from({ length: n }, (_, k) => tidy(l.slice(st[k], k + 1 < n ? st[k + 1] : undefined))));
  }
  const header = n >= 3 && out[0].every((c) => c && c.length < 24 && !/[/:.]|\d/.test(c));
  return tableHtml(header ? out[0] : null, header ? out.slice(1) : out);
}

/** The blocks of one section: paragraphs, tables and copyable code. */
export function blocks(body: string[]): string {
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    const lines = buf;
    buf = [];
    // A double space after a full stop is a typing habit, not a column.
    const proseLike = !isCommandBlock(lines) && !codeLang(lines) && lines.every((l) => /^ {0,2}\S/.test(l) && !/[^.?!:\s] {2,}\S/.test(l.trim()));
    if (!isPreBlock(lines) || proseLike) {
      out.push(`<p>${inline(lines.map((l) => l.trim()).join(" "))}</p>`);
      return;
    }
    const t = table(lines);
    if (t) { out.push(t); return; }
    const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
    const text = lines.map((l) => l.slice(indent)).join("\n");
    // Marked by language like the plain-text pages' blocks: commands as bash, code by what it looks like.
    const lang = isCommandBlock(lines) ? "bash" : codeLang(lines);
    const code = lang ? `<code class="language-${lang}">${linkUrls(text)}</code>` : linkUrls(text);
    out.push(`<div class="codeblock"><pre tabindex="0">${code}</pre>${COPY}</div>`);
  };
  for (const line of body) {
    if (!line.trim()) flush();
    else buf.push(line);
  }
  flush();
  return out.join("");
}

export type Section = { title: string; id: string; body: string[] };

/** An UPPERCASE heading (src/pages.ts isHeading, which also takes a lowercase aside in brackets). */
const isHead = isHeading;

/** A document's title line, its lead (the text before the first heading) and its sections. */
export function parse(doc: string): { title: string; lede: string[]; sections: Section[] } {
  const lines = doc.replace(/\s+$/, "").split("\n");
  const title = lines[0].trim();
  let i = 1;
  const lede: string[] = [];
  while (i < lines.length && !isHead(lines[i])) lede.push(lines[i++]);
  const sections: Section[] = [];
  while (i < lines.length) {
    const head = lines[i++].trim();
    const body: string[] = [];
    while (i < lines.length && !isHead(lines[i])) body.push(lines[i++]);
    const aside = head.match(/ (\([a-z0-9 ,'-]+\))$/)?.[1];
    const t = aside ? `${headingTitle(head.slice(0, -aside.length - 1))} ${aside}` : headingTitle(head);
    sections.push({ title: t, id: slug(t), body });
  }
  return { title, lede, sections };
}

/** The lead as plain sentences (for the page header) when it is prose; otherwise rendered blocks. */
export function ledeHtml(lede: string[]): { text: string; rest: string } {
  const paras = lede.join("\n").trim().split(/\n\s*\n/);
  if (!paras[0] || isPreBlock(paras[0].split("\n"))) return { text: "", rest: blocks(lede) };
  return { text: inline(paras[0].split("\n").map((l) => l.trim()).join(" ")), rest: blocks(paras.slice(1).join("\n\n").split("\n")) };
}
