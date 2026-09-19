import { page } from "./ui";

/** Billing has no third-party scripts; credentials stay out of page URLs and storage. */
export function proHtml() {
  return page({
    title: "Pro: 10× usage · classifier.dev",
    head: '<meta name="description" content="Classifier Pro: $20/month for 10× classification limits. Manage your subscription and API key."><meta name="referrer" content="no-referrer">',
    css: `
.pro{max-width:720px;margin:64px auto;padding:0 24px}.pro>*+*{margin-top:28px}
.pro h1{font-size:clamp(28px,5vw,40px);line-height:1.2}.pro h2{font-size:16px}.pro p{color:var(--muted)}
.pro header>*+*{margin-top:12px}.pro .price{color:var(--bright);font-size:22px}.price small{font-size:14px;color:var(--muted)}
.pro .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.pro table{width:100%;font-variant-numeric:tabular-nums}.pro th,.pro td{padding:8px 12px 8px 0;text-align:left;border:0}.pro th{color:var(--muted);font-weight:400}
.pro td,.pro th{text-align:right}.pro td:first-child,.pro th:first-child{text-align:left}.pro td:last-child,.pro th:last-child{padding-right:0;color:var(--bright)}.pro th small{font-size:11px;display:block}
.pro form{display:grid;gap:12px;max-width:420px}.pro input{font:inherit;padding:10px 12px;border:1px solid var(--line-strong);border-radius:var(--r);background:var(--surface);color:var(--fg);width:100%;box-sizing:border-box}
.pro button{min-height:40px}.pro .primary{background:var(--accent);color:var(--ink);padding:8px 16px;justify-content:center}.pro button:disabled{opacity:.5;cursor:wait}
.pro section>*+*{margin-top:14px}.pro [hidden]{display:none!important}.pro pre{white-space:pre-wrap;overflow-wrap:anywhere}
.pro input{font-size:16px}.pro #account-email{overflow-wrap:anywhere}.pro .primary{white-space:normal;text-align:center}
.pro .error{color:var(--bad)}.pro .pro-note{font-size:12px}.pro .actions{display:flex;flex-wrap:wrap;gap:12px}.pro #message:empty{display:none}
@media(max-width:480px){.pro{margin:32px auto;padding:0 20px}.pro th,.pro td{font-size:12px;padding-right:6px}}
`,
    body: `<main class="pro">
<nav class="row" aria-label="Navigation"><a class="b" href="/">classifier.dev</a><a class="b" href="/pricing">All plans</a><a class="b" href="/developers">API docs</a></nav>
<header><h1>10× usage. Classifier Pro.</h1><p class="intro">10× the free minute and daily limits. Both fast and smart. The same API, with more room to build.</p><p class="price">$20 <small>/ month · USD</small></p><p class="pro-note">No overage charges. Cancel anytime.</p></header>
<p id="message" role="status" aria-live="polite">Loading your account…</p>
<section id="signin" hidden><h2>Get 10× usage in three steps</h2><p>Sign in by email → subscribe → create your API key.</p><p>Already subscribed? Sign in with your billing email to manage Pro.</p><form id="login"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"><button class="b primary" type="submit">Email sign-in link</button></form></section>
<section id="account" hidden><h2 id="plan-status">Your account</h2><p id="account-email"></p><div class="actions"><button class="b primary" id="checkout">Get 10× usage · $20/month</button><button class="b" id="portal">Manage billing</button><button class="b" id="refresh">Refresh status</button><button class="b" id="logout">Sign out</button></div><p id="pending" hidden></p></section>
<section id="keys" hidden><h2>Use your 10× limits</h2><p id="key-instructions">Create an API key, then add it to your app. Requests without it still use the free limits.</p><p>Save your key somewhere private; it’s only shown once.</p><p id="rotation-warning" hidden>Replacing your key immediately stops the old one. Update every app that uses it.</p><button class="b primary" id="create-key">Create API key</button><div id="key-result" hidden><label for="api-key">New API key</label><input id="api-key" type="text" readonly spellcheck="false" autocomplete="off"><div class="actions"><button class="b primary" id="copy-key">Copy key</button><button class="b" id="hide-key">Hide key</button></div></div><pre><code>export CLASSIFY_API_KEY='your-api-key'
classify spam,"not spam" "Lunch at 1?"

curl https://classifier.dev/v1/classify -H "Authorization: Bearer $CLASSIFY_API_KEY" \
  -d '{"input":"Lunch at 1?","labels":["spam","not spam"]}'</code></pre><p class="pro-note">MCP clients send the same header; the limits apply to whichever way the key arrives.</p></section>
<section aria-label="Pro plan"><h2>Compare minute and daily limits</h2>
<table><caption class="sr-only">Classification limits on the free tier, per IP, and on Pro, per account</caption><thead><tr><th scope="col">Classifications</th><th scope="col">Free <small>per IP</small></th><th scope="col">Pro · 10× <small>per account</small></th></tr></thead><tbody><tr><th scope="row">Fast, a minute</th><td>3,000</td><td>30,000</td></tr><tr><th scope="row">Fast, a day</th><td>20,000</td><td>200,000</td></tr><tr><th scope="row">Smart, a minute</th><td>200</td><td>2,000</td></tr><tr><th scope="row">Smart, a day</th><td>2,000</td><td>20,000</td></tr></tbody></table>
<p>Up to 1,000 inputs per request. Works with REST, MCP and the CLI. No overage charges.</p><p class="pro-note">Billed monthly. Cancel anytime; access continues through your paid period. Daily limits reset at midnight UTC.</p></section>
<p class="pro-note">Free access stays available without an account. Billing details are kept separate from classification analytics. <a class="inline" href="/privacy">Privacy</a></p><noscript><p>Enable JavaScript to sign in and manage Pro. Free API access works without JavaScript.</p></noscript>
</main>`,
    script: `<script>
(() => {
  const $ = id => document.getElementById(id);
  let account;
  let activationTimer;
  let activationAttempts = 0;
  const checkoutReturn = new URLSearchParams(location.search).get('checkout') === 'complete';
  const stopActivation = () => { clearTimeout(activationTimer); activationTimer = undefined; };
  const message = (text, error = false) => { $('message').textContent = text; $('message').classList.toggle('error', error); };
  async function api(path, data) {
    const res = await fetch('/v1/billing/' + path, {method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: data === undefined ? {} : {'Content-Type':'application/json'}, body: data === undefined ? undefined : JSON.stringify(data)}).catch(() => { throw new Error('Could not reach billing. Check your connection and try again.'); });
    const result = await res.json();
    if (!res.ok) { const error = new Error(result.error || 'Unable to continue. Please try again.'); error.status = res.status; throw error; }
    return result;
  }
  function clearKey() { $('api-key').value = ''; $('key-result').hidden = true; }
  function signedOut() { account = null; stopActivation(); clearKey(); $('signin').hidden = false; $('account').hidden = true; $('keys').hidden = true; }
  async function refresh() {
    try {
      account = await api('account');
      $('signin').hidden = true; $('account').hidden = false;
      $('account-email').textContent = account.email;
      $('plan-status').textContent = account.active ? 'Pro is active · 10× usage' : checkoutReturn ? 'Confirming your Pro subscription' : 'Subscribe to unlock 10× usage';
      $('checkout').hidden = account.active || checkoutReturn;
      $('keys').hidden = !account.active;
      $('create-key').textContent = account.hasKey ? 'Replace API key' : 'Create API key';
      $('rotation-warning').hidden = !account.hasKey;
      $('create-key').classList.toggle('primary', !account.hasKey);
      $('pending').hidden = account.active;
      $('pending').textContent = checkoutReturn ? 'Waiting for payment confirmation. You can refresh your status or check Manage billing. No need to subscribe again.' : 'Continue to secure checkout, then return here to create your API key.';
      $('key-instructions').textContent = account.hasKey ? 'Your API key unlocks 10× limits on REST, MCP and the CLI. Requests without it still use the free limits.' : 'Create an API key, then add it to your app to use your 10× limits. Requests without it still use the free limits.';
      if (account.active) { stopActivation(); if (checkoutReturn) message('Pro is active. Add your API key to start using 10× limits.'); }
      if (!account.active) clearKey();
    } catch (error) { if (error.status === 401) signedOut(); else throw error; }
  }
  async function run(button, action) {
    button.disabled = true;
    const label = button.textContent; button.textContent = 'Working…';
    try { await action(); } catch (error) { message(error.message, true); if (error.status === 401) signedOut(); }
    finally { button.disabled = false; if (button.textContent === 'Working…') button.textContent = label; }
  }
  $('login').addEventListener('submit', event => { event.preventDefault(); const button = event.submitter; run(button, async () => { await api('login', {email:$('email').value}); message('Check your inbox for a sign-in link. It expires in 15 minutes.'); }); });
  $('checkout').onclick = () => run($('checkout'), async () => { const result = await api('checkout', {}); location.assign(result.url); });
  $('portal').onclick = () => run($('portal'), async () => { const result = await api('portal', {}); location.assign(result.url); });
  $('refresh').onclick = () => run($('refresh'), async () => { await refresh(); message(account && account.active ? 'Pro is active. Use your API key for 10× limits.' : 'No active Pro subscription yet. If you just paid, try again in a moment.'); });
  $('logout').onclick = () => run($('logout'), async () => { await api('logout', {}); signedOut(); message('Signed out.'); });
  $('create-key').onclick = () => { if (account.hasKey && !confirm('Replace your API key? The old key will stop working immediately.')) return; run($('create-key'), async () => { const result = await api('key', {}); $('api-key').value = result.key; $('key-result').hidden = false; account.hasKey = true; $('key-instructions').textContent = 'Add this key to your app to use your 10× limits. Requests without it still use the free limits.'; $('create-key').classList.toggle('primary', false); $('create-key').textContent = 'Replace API key'; $('rotation-warning').hidden = false; message('Save your new key. It won’t be shown again.'); }); };
  $('copy-key').onclick = () => run($('copy-key'), async () => { await navigator.clipboard.writeText($('api-key').value); message('API key copied.'); });
  $('hide-key').onclick = () => { clearKey(); message('Key hidden.'); };
  async function signInFromLocation() {
    stopActivation();
    const token = new URLSearchParams(location.hash.slice(1)).get('token');
    if (token) history.replaceState(null, '', location.pathname);
    try { if (token) await api('session', {token}); await refresh(); if (!checkoutReturn || !account || !account.active) message(''); if (checkoutReturn && account && !account.active) checkActivation(); }
    catch (error) { signedOut(); message(error.message, true); }
  }
  function checkActivation() {
    stopActivation();
    activationTimer = setTimeout(async () => {
      try {
        await refresh();
        if (!account || account.active) return;
        if (++activationAttempts < 6) checkActivation();
        else $('pending').textContent = 'Payment confirmation is taking longer than usual. Refresh your status in a moment, or check Manage billing. No need to subscribe again.';
      } catch (error) { message(error.message, true); }
    }, 5000);
  }
  addEventListener('hashchange', signInFromLocation);
  signInFromLocation();
})();
</script>`,
  });
}
