/**
 * The shared look: a markdown document rendered in a terminal.
 *
 * The syntax stays visible and unselectable, controls are bracketed and fill
 * on hover, and nothing is a card. Both the public site and /admin are built
 * from these tokens so the two cannot drift apart.
 */

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export const BASE_CSS = `
:root{
  --bg:#0b0e14;
  --fg:#e5e5e5; --bright:#f5f5f5; --muted:#a3a3a3; --dim:#737373;
  --syntax:#525252; --line:#404040; --rule:#262626;
  --blue:#58a6ff; --blue-bg:#1f6feb; --blue-fg:#bfdbfe;
  --amber:#d29922; --green:#3fb950; --red:#f85149;
}
*{box-sizing:border-box}
html{color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--fg);
  font:14px/1.625 ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  -webkit-font-smoothing:antialiased}
.page{padding:64px 16px}
.doc{max-width:896px;margin:0 auto}
.doc>*+*{margin-top:24px}
section>*+*{margin-top:8px}
h1{font-size:20px;font-weight:700;color:var(--bright);margin:0;letter-spacing:-.01em}
h2{font-size:14px;font-weight:600;color:var(--fg);margin:0}
p{margin:0}
/* Markdown syntax: visible, muted, never part of a copy. */
.syn{user-select:none;color:var(--syntax)}
.quote{border-left:2px solid var(--rule);padding-left:12px;color:var(--muted)}
.row{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
/* The bracketed control. Hover and focus fill, exactly like a selected line. */
.b{display:inline-flex;align-items:center;gap:6px;padding:0 6px;color:var(--blue);
  text-decoration:none;background:none;border:0;font:inherit;cursor:pointer;
  -webkit-appearance:none;appearance:none;
  outline:none;transition:background-color .1s,color .1s;white-space:nowrap}
.b:hover,.b:focus-visible{background:var(--blue-bg);color:#fff}
.b .br{user-select:none;color:var(--syntax);transition:color .1s}
.b:hover .br,.b:focus-visible .br{color:var(--blue-fg)}
.b.dim{color:var(--muted)}
.b.on{background:var(--blue-bg);color:#fff}
.b.on .br{color:var(--blue-fg)}
.b svg{width:15px;height:15px;flex:none}
/* A bare URL is longer than a phone is wide; let it break rather than widen the page. */
a.inline{color:var(--blue);text-decoration:none;padding:0 2px;transition:background-color .1s,color .1s;
  overflow-wrap:anywhere}
a.inline:hover,a.inline:focus-visible{background:var(--blue-bg);color:#fff;outline:none}
.note{border-left:2px solid var(--amber);padding-left:12px;color:var(--muted)}
.note b{color:var(--fg);font-weight:600}
pre{margin:0;padding:10px 12px;background:#11161f;border:1px solid var(--rule);
  overflow-x:auto;color:var(--fg);font:inherit;line-height:1.55}
pre .out{color:var(--dim)}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{text-align:right;padding:2px 10px 2px 0;white-space:nowrap}
th:first-child,td:first-child{text-align:left}
th{color:var(--dim);font-weight:500;border-bottom:1px solid var(--rule)}
td{color:var(--fg)}
details>summary{cursor:pointer;color:var(--muted);list-style:none;user-select:none;padding:2px 0}
details>summary::-webkit-details-marker{display:none}
details>summary:hover{color:var(--fg)}
details>summary::before{content:"▸ ";color:var(--syntax)}
details[open]>summary::before{content:"▾ ";color:var(--syntax)}
.empty{color:var(--dim)}
@media (max-width:640px){
  .page{padding:40px 12px}
  .doc{font-size:13px}
}
`;

export const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

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

export function page(o: { title: string; head?: string; css?: string; body: string; script?: string }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0b0e14">
<title>${esc(o.title)}</title>
${o.head ?? ""}
<style>${BASE_CSS}${o.css ?? ""}</style></head>
<body>${o.body}${o.script ?? ""}</body></html>`;
}
