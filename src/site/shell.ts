// The shell every redesigned page but the home page shares: head, nav, art band, footer and scripts from
// src/site/shell-template.ts (generated from the design prototype). Kept free of the docs modules so
// anything can use it, including the updates sign-up's answer pages.
import { esc } from "../ui";
import { SHELL_FOOT, SHELL_HEAD, SHELL_NAV, SHELL_SCRIPTS } from "./shell-template";

const LOGIN = /<a class="nav__login" href="\/login">Log in<\/a>/;
const MENU_LOGIN = '<a class="menu__row" href="/login">Log in</a>';
for (const [ok, what] of [[LOGIN.test(SHELL_NAV), "nav login"], [SHELL_NAV.includes(MENU_LOGIN), "menu login"], [SHELL_FOOT.includes('href="/index.md"'), "footer Markdown link"]] as const)
  if (!ok) throw new Error(`site/pages: the shell lost its ${what}`);

/** A whole page in the shell. `path` names the page's Markdown alternate (path + ".md"). */
export function sitePage(o: { title: string; desc: string; path: string; kind: string; body: string; signedIn?: boolean }): string {
  const md = `${o.path}.md`;
  const head = SHELL_HEAD
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(o.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(o.desc)}">\n<link rel="alternate" type="text/markdown" href="${md}" title="This page as Markdown">`);
  const nav = o.signedIn
    ? SHELL_NAV.replace(LOGIN, '<a class="nav__login" href="/app">Dashboard</a>').replace(MENU_LOGIN, '<a class="menu__row" href="/app">Dashboard</a>')
    : SHELL_NAV;
  return `${head}</head>\n<body class="docs-page sub-page sub-page--${o.kind}">\n${nav}\n<main id="main">\n<div class="dband" aria-hidden="true"></div>\n${o.body}\n</main>\n\n${SHELL_FOOT.replace('href="/index.md"', `href="${md}"`)}\n\n${SHELL_SCRIPTS}\n</body>\n</html>\n`;
}

// ---------------------------------------------------------------- short pages (the updates sign-up's answers)

/** A page that says one thing: a heading, the message and a way on. `form` is optional markup under it. */
export function messagePage(o: { title: string; heading: string; message: string; ok?: boolean; form?: string; signedIn?: boolean }): string {
  const body = `<section class="sec pg-head pg-msg${o.ok === false ? " is-bad" : ""}">
  <div class="rail">
    <div class="pg-head__copy">
      <h1 class="t-title">${esc(o.heading)}</h1>
      <p class="pg-head__lede">${o.message}</p>
      ${o.form ?? `<p class="pg-msg__acts"><a class="btn btn--soft btn--sm" href="/">Back to classifier.dev</a></p>`}
    </div>
  </div>
</section>`;
  return sitePage({ title: o.title, desc: o.heading, path: "/", kind: "msg", body, signedIn: o.signedIn });
}
