/**
 * The chat sidebar, for browsers.
 *
 * The same panel smry's reader has — a right-hand offcanvas column on a wide
 * screen, a sheet over the page on a phone; user turns as pills on the right,
 * the assistant's as bare prose; each tool call a chip in the flow of the
 * answer; an empty state that sits above the composer; one send control that
 * becomes stop while the answer streams — drawn in this site's tokens. It is
 * served on every public page and opened from the nav, ⌘I, or /chat.
 *
 * The conversation lives in the tab (sessionStorage) and nowhere else.
 */

import { esc, btn } from "./ui";

export const CHAT_WIDTH = 420;

/** Each one is a whole instruction: a source to fetch or a batch to invent, the labels, and the ask. */
const SUGGESTIONS = [
  "Read https://news.ycombinator.com, then classify every story title there into ai, security, business, hardware, other. Show the counts and the least confident three.",
  "Search for this week's headlines about the Federal Reserve, classify each as hawkish, dovish or neutral, and tell me the split.",
  "Read the Rust changelog at https://github.com/rust-lang/rust/blob/master/RELEASES.md and tag the first 40 entries with every label that applies: language, compiler, library, tooling, platform.",
  "Invent 15 realistic customer support emails, sort them into billing, bug, feature, other, and show me which ones a human should double-check.",
];

const ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>`;

export function chatPanel(open = false) {
  return `<aside class="chat" id="chat" aria-label="Chat"${open ? "" : " hidden"}>
  <div class="chat-head">
    <div class="chat-title"><span class="syn">## </span>chat<span class="chat-sub">the classify tools, called live</span></div>
    <p class="row chat-acts">${btn("clear", { cls: "dim", attrs: ' data-chat-clear hidden' })}${btn("close", { cls: "dim", attrs: ' data-chat-close aria-label="Close chat"' })}</p>
  </div>
  <div class="chat-body">
    <div class="chat-empty">
      <p class="chat-hi">Ask anything, or paste texts to sort. Every answer comes from a real call to the API, through the same MCP tools any agent gets.</p>
      <div role="group" aria-label="Try one">${SUGGESTIONS.map((s) => `<button type="button" class="chat-sug" data-chat-sug><span class="syn">›</span>${esc(s)}</button>`).join("")}</div>
    </div>
    <div class="chat-msgs" aria-live="polite"></div>
  </div>
  <form class="chat-form">
    <div class="chat-field">
      <textarea rows="1" placeholder="Ask, or paste texts to sort" aria-label="Message" required></textarea>
      <button type="submit" class="chat-send" aria-label="Send">${ARROW}<span class="stop" aria-hidden="true"></span></button>
    </div>
    <p class="chat-note">Enter sends, shift+enter for a new line. The conversation stays in this tab.</p>
  </form>
</aside>`;
}

export const CHAT_CSS = `
/* ---- the sidebar --------------------------------------------------------- */
.chat{--w:${CHAT_WIDTH}px;position:fixed;inset-block:0;right:0;z-index:20;width:var(--w);
  display:flex;flex-direction:column;background:var(--surface);border-left:1px solid var(--rule);
  transform:translateX(0);transition:transform .2s linear}
.chat[hidden]{display:flex;transform:translateX(100%);visibility:hidden}
@media (prefers-reduced-motion:reduce){.chat{transition:none}}
/* The page gives up the panel's width and re-centres in what is left. */
@media (min-width:900px){
  .chat{inset-block-start:72px}
  .page{transition:padding-right .2s linear}
  html[data-chat] .page{padding-right:calc(${CHAT_WIDTH}px + 16px)}
  html[data-chat] .dock{right:calc(${CHAT_WIDTH}px + 16px)}
}
.chat-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
  padding:14px 16px 12px;border-bottom:1px solid var(--rule)}
.chat-title{min-width:0;font-weight:600;color:var(--fg)}
.chat-sub{display:block;margin-top:2px;font-size:12px;font-weight:500;color:var(--dim);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chat-acts{flex:none;gap:0 6px}
.chat-acts .b[hidden]{display:none}
.chat-body{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto;
  overscroll-behavior:contain;scrollbar-gutter:stable;padding:24px 16px}
/* The empty state sits just above the composer, where the first answer will land. */
.chat-empty{margin-top:auto;display:flex;flex-direction:column;gap:12px}
.chat-empty[hidden]{display:none}
.chat-hi{color:var(--muted);padding:0 2px 4px}
.chat-sug{display:flex;align-items:center;gap:10px;width:100%;min-height:40px;padding:8px 10px;
  text-align:start;font:inherit;color:var(--muted);background:none;border:0;border-radius:var(--r-s);
  cursor:pointer;transition:background-color .1s,color .1s}
.chat-sug .syn{flex:none}
@media (hover:hover){.chat-sug:hover{background:var(--rule);color:var(--bright)}}
.chat-msgs{display:flex;flex-direction:column;gap:24px}
.chat-msgs:empty{display:none}
.chat-u{align-self:flex-end;max-width:min(80%,32rem);padding:8px 12px;border-radius:var(--r);
  background:var(--rule);color:var(--bright);white-space:pre-wrap;overflow-wrap:anywhere}
.chat-a{min-width:0;color:var(--fg);display:flex;flex-direction:column;gap:8px}
.chat-a .txt{white-space:pre-wrap;overflow-wrap:anywhere}
.chat-a .txt:empty{display:none}
/* A tool call: a chip in the flow of the answer, and under it the head of what came back. */
.chat-tool{display:inline-flex;align-items:center;gap:8px;max-width:100%;width:fit-content;min-height:24px;
  padding:0 8px;font-size:12px;font-weight:500;color:var(--muted);border:1px solid var(--line);border-radius:var(--r-s)}
.chat-tool .nm{color:var(--fg)}
.chat-tool.run .nm{color:var(--muted);
  background:linear-gradient(90deg,var(--muted) 0%,var(--bright) 35%,var(--bright) 50%,var(--muted) 65%,var(--muted) 100%);
  background-size:220% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  animation:chat-shimmer 2s ease-in-out infinite}
.chat-tool.bad{border-color:var(--bad);color:var(--bad)}
@keyframes chat-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}
@media (prefers-reduced-motion:reduce){.chat-tool.run .nm{animation:none}}
.chat-out{margin:0;max-height:9.75em;overflow:auto;padding:8px 10px;font-size:12px;line-height:1.5;
  color:var(--dim);background:var(--bg);border-radius:var(--r-s);white-space:pre;tab-size:12}
.chat-err{color:var(--bad)}
/* Thinking: the same shimmer, on the one word. */
.chat-think{font-size:13px;color:var(--muted);
  background:linear-gradient(90deg,var(--muted) 0%,var(--bright) 35%,var(--bright) 50%,var(--muted) 65%,var(--muted) 100%);
  background-size:220% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  animation:chat-shimmer 2s ease-in-out infinite;width:fit-content}
/* ---- the composer -------------------------------------------------------- */
.chat-form{flex:none;padding:4px 12px 12px;background:var(--surface)}
.chat-field{position:relative;display:flex;align-items:flex-end;gap:8px;padding:8px 8px 8px 12px;
  background:var(--bg);border:1px solid var(--line-strong);border-radius:var(--r);
  transition:border-color .15s,box-shadow .15s}
.chat-field:focus-within{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.chat-field textarea{flex:1;min-width:0;min-height:36px;max-height:200px;margin:0;padding:6px 0;resize:none;
  font:inherit;color:var(--bright);background:none;border:0;outline:0;line-height:1.5}
.chat-field textarea::placeholder{color:var(--dim)}
.chat-send{position:relative;flex:none;width:36px;height:36px;display:grid;place-items:center;overflow:hidden;
  border:0;border-radius:var(--r-s);cursor:pointer;background:var(--rule);color:var(--muted);
  transition:background-color .15s,color .15s,scale .15s}
.chat-send:active{scale:.96}
.chat-send.armed,.chat-send.busy{background:var(--accent);color:var(--ink)}
@media (hover:hover){.chat-send.armed:hover,.chat-send.busy:hover{background:var(--accent-hover)}}
.chat-send>*{grid-area:1/1;transition:opacity .2s cubic-bezier(.2,0,0,1),scale .2s cubic-bezier(.2,0,0,1),filter .2s cubic-bezier(.2,0,0,1)}
.chat-send svg{width:16px;height:16px}
.chat-send .stop{width:10px;height:10px;border-radius:2px;background:currentColor;scale:.25;opacity:0;filter:blur(4px)}
.chat-send.busy svg{scale:.25;opacity:0;filter:blur(4px)}
.chat-send.busy .stop{scale:1;opacity:1;filter:blur(0)}
.chat-note{margin:6px 8px 0;font-size:11px;line-height:16px;color:var(--dim);text-align:center;text-wrap:pretty}
/* ---- a phone: a sheet over the page, the page held still behind it ------- */
@media (max-width:899px){
  .chat{--w:100%;inset:10px 0 0;width:auto;border-left:0;border-top:1px solid var(--line);border-radius:12px 12px 0 0;
    transform:translateY(0);padding-bottom:env(safe-area-inset-bottom)}
  .chat[hidden]{transform:translateY(100%)}
  .chat-field textarea{font-size:16px}
  html[data-chat],html[data-chat] body{overflow:hidden}
}
`;

export const CHAT_SCRIPT = `<script>
{ // The sidebar. Everything it knows is in this block and in sessionStorage.
const panel = document.getElementById("chat");
if (panel) {
  const KEY = "classifier.chat";
  const msgs = panel.querySelector(".chat-msgs");
  const empty = panel.querySelector(".chat-empty");
  const body = panel.querySelector(".chat-body");
  const form = panel.querySelector(".chat-form");
  const input = form.querySelector("textarea");
  const send = form.querySelector(".chat-send");
  const clear = panel.querySelector("[data-chat-clear]");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let history = [];      // {role, content}, what the server sees
  let busy = null;       // the AbortController of the turn in flight
  let open = !panel.hidden;

  const store = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ open, history })); } catch {} };
  const nearBottom = () => body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  const follow = (was) => { if (was) body.scrollTop = body.scrollHeight; };
  const sync = () => {
    empty.hidden = history.length > 0;
    clear.hidden = history.length === 0;
    send.classList.toggle("armed", !!input.value.trim() && !busy);
    send.classList.toggle("busy", !!busy);
    send.setAttribute("aria-label", busy ? "Stop" : "Send");
  };
  const grow = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
  };

  // ---- rendering. A turn is appended, never rebuilt, so streaming is cheap.
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const user = (text) => { msgs.append(el("div", "chat-u", text)); };
  const assistant = () => { const a = el("div", "chat-a"); msgs.append(a); return a; };
  const summarize = (args) => {
    if (typeof args.query === "string") return args.query;
    if (typeof args.url === "string") { const u = args.url.replace("https://", "").replace("http://", ""); return u.endsWith("/") ? u.slice(0, -1) : u; }
    const n = Array.isArray(args.inputs) ? args.inputs.length : 0;
    const labels = Array.isArray(args.labels) ? args.labels.join(", ") : "";
    return [n ? n + (n === 1 ? " text" : " texts") : "", labels].filter(Boolean).join(" · ");
  };

  // ---- one turn: post the conversation, read the events back.
  const ask = async (text) => {
    if (busy) return;
    const was = nearBottom() || history.length === 0;
    history.push({ role: "user", content: text });
    user(text);
    input.value = ""; grow();
    busy = new AbortController();
    sync(); store();
    const a = assistant();
    let txt = null;
    let think = el("div", "chat-think", "thinking");
    a.append(think);
    let chip = null;
    let answer = "";
    follow(true);
    const on = (e) => {
      const keep = nearBottom();
      if (think) { think.remove(); think = null; }
      if (e.t === "text") {
        if (!txt) { txt = el("div", "txt"); a.append(txt); }
        txt.append(e.d); answer += e.d;
      } else if (e.t === "tool") {
        txt = null;
        chip = el("div", "chat-tool run");
        chip.append(el("span", "nm", e.name), el("span", "", summarize(e.args)));
        a.append(chip);
      } else if (e.t === "result") {
        if (chip) { chip.classList.remove("run"); if (e.error) chip.classList.add("bad"); }
        if (e.text) a.append(el("pre", "chat-out", e.text));
        chip = null;
      } else if (e.t === "error") {
        a.append(el("div", "chat-err", e.message));
      }
      follow(keep);
    };
    try {
      const res = await fetch("/v1/chat", {
        method: "POST", signal: busy.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        on({ t: "error", message: j.error || ("that did not work (HTTP " + res.status + ")") });
      } else {
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let nl;
          while ((nl = buf.indexOf("\\n\\n")) >= 0) {
            const line = buf.slice(0, nl); buf = buf.slice(nl + 2);
            if (line.startsWith("data: ")) { try { on(JSON.parse(line.slice(6))); } catch {} }
          }
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") on({ t: "error", message: "no network." });
    }
    if (think) think.remove();
    if (chip) chip.classList.remove("run");
    if (answer) history.push({ role: "assistant", content: answer });
    else history.pop(); // an answer that never came leaves nothing to reply to
    busy = null;
    sync(); store();
  };

  // ---- open and close. The page learns from <html data-chat> that it has less room.
  const show = (want) => {
    open = want;
    document.documentElement.toggleAttribute("data-chat", open);
    if (open) {
      panel.hidden = false;
      setTimeout(() => input.focus({ preventScroll: true }), reduced ? 0 : 150);
    } else {
      panel.hidden = true;
      if (panel.contains(document.activeElement)) document.querySelector("[data-chat-open]")?.focus();
    }
    for (const b of document.querySelectorAll("[data-chat-open]")) b.setAttribute("aria-expanded", String(open));
    store();
  };
  for (const b of document.querySelectorAll("[data-chat-open]")) b.addEventListener("click", (e) => { e.preventDefault(); show(!open); });
  panel.querySelector("[data-chat-close]").addEventListener("click", () => show(false));
  clear.addEventListener("click", () => { if (busy) busy.abort(); history = []; msgs.replaceChildren(); sync(); store(); input.focus(); });
  for (const b of panel.querySelectorAll("[data-chat-sug]")) b.addEventListener("click", () => ask(b.textContent.slice(1).trim()));

  form.addEventListener("submit", (e) => { e.preventDefault(); if (busy) busy.abort(); else if (input.value.trim()) ask(input.value.trim()); });
  send.addEventListener("click", (e) => { if (busy) { e.preventDefault(); busy.abort(); } });
  input.addEventListener("input", () => { grow(); sync(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy && input.value.trim()) ask(input.value.trim()); }
  });
  addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "i") { e.preventDefault(); show(!open); }
    else if (e.key === "Escape" && open) { if (busy) busy.abort(); else show(false); }
  });

  // ---- what this tab already said.
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (saved && Array.isArray(saved.history)) {
      history = saved.history.filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"));
      for (const m of history) { if (m.role === "user") user(m.content); else { const a = assistant(); a.append(el("div", "txt", m.content)); } }
      if (saved.open && !open) open = true;
    }
  } catch {}
  document.documentElement.toggleAttribute("data-chat", open);
  panel.hidden = !open;
  for (const b of document.querySelectorAll("[data-chat-open]")) b.setAttribute("aria-expanded", String(open));
  sync(); grow();
  if (open) { body.scrollTop = body.scrollHeight; if (location.pathname === "/chat") input.focus({ preventScroll: true }); }
}
}
</script>`;
