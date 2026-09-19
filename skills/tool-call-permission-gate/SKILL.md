---
name: tool-call-permission-gate
description: A second opinion on every shell, file and MCP call a coding agent proposes: classify what it would do, refuse the confidently destructive ones, and attach the reason to the confirmation the person already sees, with the command redacted first. Use when setting up a PreToolUse hook.
license: MIT
---

# A second opinion on every tool call

An allowlist matches strings: `rm -rf build` and `rm -fr ./build` are one act
in two spellings. Classify what the call would do instead, beside
the decision the person is already making. The gate does two things and no
more: it refuses a call it is sure is destructive, and it attaches a reason to
the question the person gets anyway. An automatic yes is opt-in, below.

## What leaves the machine

One string per call: the tool name and its arguments, redacted, cut to 2,000
characters. No file contents, no environment, no repository name. Redaction
replaces bearer and basic headers, fields and flags named for a key, token,
secret or password, opaque runs of 40 characters or more, hex digests, mail
addresses and query strings. A call still holding more than two placeholders
is never sent; it goes to the person.

    in   Bash: curl -H "authorization: Bearer tok_9f2a" https://api.example.com/orders?key=9f2a
    out  Bash: curl -H "authorization: Bearer [redacted]" https://api.example.com/orders?[redacted]
         tool gate: ask - read only, changes nothing 0.99

    in   Bash: deploy --token tok_9f2a --secret s3cr3t --user ops@example.com
    out  tool gate: ask - mostly redacted, nothing was sent

The service states that it stores no input text and forwards it to the model
provider answering the request: https://classifier.dev/privacy. Read that
against your policy. **If the policy keeps command lines off the network, keep
them off**: ask the agent's own model the same labels and apply the same rule.
Any classifier returning a calibrated confidence fits here; this one needs no
account.

## The hook

Four labels naming consequence, not category, spelled out because labels are
read as language: `p0` classifies worse than `destructive or irreversible`.
The hook reads a PreToolUse JSON object or a bare command on stdin and exits
0 allow, 1 ask, 2 block.

```js
#!/usr/bin/env node
const LABELS = ["read only, changes nothing", "writes only inside this repository",
  "changes shared state outside this machine", "destructive or irreversible"];
const DENY_AT = 0.9;
const AUTO_ALLOW = process.argv.includes("--auto-allow");   // off by default

const REDACT = [
  [/\b(bearer|basic)\s+[^\s"']+/gi, "$1 [redacted]"],
  [/(--?[\w-]*(?:key|token|secret|password|pwd)[\w-]*)[= ]+"?[^\s",}]+/gi, "$1 [redacted]"],
  [/([\w.-]*(?:key|token|secret|password|pwd)[\w.-]*)\s*[=:]\s*"?[^\s",}]+/gi, "$1=[redacted]"],
  [/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]"],
  [/\b[0-9a-f]{32,}\b/gi, "[redacted]"],
  [/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "[redacted]"],
  [/([?&])[^\s"'`]+/g, "$1[redacted]"],
];
const redact = (s) => REDACT.reduce((t, [re, to]) => t.replace(re, to), s);

async function verdict(call) {
  const text = redact(call).slice(0, 2000);
  if ((text.match(/\[redacted\]/g) || []).length > 2)
    return ["ask", "mostly redacted, nothing was sent"];
  const r = await fetch("https://classifier.dev/v1/classify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ labels: LABELS, inputs: [text],
      instructions: "A coding agent proposes this tool call. Judge only what running it would do." }),
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new Error(`classifier ${r.status}`);
  const [res] = (await r.json()).results;
  const c = res.confidence ?? 0, why = `${res.label} ${c}`;
  if (res.label === LABELS[3] && c >= DENY_AT) return ["deny", why];
  if (AUTO_ALLOW && c >= DENY_AT && LABELS.indexOf(res.label) < 2) return ["allow", why];
  return ["ask", why];
}

(async () => {
  let raw = ""; for await (const c of process.stdin) raw += c;
  let hook = null; try { hook = JSON.parse(raw); } catch {}
  const call = hook?.tool_name
    ? `${hook.tool_name}: ${JSON.stringify(hook.tool_input)}` : raw.trim();
  let d = "ask", why = "gate unavailable";
  try { [d, why] = await verdict(call); }
  catch (e) { why = `gate unavailable, ${e.message}`; }
  const out = { hookEventName: "PreToolUse", permissionDecision: d, permissionDecisionReason: `tool gate: ${why}` };
  if (hook) return console.log(JSON.stringify({ hookSpecificOutput: out }));
  console.error(`tool gate: ${d} - ${why}`);
  process.exit(d === "allow" ? 0 : d === "ask" ? 1 : 2);
})();
```

Register it in `.claude/settings.json` under `hooks.PreToolUse`, matcher
`Bash|Edit|Write`, command `node .claude/hooks/gate.js`. Codex, Cursor and
OpenCode pass text: the stdin path.

## Thresholds

The classifier returns labels, scores and a calibrated confidence, and writes
no prose. Refuse at 0.9 and above on `destructive or irreversible`, where
answers were right 82 to 92% of the time: `rm -rf build dist and untracked
files` was refused at 0.94, exit 2. Everything else stays a question
carrying the label and the number: from 0.5 to 0.9 that number is the warning,
below 0.5 the gate does not know. A network failure, a 429 or a held-back
command is a question too.

`--auto-allow` turns a read-only or in-repository answer at 0.9 and above into
a yes. Do not start there: run the gate for a week, log its lines, read what
it would have allowed, and set the flag only if that log is dull. `npm test`
measured 0.75 and `psql prod -c "DROP TABLE orders"` 0.66, so that week is not
a formality, and no threshold makes this a security boundary. Keep hard deny
rules for the acts you never want, and send one command per call: a chained
line gets a single label.

## When not to use

Skip it when the policy keeps command lines off the network, when a static
deny list already covers the repository, or when the agent runs in a
throwaway container.
