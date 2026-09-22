/**
 * The public site, for browsers.
 *
 * curl and agents still get the plain text they always did — this is the same
 * document rendered, not a second copy of it. The plain text stays canonical:
 * everything below is derived from DOCS and BENCHMARK at request time, so the
 * page cannot drift from what `curl classifier.dev` prints.
 */

import { esc, btn, page, codeLang, COPY_ICON, HL_HEAD, HL_SCRIPT, HL_CSS } from "./ui";
import { DOCS, BENCHMARK } from "./docs";
import { VS_JEV, vsJevHtml, smartWins, smartGain, noiseFloor, pct, accuracy } from "./vsjev";
import { SITE, SITE_UPDATED } from "./wellknown";
import { FASTER_INFERENCE_KEY, MAX_DESIRED_LATENCY_MS, MIN_DESIRED_LATENCY_MS, ROADMAP, SUBSCRIBE_PATH } from "./newsletter";
import { headingTitle, isCommandBlock, isHeading, isPreBlock } from "./pages";
import { chatPanel, CHAT_CSS, CHAT_SCRIPT } from "./chatui";

export const HOME_CSS = `${HL_CSS}${CHAT_CSS}
.site-header{position:sticky;inset-block-start:0;z-index:10;background:color-mix(in srgb,var(--bg) 92%,transparent);
  border-block-end:1px solid var(--rule);backdrop-filter:blur(16px)}
.site-nav{max-width:1180px;min-height:72px;margin:0 auto;padding-inline:24px;display:flex;align-items:center;gap:28px}
.site-brand{display:inline-flex;align-items:center;gap:10px;color:var(--bright);font-size:15px;font-weight:700;
  text-decoration:none;white-space:nowrap}
.site-mark{width:28px;height:28px;flex:none}
.site-links{display:flex;align-items:center;gap:4px;flex:1}
.site-link,.site-action{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 10px;line-height:1;
  border-radius:var(--r-s);color:var(--muted);font-weight:600;text-decoration:none;white-space:nowrap;
  transition-property:background-color,color,scale;transition-duration:.1s}
.site-link[aria-current=page]{color:var(--bright);background:var(--surface)}
.site-actions{display:flex;align-items:center;gap:8px}
.site-action.signup{color:var(--fg);box-shadow:inset 0 0 0 1px var(--line)}
.site-action.primary{min-height:36px;margin-inline-start:0;padding-inline:14px;color:var(--ink);background:var(--accent)}
.site-link:active,.site-action:active,.site-menu summary:active{scale:.96}
.site-menu,.site-resources{position:relative}
.site-menu{display:none}
.site-menu summary,.site-resources summary{display:flex;align-items:center;justify-content:center;min-height:36px;padding-inline:10px;line-height:1;
  border-radius:var(--r-s);color:var(--fg);font-weight:600;cursor:pointer;list-style:none}
.site-menu summary::-webkit-details-marker,.site-resources summary::-webkit-details-marker{display:none}
.site-menu summary::before,.site-resources summary::before{content:none}
.site-menu[open]>summary::before,.site-resources[open]>summary::before{content:none}
.site-resources summary.active{color:var(--bright);background:var(--surface)}
.site-menu-panel,.site-resources-panel{position:absolute;inset-block-start:calc(100% + 8px);inset-inline-end:0;width:min(280px,calc(100vw - 24px));
  padding:8px;background:var(--surface);border:1px solid var(--line);border-radius:calc(var(--r) + 4px);
  box-shadow:0 20px 48px -24px rgba(0,0,0,.9)}
.site-resources-panel{inset-inline-start:0;inset-inline-end:auto;width:220px}
.site-menu-panel .site-link,.site-menu-panel .site-action,.site-resources-panel .site-link{justify-content:flex-start;width:100%;min-height:44px}
.site-menu-panel .site-action.primary{margin:4px 0 0;justify-content:center}
@media(hover:hover){.site-link:hover,.site-action:not(.primary):hover,.site-menu summary:hover,.site-resources summary:hover{background:var(--surface);color:var(--bright)}
  .site-action.primary:hover{background:var(--accent-hover);color:var(--ink)}}
@media(max-width:1024px){.site-nav{padding-inline:16px;gap:12px}.site-links,.site-actions{display:none}.site-menu{display:block;margin-inline-start:auto}
  .site-header:has(.site-menu[open]){background:var(--bg);backdrop-filter:none}
  .site-menu>summary{position:relative;width:44px;padding:0;color:var(--bright)}
  .site-menu-icon{display:block;position:relative;width:22px;height:16px;background:linear-gradient(currentColor,currentColor) center/100% 1.5px no-repeat}
  .site-menu-icon::before,.site-menu-icon::after{content:"";position:absolute;inset-block-start:50%;inset-inline-start:0;width:22px;height:1.5px;background:currentColor;transform-origin:center}
  .site-menu-icon::before{transform:translateY(-7px)}.site-menu-icon::after{transform:translateY(6px)}
  .site-menu[open] .site-menu-icon{background:none}
  .site-menu[open] .site-menu-icon::before{transform:translateY(-.75px) rotate(45deg)}.site-menu[open] .site-menu-icon::after{transform:translateY(-.75px) rotate(-45deg)}
  .site-menu-panel{position:fixed;inset:72px 0 0;width:auto;padding:26px 24px max(32px,env(safe-area-inset-bottom));overflow-y:auto;
    background:var(--bg);border:0;border-block-start:1px solid var(--rule);border-radius:0;box-shadow:none}
  .site-menu-links{display:flex;flex-direction:column}
  .site-menu-links .site-link,.site-menu-resources>summary{justify-content:flex-start;min-height:58px;padding:0;color:var(--muted);font-size:25px;font-weight:500}
  .site-menu-links .site-link[aria-current=page]{color:var(--bright);background:transparent}
  .site-menu-resources{border-block-end:1px solid var(--rule)}
  .site-menu-resources>summary{justify-content:space-between}
  .site-menu-resources>summary::before{content:none}
  .site-menu-resources[open]>summary::before{content:none}
  .site-menu-resources>summary::after{content:"";width:10px;height:10px;margin-inline-end:5px;border-inline-end:2px solid currentColor;border-block-end:2px solid currentColor;rotate:45deg}
  .site-menu-resources[open]>summary::after{rotate:-135deg}
  .site-menu-resources-panel{display:grid;grid-template-columns:1fr 1fr;padding:0 0 18px;gap:2px 12px}
  .site-menu-resources-panel .site-link{min-height:44px;padding:0;color:var(--muted)}
  .site-menu-actions{display:grid;gap:12px;margin-top:28px}
  .site-menu-actions .site-action{min-height:50px;justify-content:center;border:1px solid var(--line-strong);font-size:15px}
  .site-menu-actions .site-action.primary{margin:0;color:var(--ink);background:var(--accent);border-color:var(--accent)}
  body:has(.site-menu[open]){overflow:hidden}
  body:has(.site-menu[open]) .dock{display:none}}
@media(max-width:420px){.site-nav{min-height:64px;padding-inline:12px}.site-brand{font-size:14px}.site-mark{width:26px;height:26px}
  .site-action.primary{padding-inline:10px;margin-inline-start:0}.site-menu-panel{inset-block-start:64px;padding-inline:18px}}
.prose section>*+*{margin-top:14px}
.prose>section{margin-top:28px}
.lead{color:var(--muted)}
.pro-offer{color:var(--muted)}
.pro-offer strong{color:var(--bright)}
.k{color:var(--bright)}
.block{position:relative}
.block>.row{margin-top:4px}
h2{scroll-margin-top:24px}
.foot{color:var(--dim);border-top:1px solid var(--rule);padding-top:16px}
.nb{white-space:nowrap}
.vs{width:auto;margin-top:12px}
.vs th,.vs td{padding:5px 0}
/* One header on two lines: each set's name centred over its pair, the column
   names under. The table is ruled the way a ledger is: one line under the
   whole header and one over the sum row, both edge to edge, and nothing else.
   The 32px gap between sets does the grouping a rule per set used to do. */
.vs th.set{padding:0 0 0 32px;color:var(--fg);font-weight:600;text-align:center;border-bottom:0}
.vs th.set>span{display:block;text-align:center}
.vs .num{text-align:right;padding-left:14px}
.vs .gap{padding-left:32px}
.vs thead tr:first-child th{border-bottom:0;padding-bottom:0}
.vs thead tr:last-child th{padding-top:2px;padding-bottom:7px;border-bottom:1px solid var(--line)}
.vs tbody tr:first-child th,.vs tbody tr:first-child td{padding-top:9px}
.vs tbody th{font-weight:400;color:var(--fg);border-bottom:0;padding-right:8px}
.vs tbody th .eq{color:var(--dim)}
.vs tr.smart th{color:var(--bright)}
/* In each column the better accuracy is green. The gain row is green or red
   by its sign, and bold only where the gap clears the noise on that column's
   items; the sign carries the meaning for a reader who sees neither. */
.vs td.best{color:var(--good)}
.vs tr.gain th,.vs tr.gain td{color:var(--dim);border-top:1px solid var(--line);padding-top:8px}
.vs tr.gain td.win{color:var(--good)}
.vs tr.gain td.loss{color:var(--bad)}
.vs tr.gain td.clear{font-weight:600}
/* The agent prompt: the one thing a first-time visitor should not miss, so it
   is the one surface on the page drawn with depth. No border: a hairline ring
   and a lift, a faint wash of the accent from the top corner (at full P3
   chroma where the display has it), and the prompt nested inside at the
   concentric radius, the panel's corner being the prompt's plus the inset.
   Under it, the one filled control on the page. */
.agent{--pad:18px;--inset:8px;--r-in:var(--r);--ring:rgba(255,255,255,.08);
  padding:var(--pad);border-radius:calc(var(--r-in) + var(--inset));
  background:var(--surface);
  background:radial-gradient(120% 90% at 0% 0%,color-mix(in oklch,var(--accent) 10%,transparent),transparent 58%) var(--surface);
  box-shadow:0 0 0 1px var(--ring),inset 0 1px 0 rgba(255,255,255,.05),0 24px 48px -32px rgba(0,0,0,.9)}
.agent h2{color:var(--bright)}
.agent .prompt>pre{white-space:pre-wrap;word-break:break-word;color:var(--bright);
  margin-inline:calc(var(--inset) - var(--pad));padding:12px 14px;line-height:1.6;
  background:var(--bg);border:0;border-radius:var(--r-in);box-shadow:0 0 0 1px var(--ring)}
.agent .block>.row{margin-top:14px}
.agent .alt{margin-top:14px}
.or{color:var(--dim)}
/* The filled control. The brand lavender, lit from the top: a gradient in
   OKLCH so the step through the hue stays even, a hairline of the deeper
   purple as its edge, a highlight along the top edge and a shade along the
   bottom so it reads as a thing with a surface, and a soft lavender glow
   under it. The four colours are re-stated in Display P3 for the screens
   that can show them; sRGB gets the nearest it has. Hover lifts the light,
   press sinks the control. */
.b.cta{--c:#aa63ff;--c-hi:#d2acff;--c-lo:#9149ff;--c-edge:#6b2adc;--glow:rgba(170,99,255,.48);
  color:var(--ink);font-weight:600;font-size:15px;padding:10px 18px 10px 14px;border-radius:var(--r);
  background:var(--c);
  background:linear-gradient(to bottom in oklch,var(--c-hi),var(--c) 45%,var(--c-lo));
  box-shadow:0 0 0 1px var(--c-edge),inset 0 1px 0 rgba(255,255,255,.42),inset 0 -1px 0 rgba(25,7,39,.22),
    0 1px 2px rgba(0,0,0,.3),0 12px 28px -12px var(--glow);
  transition-property:filter,scale,box-shadow;transition-duration:.15s;transition-timing-function:ease-out}
.b.cta .br{color:var(--ink);opacity:.5}
.b.cta svg{width:16px;height:16px;stroke-width:2}
@media (hover:hover){
  .b.cta:hover{background:linear-gradient(to bottom in oklch,var(--c-hi),var(--c) 45%,var(--c-lo));color:var(--ink);
    filter:brightness(1.07);
    box-shadow:0 0 0 1px var(--c-edge),inset 0 1px 0 rgba(255,255,255,.5),inset 0 -1px 0 rgba(25,7,39,.22),
      0 1px 2px rgba(0,0,0,.3),0 14px 32px -12px var(--glow)}
  .b.cta:hover .br{color:var(--ink);opacity:.5}
}
.b.cta:active{scale:.97;filter:brightness(.97);
  box-shadow:0 0 0 1px var(--c-edge),inset 0 1px 2px rgba(25,7,39,.3),0 4px 12px -8px var(--glow)}
.b.cta:focus-visible{outline:2px solid var(--bright);outline-offset:3px}
@media (color-gamut:p3){
  .b.cta{--c:color(display-p3 .63 .40 1);--c-hi:color(display-p3 .80 .68 1);--c-lo:color(display-p3 .53 .30 .98);
    --c-edge:color(display-p3 .39 .18 .83);--glow:color(display-p3 .63 .40 1/.52)}
}
@media (max-width:640px){.agent{--pad:14px;--inset:6px}}
/* The updates list: the roadmap as a checklist, and one field. Still not a
   card. Each item is one label — box, name, what it is — so the whole line
   is the hit area, and the ticks ride along with the address in the same
   post. The box is drawn the way a shadcn checkbox is: a 16px square with a
   hairline, filled with the accent when checked and the tick cut out of it
   in the ink colour, the tick being an L rotated rather than an image so the
   page still loads nothing. It sits 3px down so it centres on the first
   line of text, not on the row. */
.pick{margin:0;padding:0;border:0;min-width:0}
/* In the document the lead sentence is the legend, so the fieldset's own is
   for the screen reader; the dock has no lead, so there it is shown. */
.pick legend{padding:0;color:var(--muted)}
#updates .pick legend{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%)}
.opt{display:grid;grid-template-columns:16px auto 1fr;column-gap:10px;padding:6px 0;cursor:pointer;
  color:var(--bright)}
.choice+.choice{border-top:1px solid var(--rule)}
.opt .what{color:var(--muted)}
.opt input{appearance:none;margin:3px 0 0;width:16px;height:16px;flex:none;position:relative;cursor:pointer;
  background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--r-s);
  transition:background-color .12s ease-out,border-color .12s ease-out}
.opt input::after{content:"";position:absolute;left:4.5px;top:1px;width:4px;height:8px;
  border:solid var(--ink);border-width:0 2px 2px 0;rotate:45deg;opacity:0;scale:.6;
  transition:opacity .12s ease-out,scale .12s ease-out}
.opt input:checked{background:var(--accent);border-color:var(--accent)}
.opt input:checked::after{opacity:1;scale:1}
.opt input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (hover:hover){.opt:hover input:not(:checked){border-color:var(--fg)}}
@media (max-width:640px){.opt{grid-template-columns:16px 1fr}.opt .what{grid-column:2}}
.latency{display:flex;align-items:center;gap:8px;margin:0 0 8px 26px;color:var(--muted)}
.latency[hidden]{display:none}
.latency label{cursor:pointer}
.latency .latency-field{display:inline-flex;align-items:center;gap:6px;color:var(--dim)}
.latency input{width:7ch;height:32px;padding:0 8px;background:var(--surface);color:var(--fg);
  border:1px solid var(--line-strong);border-radius:var(--r-s);font:inherit;font-size:max(16px,1em)}
.latency input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.sub{--h:38px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:16px}
/* The field matches the button it sits beside: same corners, same height.
   16px is a floor, not a preference — iOS Safari zooms the page on focus
   below it, and the rest of the page is 13px on a phone. */
.sub input{flex:1 1 280px;min-width:0;height:var(--h);padding:0 10px;background:var(--surface);color:var(--fg);
  border:1px solid var(--line-strong);border-radius:var(--r);font:inherit;font-size:max(16px,1em)}
.sub input::placeholder{color:var(--dim)}
.sub .b{min-height:var(--h);padding-top:0;padding-bottom:0}
.sub .said{color:var(--muted)}
.sub .said.bad{color:var(--bad)}
.terms{color:var(--dim);margin-top:10px}
/* Screen-reader-only, for labels the sighted layout carries visually. */
.sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
  clip-path:inset(50%);white-space:nowrap;border:0}
/* The floating signup: the UPDATES form, stuck to the bottom of the viewport
   while the reader is anywhere else on the page. It is drawn the way the rest
   of the page is — the surface and line of a code block, the same field
   and bracketed button as the form in the document, held to the document's
   own column — so it reads as a line of the page that stayed put, not a
   banner over it. The shadow is the one thing that says it floats. Its
   corner is the field's radius plus the inset, so the two curves run parallel. */
.dock{position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;justify-content:center;
  padding:0 16px calc(12px + env(safe-area-inset-bottom,0px));pointer-events:none;
  opacity:0;translate:0 6px;transition:opacity .2s ease-out,translate .2s ease-out}
/* display:flex above would otherwise beat the browser's own [hidden] rule and
   leave an invisible form at the foot of every page, in the tab order and read
   out by a screen reader. Hidden has to mean gone. */
.dock[hidden]{display:none}
.dock.in{opacity:1;translate:none}
.dock form{--pad:8px;pointer-events:auto;margin:0;width:100%;max-width:var(--measure);
  padding:var(--pad);background:var(--surface);border:1px solid var(--line);border-radius:calc(var(--r) + var(--pad));
  box-shadow:0 12px 32px -12px rgba(0,0,0,.8)}
.dock .sub{margin-top:0}
.dock .head{flex:none;padding:0 6px 0 4px;color:var(--fg);font-weight:600;white-space:nowrap}
.dock input[type=email]{flex:1 1 0;background:var(--bg)}
/* The dock's checklist, folded away above the field until the field has the
   reader's attention, then unfolded and kept open while anything is ticked.
   The strip is pinned to the bottom, so growing it moves nothing the cursor
   is on: the field stays put and the list rises out of the top. The height
   comes from a grid track going 0fr to 1fr, which is the one way to animate
   to an unknown height without measuring it, and the list fades and lifts
   a few pixels inside the track so it arrives rather than just appears. The
   fold is quicker than the unfold, the way a thing put away should be. */
.dock .more{display:grid;grid-template-rows:0fr;transition:grid-template-rows .22s cubic-bezier(.32,.72,0,1)}
.dock .more>div{min-height:0;overflow:hidden;opacity:0;translate:0 4px;
  transition:opacity .16s ease-out,translate .16s ease-out,visibility 0s .16s;visibility:hidden}
.dock form.open .more{grid-template-rows:1fr;transition-duration:.28s}
.dock form.open .more>div{opacity:1;translate:none;visibility:visible;transition-delay:.06s,.06s,0s}
.dock .pick{display:flex;flex-wrap:wrap;gap:0 4px;align-items:center;padding:2px 4px 8px}
.dock .pick legend{padding:4px 4px 0;color:var(--dim)}
.dock .choice{display:contents}
.dock .opt{display:inline-flex;gap:8px;align-items:center;padding:6px 8px 6px 0;border:0}
.dock .opt input{margin:0}
.dock .opt .what{display:none}
.dock .latency{margin:0 8px 0 0}
/* Whatever the server said, on its own line under the field so a long message
   is read in full. Empty is gone, so nothing has to toggle it. */
.dock .said{flex:1 0 100%;padding:0 4px;text-wrap:pretty}
.dock .said:empty{display:none}
/* Keep the quiz in the mobile dock. Stack the address above the actions and
   let the expanded choices scroll on short screens so every item remains
   reachable without pushing the email field or subscribe button offscreen. */
@media (max-width:640px){.dock{padding-left:12px;padding-right:12px}.dock .head{display:none}
  .dock .more>div{max-height:max(80px,calc(100dvh - 160px));overflow-y:auto;overscroll-behavior:contain}
  .dock .latency{flex-basis:100%;margin-inline-start:24px}
  .dock form{--pad:6px}.dock .sub{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}
  .dock input[type=email]{grid-column:1/-1;width:100%}
  .dock .b.cta{grid-column:1;font-size:inherit;padding-left:12px;padding-right:12px}
  .dock [data-dismiss]{grid-column:2}.dock .said{grid-column:1/-1}}
@media (prefers-reduced-motion:reduce){.dock{translate:none}
  .dock .more,.dock .more>div,.opt input,.opt input::after{transition:none}}
`;

/**
 * The roadmap as a checklist. ROADMAP is the same constant `curl
 * classifier.dev` prints; the key is the value that is posted. The ids are
 * prefixed because the list is on the page twice, once in the document and
 * once in the dock, and a label must point at its own box.
 */
function roadmapPick(prefix: string, legend: string) {
  const items = ROADMAP.map(
    (r) => `<div class="choice"><label class="opt" for="${prefix}-${r.key}">
        <input id="${prefix}-${r.key}" type="checkbox" name="wants" value="${r.key}">
        <span class="name">${esc(r.name)}</span>
        <span class="what">${esc(r.what)}</span>
      </label>${r.key === FASTER_INFERENCE_KEY ? `
        <div class="latency" data-latency>
          <label for="${prefix}-desired-latency">Desired latency</label>
          <span class="latency-field"><input id="${prefix}-desired-latency" type="number"
            name="desired_latency_ms" min="${MIN_DESIRED_LATENCY_MS}" max="${MAX_DESIRED_LATENCY_MS}"
            step="1" inputmode="numeric" aria-describedby="${prefix}-latency-unit"><span id="${prefix}-latency-unit">ms</span></span>
        </div>` : ""}</div>`,
  ).join("");
  return `<fieldset class="pick"><legend>${esc(legend)}</legend>${items}</fieldset>`;
}

/**
 * The floating signup.
 *
 * The same form as the one in the document, in the one place a reader can
 * always reach it. It shows once they are past the fold, steps aside while
 * that form or the footer is on screen, and comes back after them — the
 * UPDATES section sits in the middle of the document, not at its end. It is
 * a strip until the field is focused; then the checklist unfolds above it.
 * Dismissing it, or subscribing from either form, retires it for good on
 * this browser.
 */
function subscribeDock() {
  return `<aside class="dock" id="dock" hidden aria-label="Get the updates">
    <form method="post" action="/${SUBSCRIBE_PATH}" data-subscribe="1">
      <div class="more"><div>${roadmapPick("dock", "First on your list?")}</div></div>
      <div class="sub">
        <span class="head" aria-hidden="true"><span class="syn">## </span>Get the updates</span>
        <label class="sr" for="dock-email">Your email address</label>
        <input id="dock-email" type="email" name="email" required autocomplete="email"
          spellcheck="false" placeholder="you@example.com">
        ${btn("subscribe", { cls: "cta", type: "submit" })}
        ${btn("×", { cls: "dim", attrs: ' aria-label="Dismiss" data-dismiss="1"' })}
        <span class="said" role="status" aria-live="polite" data-say="1"></span>
      </div>
    </form>
  </aside>`;
}

function updatesSection() {
  return `<section id="updates">
    <h2><span class="syn">## </span>Get the updates</h2>
    <p class="lead">The free tier is the whole service today. What is being built on top of it,
      in the order people ask for it — tick what you would use first:</p>
    <form method="post" action="/${SUBSCRIBE_PATH}" data-subscribe="1">
      ${roadmapPick("want", "What you would use first")}
      <div class="sub">
        <input type="email" name="email" required autocomplete="email" spellcheck="false"
          placeholder="you@example.com" aria-label="Your email address">
        ${btn("subscribe", { cls: "cta", type: "submit" })}
        <span class="said" role="status" aria-live="polite" data-say="1"></span>
      </div>
    </form>
    <p class="terms">Confirm by email. One mail when something on that list ships, nothing in between.
      Your address and what you ticked are kept apart from API traffic. Unsubscribe by replying.</p>
  </section>`;
}

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

/**
 * Bare URLs become links; trailing sentence punctuation stays outside. Works
 * on the raw text and escapes each piece itself, so a URL that sits inside a
 * quote is not read up to the semicolon of the quote's entity. A URL with a
 * template hole in it, like /{labels}/{text}, is shown and not linked.
 */
function linkify(text: string) {
  return text
    .split(/(https?:\/\/[^\s<>()"'`]+)/)
    .map((part, i) => {
      if (i % 2 === 0) return esc(part);
      const trail = part.match(/[.,;:]+$/)?.[0] ?? "";
      const href = part.slice(0, part.length - trail.length);
      if (/[{}]/.test(href)) return esc(part);
      return `<a class="inline" href="${esc(href)}">${esc(href)}</a>${esc(trail)}`;
    })
    .join("");
}

/**
 * Escape a run of text and turn its bare URLs into links, in one pass. The
 * URL is found in the raw text, so a quote after it ends it: done the other
 * way round, `"https://classifier.dev/mcp"` in a JSON example linked to
 * `https://classifier.dev/mcp&quot;`, a 404. Trailing sentence punctuation
 * stays outside the link, and a template such as /{labels}/{text} is text.
 */

/**
 * A command block is what you type and what comes back. The commands are
 * highlighted as shell; what they print is dim and outside the <code>, so the
 * highlighter leaves it alone and the copy control can skip it. A command
 * runs on while a single quote is open or the line ends in a backslash.
 */
function commandHtml(ls: string[]): string {
  const parts: string[] = [];
  let cmd: string[] = [];
  let inCmd = false;
  let open = false;
  const flushCmd = () => {
    if (cmd.length) parts.push(`<code class="language-bash">${linkify(cmd.join("\n"))}</code>`);
    cmd = [];
  };
  for (const l of ls) {
    if (!inCmd && isCommandBlock([l])) inCmd = true;
    if (!inCmd) {
      flushCmd();
      parts.push(`<span class="out">${linkify(l)}</span>`);
      continue;
    }
    cmd.push(l);
    if ((l.match(/'/g) ?? []).length % 2) open = !open;
    if (!open && !/\\$/.test(l)) inCmd = false;
  }
  flushCmd();
  return parts.join("\n");
}

export function renderBlocks(body: string[]): string {
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    const lines = buf;
    buf = [];
    if (isPreBlock(lines)) {
      const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
      const text = lines.map((l) => l.slice(indent)).join("\n");
      const copy = isCommandBlock(lines)
        ? `<p class="row">${btn("copy", { cls: "dim", icon: COPY_ICON, attrs: ' data-copy="1"' })}</p>`
        : "";
      const code = isCommandBlock(lines) ? commandHtml(text.split("\n")) : (() => {
        const lang = codeLang(lines);
        return lang ? `<code class="language-${lang}">${linkify(text)}</code>` : linkify(text);
      })();
      out.push(`<div class="block"><pre>${code}</pre>${copy}</div>`);
    } else {
      out.push(`<p>${linkify(lines.map((l) => l.trim()).join(" "))}</p>`);
    }
  };
  for (const line of body) {
    if (!line.trim()) flush();
    else buf.push(line);
  }
  flush();
  return out.join("");
}

/**
 * Turn one of the plain-text documents into sections.
 *
 * `swap` replaces one section by its UPPERCASE heading, for the few that have a
 * richer HTML form than their plain text — the section keeps its place in the
 * document, so the order a reader sees matches `curl classifier.dev`.
 */
export function renderDoc(doc: string, skipTitle: boolean, swap: Record<string, string | ((body: string[]) => string)> = {}) {
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
    if (title in swap) {
      const alt = swap[title];
      out.push(typeof alt === "function" ? alt(body) : alt);
      continue;
    }
    out.push(
      `<section><h2><span class="syn">## </span>${esc(headingTitle(title))}</h2>${renderBlocks(body)}</section>`,
    );
  }
  return out.join("");
}

const AGENT_PROMPT =
  "Set up the classifier.dev skill: run `npx skills add https://classifier.dev`, " +
  "then read https://classifier.dev/skill.md and follow it all the way through.";

export const META = (title: string, desc: string, path = "/") => `<meta name="description" content="${esc(desc)}">
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
      sameAs: [SITE.repo, SITE.author.x, "https://www.npmjs.com/package/classifier-dev", "https://github.com/mrmps/classifier-dev/tree/python-v0.1.0/sdk/python", "https://pkg.go.dev/github.com/mrmps/classifier-dev/sdk/go", "https://registry.modelcontextprotocol.io/v0/servers?search=dev.classifier"],
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
      termsOfService: "https://classifier.dev/terms",
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
      termsOfService: "https://classifier.dev/terms",
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
          // The accuracies are the measured ones the table above carries, not a
          // transcription that the next `npm run vs-jev` would leave behind.
          acceptedAnswer: { "@type": "Answer", text: `On public test sets the fast tier scores ${pct(accuracy("ag_news", "jev"))} on four-way AG News and ${pct(accuracy("emotion", "jev"))} on six-way emotion; the smart tier ${pct(accuracy("ag_news", "smart"))} and ${pct(accuracy("emotion", "smart"))}. The confidence is calibrated: answers at or above 0.9 were right 82-92% of the time, answers under 0.5 about 30-60%. Details at classifier.dev/benchmark.` },
        },
        {
          "@type": "Question",
          name: "Can I run classifier.dev in my own cloud, or keep my texts private?",
          acceptedAnswer: { "@type": "Answer", text: "On request. A dedicated deployment in your own cloud account (AWS, GCP or another), private end-to-end encrypted inference, and higher accuracy or lower latency from a model tuned to your data are available by arrangement. Email contact@classifier.dev or book a call at https://cal.com/michaelsf/coffee. Terms at classifier.dev/pricing." },
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

export const COPY_SCRIPT = `<script>
// Every [ copy ] control copies the block it belongs to; the prompt button
// carries its own text.
for (const b of document.querySelectorAll("[data-copy]")) {
  b.addEventListener("click", async () => {
    // The block's commands, without what they printed.
    const pre = b.closest(".block")?.querySelector("pre")?.cloneNode(true);
    for (const o of pre?.querySelectorAll(".out") ?? []) o.remove();
    const text = b.dataset.text || (pre ? pre.innerText.replace(/\\n{2,}/g, "\\n").trim() : "");
    const label = b.querySelector(".lbl"), was = label.textContent;
    try { await navigator.clipboard.writeText(text); label.textContent = "copied"; }
    catch { label.textContent = "press ctrl+c"; }
    setTimeout(() => { label.textContent = was; }, 1500);
  });
}
</script>`;

const SUBSCRIBE_SCRIPT = `<script>
{ // A block, so nothing here becomes a global the other two scripts could collide with.
// Both forms — the one in the document and the floating dock — post the same
// way. Without this script they still post, and the server answers with a page.
const dock = document.querySelector(".dock");
const KEY = "classifier.updates";
const remembered = () => { try { return localStorage.getItem(KEY) === "off"; } catch { return false; } };
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let retire = () => {};

if (dock && !remembered()) {
  // One rule decides whether the dock is up, and it is re-run on every scroll,
  // resize and focus change rather than kept as state that could go stale:
  // past the fold, and neither the form in the document nor the footer on
  // screen above where the dock would sit. While the reader is in the dock
  // it stays, whatever the page underneath is doing — nothing vanishes from
  // under a cursor.
  const GAP = 96; // the strip and its margin, so "on screen" means visible, not behind it
  const clear = [document.querySelector("#updates form"), document.querySelector(".foot")]
    .filter(Boolean);
  const onScreen = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight - GAP;
  };
  let off = false, shown = false, timer = 0;
  const wanted = () => {
    if (off) return false;
    if (shown && dock.contains(document.activeElement)) return true;
    return scrollY > 600 && !clear.some(onScreen);
  };
  const sync = () => {
    const want = wanted();
    if (want === shown) return;
    shown = want;
    clearTimeout(timer);
    if (want) {
      dock.hidden = false;
      void dock.offsetHeight; // settle the layout so the transition has a start
      dock.classList.add("in");
    } else {
      dock.classList.remove("in");
      timer = setTimeout(() => { dock.hidden = true; }, reduced ? 0 : 200);
    }
  };
  retire = () => {
    off = true;
    try { localStorage.setItem(KEY, "off"); } catch {}
    if (dock.contains(document.activeElement)) document.activeElement.blur();
    sync();
  };
  addEventListener("scroll", sync, { passive: true });
  addEventListener("resize", sync);
  dock.addEventListener("focusout", () => setTimeout(sync, 0));
  dock.addEventListener("keydown", (e) => { if (e.key === "Escape") retire(); });
  dock.querySelector("[data-dismiss]").addEventListener("click", retire);

  // The checklist unfolds when the field takes focus and stays while focus
  // is anywhere in the form or anything is ticked; otherwise it folds when
  // focus leaves, so a strip the reader walked away from is a strip again.
  const form = dock.querySelector("form");
  const ticked = () => form.querySelector("input[type=checkbox]:checked") !== null;
  const fold = () => form.classList.toggle("open", form.contains(document.activeElement) || ticked());
  form.addEventListener("focusin", fold);
  form.addEventListener("focusout", () => setTimeout(fold, 0));
  form.addEventListener("change", fold);
  sync();
}

for (const f of document.querySelectorAll("[data-subscribe]")) {
  const say = f.querySelector("[data-say]");
  const lbl = f.querySelector("[type=submit] .lbl");
  const input = f.querySelector("input[type=email]");
  const idle = lbl.textContent;
  const faster = f.querySelector('input[name="wants"][value="faster"]');
  const latency = f.querySelector('input[name="desired_latency_ms"]');
  const latencyRow = f.querySelector("[data-latency]");
  const syncLatency = () => {
    const selected = faster.checked;
    latencyRow.hidden = !selected;
    latency.disabled = !selected;
    latency.required = selected;
  };
  faster.addEventListener("change", syncLatency);
  syncLatency();
  let busy = false;

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    say.classList.remove("bad");
    say.textContent = "";
    lbl.textContent = "sending";
    try {
      const wants = [...f.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.value);
      const res = await fetch(f.action, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: input.value,
          wants,
          ...(faster.checked ? { desired_latency_ms: Number(latency.value) } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        input.value = "";
        say.textContent = "check your inbox to confirm.";
        // Subscribed is subscribed: the dock has nothing more to ask, from
        // whichever form the address came.
        setTimeout(retire, f.closest(".dock") ? 2400 : 0);
      } else {
        say.classList.add("bad");
        say.textContent = body.error || "that did not work.";
      }
    } catch {
      say.classList.add("bad");
      say.textContent = "no network.";
    }
    lbl.textContent = idle;
    busy = false;
  });
}
}
</script>`;

/** The page you are on is marked for the eye and for the screen reader alike. */
const navLink = (label: string, href: string, here: string, key: string) =>
  `<a class="site-link" href="${href}"${here === key ? ' aria-current="page"' : ""}>${label}</a>`;

const MARK = `<svg class="site-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="var(--accent)"/><rect x="6" y="9" width="20" height="4" rx="2" fill="var(--ink)"/><rect x="6" y="16" width="11" height="4" rx="2" fill="#765db9"/><rect x="6" y="23" width="6" height="4" rx="2" fill="#765db9"/></svg>`;

const navLinks = (here: string, opensChat = true) =>
  `${navLink("Home", "/", here, "home")}${navLink("Benchmark", "/benchmark", here, "benchmark")}${navLink("Docs", "/docs", here, "developers")}${navLink("Pricing", "/pricing", here, "pricing")}`;

const resourceLinks = (here: string) =>
  `${navLink("MCP setup", "/mcp-setup", here, "mcp-setup")}<a class="site-link" href="/openapi.json">OpenAPI</a><a class="site-link" href="/skill.md">Agent skill</a><a class="site-link" href="/llms.txt">llms.txt</a><a class="site-link" href="https://github.com/mrmps/classifier-dev">GitHub</a>`;

const resourceMenu = (here: string) => {
  const active = ["mcp-setup", "skills"].includes(here);
  return `<details class="site-resources"><summary${active ? ' class="active"' : ""}>Resources</summary><div class="site-resources-panel">${resourceLinks(here)}</div></details>`;
};

export const NAV = (here: string, signedIn = false) => {
  const actions = signedIn
    ? '<a class="site-action primary" href="/app">Dashboard</a>'
    : '<a class="site-action login" href="/login">Log in</a><a class="site-action signup" href="/auth/sign-up">Sign up</a><a class="site-action primary" href="/auth/sign-up">Get started</a>';
  const menuActions = signedIn
    ? '<a class="site-action primary" href="/app">Dashboard</a>'
    : '<a class="site-action" href="/login">Log in</a><a class="site-action" href="/auth/sign-up">Sign up</a><a class="site-action primary" href="/auth/sign-up">Get started</a>';
  return `<header class="site-header"><nav class="site-nav" aria-label="Primary">
  <a class="site-brand" href="/" aria-label="classifier.dev home">${MARK}<span>classifier.dev</span></a>
  <div class="site-links">${navLinks(here)}${resourceMenu(here)}</div>
  <div class="site-actions">${actions}</div>
  <details class="site-menu"><summary><span class="sr">Menu</span><span class="site-menu-icon" aria-hidden="true"></span></summary><div class="site-menu-panel">
    <div class="site-menu-links">${navLinks(here, false)}</div>
    <details class="site-menu-resources"><summary>Resources</summary><div class="site-menu-resources-panel">${resourceLinks(here)}</div></details>
    <div class="site-menu-actions">${menuActions}</div>
  </div></details>
</nav></header>`;
};

export const FOOT = `<footer><p class="foot">built by <a class="inline" href="${SITE.author.x}">@${SITE.author.handle}</a> · <a class="inline" href="${SITE.author.cal}">book a call</a> · <a class="inline" href="/about">about</a> · <a class="inline" href="/contact">contact</a> · <a class="inline" href="/pricing">pricing</a> · <a class="inline" href="/privacy">privacy</a> · <a class="inline" href="/terms">terms</a> · <a class="inline" href="/developers">developers</a> · <a class="inline" href="/.well-known/agent-feedback.json">agent feedback</a></p></footer>`;

export function homeHtml(o: { chat?: boolean; signedIn?: boolean } = {}): string {
  const desc = "Zero-shot text classification over plain HTTP. No API key, no account.";
  return page({
    title: "classifier.dev",
    head: META("classifier.dev", desc) + JSON_LD() + HL_HEAD,
    css: HOME_CSS,
    body: `${NAV(o.chat ? "chat" : "home", o.signedIn)}<div class="page"><main><article class="doc prose">
  <header><h1><span class="syn"># </span>classifier.dev</h1></header>
  <p class="quote">zero-shot text classification over plain HTTP — no API key, no account</p>
  <p class="pro-offer"><strong>Start without an account.</strong> Create a workspace when you want shared usage, billing and API keys. <a class="inline" href="/pricing">See pricing →</a></p>

  <section class="agent" id="agent">
    <h2><span class="syn">## </span>Give your agent this prompt</h2>
    <p class="lead">Paste it into any coding agent. It installs the skill and teaches the agent to classify text through this API. No key, no setup.</p>
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
    <div class="block"><pre><code class="language-bash">curl https://classifier.dev/spam,not+spam/Win+a+free+iPhone</code>
<span class="out">spam</span></pre>
    <p class="row">${btn("copy", {
      cls: "dim",
      icon: COPY_ICON,
      attrs: ' data-copy="1" data-text="curl https://classifier.dev/spam,not+spam/Win+a+free+iPhone"',
    })}</p></div>
  </section>

  <section>
    <h2><span class="syn">## </span>Install the CLI</h2>
    <div class="block"><pre><code class="language-bash">npm i -g classifier-dev</code></pre>
    <p class="row">${btn("copy", {
      cls: "dim",
      icon: COPY_ICON,
      attrs: ' data-copy="1" data-text="npm i -g classifier-dev"',
    })}</p></div>
    <p>Then sort a file, one <span class="k">label &#8677; confidence &#8677; text</span> line per
      input, in input order — a thousand lines a request, and rows appear as they land:</p>
    <div class="block"><pre><code class="language-bash">classify bug,feature,praise &lt; feedback.txt
classify relevant,"not relevant" --review 0.7 &lt; snippets.txt</code>   <span class="out"># only the unsure ones</span></pre>
    <p class="row">${btn("copy", {
      cls: "dim",
      icon: COPY_ICON,
      attrs: ' data-copy="1" data-text="classify bug,feature,praise &lt; feedback.txt"',
    })}</p></div>
  </section>

  ${renderDoc(DOCS, true, { "AGENT FEEDBACK": "", UPDATES: updatesSection(), LIMITS: limitsSection })}

  ${FOOT}
</article></main></div>
${subscribeDock()}
`,
    script: COPY_SCRIPT + SUBSCRIBE_SCRIPT + WEBMCP_SCRIPT + CHAT_SCRIPT + HL_SCRIPT,
  });
}

/** Any other plain-text document, rendered the same way the home page is. */
const pricingRow = () =>
  `<p class="row">${btn("plans and pricing", { href: "/pricing" })}${btn("create a workspace", { href: "/auth/sign-up", cls: "dim" })}</p>`;

/** The LIMITS section of the home doc, with the way past the limits beside them. */
const limitsSection = (body: string[]) =>
  `<section><h2><span class="syn">## </span>Limits</h2>${renderBlocks(body)}${pricingRow()}</section>`;

export function docHtml(o: { title: string; desc: string; doc: string; path: string; here: string; signedIn?: boolean; swap?: Record<string, string | ((body: string[]) => string)> }): string {
  return page({
    title: `${o.title} · classifier.dev`,
    head: META(o.title, o.desc, o.path) + HL_HEAD,
    css: HOME_CSS,
    body: `${NAV(o.here, o.signedIn)}<div class="page"><main><article class="doc prose">
  <header><h1><span class="syn"># </span>${esc(o.doc.split("\n")[0].trim())}</h1></header>
  <p class="quote">${esc(o.desc)}</p>
  ${renderDoc(o.doc, true, o.swap ?? {})}
  ${FOOT}
</article></main></div>
`,
    script: COPY_SCRIPT + CHAT_SCRIPT + HL_SCRIPT,
  });
}

export function benchmarkHtml(signedIn = false): string {
  const desc = "Measured accuracy, calibration, cost and latency for every model considered.";
  return page({
    title: "benchmark · classifier.dev",
    head: META("classifier.dev benchmark", desc, "/benchmark") + HL_HEAD,
    css: HOME_CSS,
    body: `${NAV("benchmark", signedIn)}<div class="page"><main><article class="doc prose">
  <header><h1><span class="syn"># </span>classifier.dev benchmark</h1></header>
  <p class="quote">${esc(desc)}</p>
  ${renderDoc(BENCHMARK, true)}
  ${FOOT}
</article></main></div>
`,
    script: COPY_SCRIPT + CHAT_SCRIPT + HL_SCRIPT,
  });
}
