/**
 * The shared look: a markdown document rendered in a terminal.
 *
 * The syntax stays visible and unselectable, controls are bracketed and fill
 * on hover, and nothing is a card. One accent, the lavender of the mark;
 * two greys for chrome, a rule and a line; corners from the mark. Both
 * the public site and /admin are built from these tokens so the two cannot
 * drift apart.
 */

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export const BASE_CSS = `
:root{
  /* One neutral ramp, named by job. Text steps down in four, the chrome in three. */
  --bg:#0b0e14; --surface:#10141c;
  --bright:#f5f5f5; --fg:#e5e5e5; --muted:#a3a3a3; --dim:#858585; --syntax:#525252;
  --rule:#20252e; --line:#323947;
  /* A field has to be found by its edge alone, so its edge clears 3:1 on the surface it sits in. */
  --line-strong:#5c6473;
  /* One accent: the brand mark's purple, and the ink it prints in. Interactive
     things are purple; a purple fill carries ink. Nothing else is coloured. */
  --accent:#aa63ff; --accent-hover:#bb82ff; --ink:#190727;
  --code-string:#c4b4ff;
  /* Two status colours: something went wrong, and, in a comparison, the
     better number. Neither means interactive. */
  --bad:#f87171; --good:#7fd39a;
  /* Corners follow the mark, which is a rounded square holding pills: 8px on
     a surface or a field, 4px on the fill a bare control gets under the
     pointer. A surface nested in another keeps its curves parallel by taking
     the inner radius plus the inset (the concentric rule). */
  --r:8px; --r-s:4px;
  /* The documents wrap at 78 columns; the page holds them to the same measure. */
  --measure:80ch;
}
@media (color-gamut:p3){:root{--accent:color(display-p3 .63 .40 1);--accent-hover:color(display-p3 .70 .52 1);
  --ink:color(display-p3 .075 .018 .13)}}
*{box-sizing:border-box}
html{color-scheme:dark}
/* Grayscale antialiasing, not subpixel. On a dark ground the subpixel method
   draws light type heavy and colour-fringed; grayscale is lighter and closer
   to the letterforms. The property inherits, so the body is the one place it
   is set. It is a macOS property: Windows keeps ClearType regardless. Since
   grayscale takes weight out of every glyph, nothing on the site is drawn
   below the regular weight, and text under the base size steps its weight up
   (the dashboard's 11px axis labels and 12px tooltip are the two cases). */
body{margin:0;background:var(--bg);color:var(--fg);
  font:14px/1.625 ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
.page{padding:64px 16px}
.doc{max-width:var(--measure);margin:0 auto}
.doc>*+*{margin-top:24px}
section>*+*{margin-top:8px}
h1{font-size:20px;font-weight:700;color:var(--bright);margin:0;letter-spacing:-.01em;
  text-wrap:balance}
h2{font-size:14px;font-weight:600;color:var(--fg);margin:0;text-wrap:balance}
p{margin:0;text-wrap:pretty}
/* Markdown syntax: visible, muted, never part of a copy. */
.syn{user-select:none;color:var(--syntax)}
.quote{border-inline-start:2px solid var(--line);padding-inline-start:12px;color:var(--muted)}
.row{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center}
/* A bare bracket is the control's visible edge, so it sits on the text column
   and its 6px of padding hangs into the gap; the gap is 6px wider to hold it.
   A wrapped row then starts on the column too. */
.row>.b:not(.cta){margin-inline-start:-6px}
/* One focus ring for everything that can take focus: the accent, held off the
   edge so it reads on a filled control as well as a bare one. */
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
/* The bracketed control. Hover fills it, exactly like a selected line.
   min-height is the WCAG 2.5.8 target; the brackets alone are shorter than that. */
.b{display:inline-flex;align-items:center;gap:6px;padding:0 6px;min-height:24px;color:var(--accent);
  text-decoration:none;background:none;border:0;border-radius:var(--r-s);font:inherit;cursor:pointer;
  -webkit-appearance:none;appearance:none;
  transition-property:background-color,color;transition-duration:.1s;white-space:nowrap}
.b .br{user-select:none;color:var(--syntax);transition:color .1s}
.b.dim{color:var(--muted)}
/* The page you are on: bright, with its brackets lit, and no fill — the fill is
   for the one action on the page. */
.b.on{color:var(--bright)}
.b.on .br{color:var(--muted)}
.b svg{width:15px;height:15px;flex:none}
/* A bare URL is longer than a phone is wide; let it break rather than widen the page. */
a.inline{color:var(--accent);text-decoration:none;padding:0 2px;border-radius:var(--r-s);
  transition-property:background-color,color;transition-duration:.1s;overflow-wrap:anywhere}
/* Hover only where a pointer can actually hover, so a tap does not stick. */
@media (hover:hover){
  .b:hover,a.inline:hover{background:var(--accent);color:var(--ink)}
  .b:hover .br{color:var(--ink);opacity:.55}
  details>summary:hover{color:var(--fg)}
}
.note{border-inline-start:2px solid var(--fg);padding-inline-start:12px;color:var(--muted)}
.note b{color:var(--fg);font-weight:600}
pre{margin:0;padding:10px 12px;background:var(--surface);border:1px solid var(--line);
  border-radius:var(--r);overflow-x:auto;color:var(--fg);font:inherit;line-height:1.55}
pre .out{color:var(--dim)}
.scroll{overflow-x:auto}
/* A wide block on a narrow screen: a faint lit edge where there is more, and
   nothing at all once the end is in view. Two background layers scroll with
   the content and cover two that do not, so the cue is drawn by the overflow
   itself rather than by a script. */
pre,.scroll{--edge:rgba(255,255,255,.09);
  background-image:linear-gradient(to right,var(--surface) 24px,transparent),
    linear-gradient(to left,var(--surface) 24px,transparent),
    linear-gradient(to right,var(--edge),transparent),
    linear-gradient(to left,var(--edge),transparent);
  background-position:left,right,left,right;background-repeat:no-repeat;
  background-size:32px 100%,32px 100%,16px 100%,16px 100%;
  background-attachment:local,local,scroll,scroll;
  background-color:var(--surface)}
.scroll{--surface:var(--bg);background-color:transparent}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{text-align:right;padding:2px 10px 2px 0;white-space:nowrap}
th:first-child,td:first-child{text-align:left}
th{color:var(--dim);font-weight:500;border-bottom:1px solid var(--rule)}
td{color:var(--fg)}
details>summary{cursor:pointer;color:var(--muted);list-style:none;user-select:none;padding:2px 0}
details>summary::-webkit-details-marker{display:none}
details>summary::before{content:"▸ ";color:var(--syntax)}
details[open]>summary::before{content:"▾ ";color:var(--syntax)}
.empty{color:var(--dim)}
@media (max-width:640px){
  .page{padding:40px 12px}
  .doc{font-size:13px}
}
/* Motion is decoration here; every state also changes colour. */
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{transition-duration:.01ms !important;animation-duration:.01ms !important;
    animation-iteration-count:1 !important;scroll-behavior:auto !important}
}
`;


export const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

/** A bracketed control — the one interactive idiom on either page. */
export function btn(
  label: string,
  opts: { href?: string; cls?: string; icon?: string; attrs?: string; type?: "button" | "submit" } = {},
) {
  const inner = `<span class="br">[</span>${opts.icon ?? ""}<span class="lbl">${esc(label)}</span><span class="br">]</span>`;
  const cls = `b${opts.cls ? ` ${opts.cls}` : ""}`;
  return opts.href
    ? `<a class="${cls}" href="${opts.href}"${opts.attrs ?? ""}>${inner}</a>`
    : `<button type="${opts.type ?? "button"}" class="${cls}"${opts.attrs ?? ""}>${inner}</button>`;
}

/**
 * Which language a code block is in, read off the block itself rather than
 * from a marker in the text, so the plain text stays plain. A block whose
 * first line is a command is shell, however many result lines follow it. A
 * table or a list of endpoints is no language, and is left unhighlighted.
 */
export function codeLang(lines: string[]): string | undefined {
  const rows = lines.map((l) => l.trim()).filter(Boolean);
  const first = rows[0] ?? "";
  const text = rows.join("\n");
  if (/^(curl|npm|npx|pip|go get|classify|claude|codex)(?![:\w])|^\$ /.test(first)) return "bash";
  if (/:=|^(func|package) /m.test(text)) return "go";
  if (/^(from \S+ import |import [a-zA-Z_][\w.]*$|def |print\()/m.test(text)) return "python";
  if (/^(const|let|var|await|import|export|function)\b|=>/m.test(text)) return "javascript";
  if (/^[{[]/.test(first) && /[}\]]$/.test(rows[rows.length - 1])) return "json";
  return undefined;
}

/**
 * Syntax colour comes from highlight.js on cdnjs — one immutable file, a year
 * of cache, on the same edge as this site. Pinned by version and by hash, so
 * what runs is what was reviewed. The page reads fine without it: the blocks
 * are plain <pre><code> until it arrives, and the copy control reads text.
 */
export const HL_VERSION = "11.11.1";
export const HL_SRC = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/${HL_VERSION}/highlight.min.js`;
export const HL_INTEGRITY = "sha384-RH2xi4eIQ/gjtbs9fUXM68sLSi99C7ZWBRX1vDrVv6GQXRibxXLbwO2NGZB74MbU";
/** Where a page's Content-Security-Policy lets scripts come from besides itself. */
export const HL_ORIGIN = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/${HL_VERSION}/`;
export const HL_HEAD = `<script defer src="${HL_SRC}" integrity="${HL_INTEGRITY}" crossorigin="anonymous"></script>`;
export const HL_SCRIPT = `<script>
// Colour the code once highlight.js has arrived (deferred scripts run before
// DOMContentLoaded). It re-serialises each block from its text, which drops
// the links the server put on URLs, so they are put back on the text nodes.
addEventListener("DOMContentLoaded", () => {
  if (!window.hljs) return;
  hljs.configure({ ignoreUnescapedHTML: true });
  for (const code of document.querySelectorAll("pre>code[class*=language-]")) {
    hljs.highlightElement(code);
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      if (!/https?:\\/\\//.test(n.data) || n.parentElement.closest("a")) continue;
      const frag = document.createDocumentFragment();
      let at = 0;
      for (const m of n.data.matchAll(/https?:\\/\\/[^\\s<>()"']+/g)) {
        const trail = m[0].match(/[.,;:]+$/)?.[0] ?? "";
        const href = m[0].slice(0, m[0].length - trail.length);
        frag.append(n.data.slice(at, m.index));
        const a = document.createElement("a");
        a.className = "inline"; a.href = href; a.textContent = href;
        frag.append(a);
        at = m.index + href.length;
      }
      frag.append(n.data.slice(at));
      n.replaceWith(frag);
    }
  }
});
</script>`;

/* The theme: the site's greys and its one accent, nothing else. Names and
   keywords step up to bright; strings carry a wash of the accent; comments
   step down to dim. Everything else keeps the body colour. */
export const HL_CSS = `
pre>code{font:inherit;color:inherit;background:none;padding:0}
.hljs-keyword,.hljs-built_in,.hljs-type,.hljs-title,.hljs-literal,.hljs-number{color:var(--bright);font-weight:600}
.hljs-string,.hljs-attr,.hljs-meta{color:var(--code-string)}
.hljs-comment,.hljs-doctag{color:var(--dim)}
.hljs-variable,.hljs-params,.hljs-punctuation,.hljs-operator,.hljs-property{color:inherit}
`;

export function page(o: { title: string; head?: string; css?: string; body: string; script?: string }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0b0e14">
<title>${esc(o.title)}</title>
${o.head ?? ""}
<style>${BASE_CSS}${o.css ?? ""}</style></head>
<body>${o.body}${o.script ?? ""}</body></html>`;
}
