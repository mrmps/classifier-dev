/**
 * The static pass over a submitted skill: the cleaners.
 *
 * A SKILL.md is instructions an agent will follow with a shell in its hand, so
 * the first review is the one no model can be talked out of. The rules mirror
 * what the open-source skill scanners look for (Cisco's skill-scanner, NVIDIA's
 * SkillSpector, Snyk's agent-scan, kurtpayne/skillscan-security): instruction
 * override and hidden text, credential harvesting and exfiltration, remote
 * code that is fetched and run, destructive and persistence commands, embedded
 * secrets, obfuscated blobs and suspicious links. Each rule is a regular
 * expression with a severity: `block` ends the review before a model sees the
 * text, `warn` is handed to the judge as context and shown on the page.
 *
 * Deliberately blunt. A rule that fires on a benign skill costs the submitter
 * one rewrite; a rule that misses a malicious one costs somebody a laptop.
 *
 * Nothing here is a substitute for the two model passes that follow; it is the
 * pass that makes those passes safe to run on untrusted text.
 */

export type Severity = "block" | "warn";

export type Finding = {
  /** Stable id, in the vocabulary the open-source scanners use. */
  rule: string;
  severity: Severity;
  /** One sentence, addressed to the submitter. */
  message: string;
  /** 1-based line of the first hit, when the rule is line-scoped. */
  line?: number;
  /** The matched text, trimmed to something a page can show. */
  excerpt?: string;
};

export const MAX_SKILL_CHARS = 24_000;
export const MIN_SKILL_CHARS = 200;
export const MAX_LINE_CHARS = 2_000;

type Rule = { id: string; severity: Severity; re: RegExp; message: string };

/**
 * Line-scoped rules. Every regex is case-insensitive and applied to one line at
 * a time, so a hit has a line number and an excerpt.
 */
const RULES: Rule[] = [
  // ---- instruction override and hidden text (prompt injection) ----------
  {
    id: "prompt_injection.override",
    severity: "block",
    re: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|earlier|above|all|any|system|developer)\b[^.\n]{0,30}\b(instructions?|prompts?|rules?|guidelines?|constraints?)\b/i,
    message: "Tells the agent to ignore or override its existing instructions.",
  },
  {
    id: "prompt_injection.persona",
    severity: "block",
    re: /\b(you are now|from now on you are|act as if you have no|pretend (you|that you) (are|have) no|DAN mode|jailbreak|developer mode enabled)\b/i,
    message: "Tries to replace the agent's identity or switch off its safeguards.",
  },
  {
    id: "prompt_injection.secrecy",
    severity: "block",
    re: /\b(do not|don't|never)\b[^.\n]{0,30}\b(tell|inform|mention|reveal|show|disclose|alert)\b[^.\n]{0,30}\b(the )?(user|human|operator|owner)\b/i,
    message: "Asks the agent to hide what it is doing from the user.",
  },
  {
    id: "prompt_injection.no_confirm",
    severity: "warn",
    re: /\b(without|skip|bypass|no need for)\b[^.\n]{0,20}\b(asking|confirmation|confirming|permission|approval|review)\b/i,
    message: "Asks the agent to skip confirmation or permission steps.",
  },
  {
    id: "prompt_injection.hidden_html",
    severity: "block",
    re: /<!--[\s\S]{0,200}\b(instruction|ignore|must|always|never|secret|run|execute|curl|send)\b/i,
    message: "An HTML comment carries instructions a reader of the rendered page would not see.",
  },
  {
    id: "prompt_injection.hidden_markup",
    severity: "block",
    re: /<(script|iframe|object|embed|img|svg|style|meta|link|form)\b/i,
    message: "Active HTML is not allowed in a skill; write Markdown.",
  },

  // ---- credential harvesting and exfiltration --------------------------
  {
    id: "exfiltration.credential_paths",
    severity: "block",
    re: /(~|\$HOME|\/home\/\w+|\/Users\/\w+|\/root)\/\.(ssh|aws|gnupg|gcloud|azure|kube|docker|npmrc|netrc|pypirc|git-credentials|config\/gh|claude\/(settings|credentials))\b|\/etc\/(shadow|passwd)\b|id_(rsa|ed25519|ecdsa)\b|\.env\b[^.\n]{0,40}\b(cat|read|send|upload|post|curl|print|echo)\b|\b(cat|read|send|upload|post|curl|print|echo)\b[^.\n]{0,40}\.env\b/i,
    message: "Reads or sends credential files (~/.ssh, ~/.aws, .env, /etc/shadow and the like).",
  },
  {
    id: "exfiltration.env_dump",
    severity: "block",
    re: /\b(printenv|env\s*\|\s*(curl|nc|base64)|set\s*\|\s*curl|export -p|Get-ChildItem Env:|process\.env\b[^.\n]{0,40}\b(fetch|post|send|http))\b/i,
    message: "Dumps environment variables, which is where keys live.",
  },
  {
    id: "exfiltration.send_secret",
    severity: "block",
    re: /\b(api[_ -]?key|secret|token|password|credential|private key|cookie|session)s?\b[^.\n]{0,60}\b(send|post|upload|submit|transmit|forward|exfil|paste)\b[^.\n]{0,40}\b(to|at|via)\b|\b(send|post|upload|submit|transmit|forward|paste)\b[^.\n]{0,40}\b(api[_ -]?key|secret|token|password|credential|private key|cookie|session)s?\b[^.\n]{0,40}\b(to|at|via)\b/i,
    message: "Sends keys, tokens or passwords somewhere.",
  },
  {
    id: "exfiltration.webhook",
    severity: "block",
    re: /https?:\/\/[^\s)"'`]*\b(webhook\.site|requestbin|pipedream\.net|ngrok(-free)?\.(app|io|dev)|burpcollaborator|interact\.sh|oast\.(fun|live|me|online|pro|site)|beeceptor|hookbin|postb\.in|localtunnel|trycloudflare\.com|serveo\.net)\b/i,
    message: "Links to a request-capture or tunnel service, the usual destination for exfiltrated data.",
  },
  {
    id: "exfiltration.discord_telegram",
    severity: "block",
    re: /https?:\/\/(discord(app)?\.com\/api\/webhooks|api\.telegram\.org\/bot|hooks\.slack\.com\/services)\//i,
    message: "Posts to a chat webhook; a skill has no reason to phone home.",
  },
  {
    id: "exfiltration.ip_literal",
    severity: "block",
    re: /https?:\/\/(\d{1,3}\.){3}\d{1,3}(?![\d.])(?!.*\b(127\.0\.0\.1|0\.0\.0\.0)\b)/i,
    message: "Links to a bare IP address rather than a named host.",
  },
  {
    id: "exfiltration.shortener",
    severity: "warn",
    re: /https?:\/\/(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy|shorturl\.at|tiny\.cc|ow\.ly)\//i,
    message: "Uses a URL shortener; link to the real destination.",
  },
  {
    id: "exfiltration.punycode",
    severity: "block",
    re: /https?:\/\/[^\s/]*xn--/i,
    message: "Links to a punycode host, which is how look-alike domains are spelled.",
  },
  {
    id: "exfiltration.curl_upload",
    severity: "warn",
    re: /\b(curl|wget|http|https)\b[^\n]{0,80}(\s-(d|F|T|X\s*POST|-data|-upload-file|-form)\b)[^\n]{0,80}(@\/|@~|\$\(|`)/i,
    message: "Uploads a local file or command output to a remote host.",
  },

  // ---- remote code that is fetched and run -----------------------------
  {
    id: "remote_exec.pipe_to_shell",
    severity: "block",
    re: /\b(curl|wget|fetch|iwr|Invoke-WebRequest|irm|Invoke-RestMethod)\b[^\n|]{0,160}\|\s*(sudo\s+)?(ba|z|da|k|c|tc)?sh\b|\|\s*(sudo\s+)?(python3?|perl|ruby|node|bash|sh|iex|Invoke-Expression)\b[^\n]{0,20}$/i,
    message: "Pipes something downloaded straight into a shell or interpreter.",
  },
  {
    id: "remote_exec.eval_download",
    severity: "block",
    re: /\b(eval|exec|source|\.)\s*[("'`]?\s*\$?\(?(curl|wget|fetch)\b|\beval\s*\(\s*(atob|Buffer\.from|base64)/i,
    message: "Evaluates downloaded or decoded text as code.",
  },
  {
    id: "remote_exec.decode_run",
    severity: "block",
    re: /\b(base64|b64decode|xxd\s+-r|openssl\s+enc\s+-d)\b[^\n]{0,60}\|\s*(sudo\s+)?(ba|z|da)?sh\b|echo\s+["']?[A-Za-z0-9+/=]{40,}["']?\s*\|\s*base64\s+(-d|--decode)/i,
    message: "Decodes an encoded blob and runs it.",
  },
  {
    id: "remote_exec.binary_download",
    severity: "warn",
    re: /\b(curl|wget)\b[^\n]{0,120}\b(-o|-O|--output)\b[^\n]{0,80}\b(chmod\s+\+x|\.\/)/i,
    message: "Downloads a binary and marks it executable; pin the source and say what it is.",
  },

  // ---- destructive and persistence commands ----------------------------
  {
    id: "destructive.rm_root",
    severity: "block",
    re: /\brm\s+(-[a-z]*r[a-z]*f?[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+(\/|~|\$HOME|\*|\.\s*$|\.\.|\/\*)/i,
    message: "Deletes the filesystem, the home directory or the working tree.",
  },
  {
    id: "destructive.disk",
    severity: "block",
    re: /\b(mkfs(\.\w+)?|dd\s+if=|shred\b|diskutil\s+erase|format\s+[a-z]:|fdisk\b|wipefs)\b/i,
    message: "Writes to or erases a disk.",
  },
  {
    id: "destructive.git",
    severity: "warn",
    re: /\bgit\s+(push\s+[^\n]*--force|push\s+-f\b|reset\s+--hard\s+origin|clean\s+-[a-z]*f[a-z]*d|branch\s+-D\s+(main|master))/i,
    message: "Runs a git command that discards history; say when and why.",
  },
  {
    id: "destructive.fork_bomb",
    severity: "block",
    re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;|\bwhile\s+true.*\bfork\b/i,
    message: "A fork bomb.",
  },
  {
    id: "persistence.startup",
    severity: "block",
    re: /(>>|tee\s+-a)\s*(~|\$HOME)?\/?\.?(bashrc|zshrc|profile|bash_profile|zprofile)\b|\bcrontab\s+(-e|-|\S+\.txt)|\/etc\/cron\.|systemctl\s+enable|launchctl\s+load|LaunchAgents\/|\\Startup\\|HKLM\\.*\\Run\b|schtasks\s+\/create/i,
    message: "Installs something that runs again after this session.",
  },
  {
    id: "privilege.sudo",
    severity: "warn",
    re: /\bsudo\s+(?!apt|apt-get|brew|npm|pip|dnf|yum|pacman)\S|\bchmod\s+(-R\s+)?(777|a\+rwx|o\+w)\b|\bchown\s+(-R\s+)?root\b|setuid|\bsu\s+-\b/i,
    message: "Escalates privilege; a skill should not need root.",
  },
  {
    id: "privilege.security_off",
    severity: "block",
    // No \b before a flag: a hyphen is not a word character, so the boundary
    // would be looked for between the space and the dash and never found.
    re: /\b(csrutil\s+disable|spctl\s+--master-disable|setenforce\s+0|ufw\s+disable|iptables\s+-F|Set-MpPreference\s+-Disable|GIT_SSL_NO_VERIFY|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0)|(?<![\w-])(--no-verify|--insecure)\b|(?<![\w-])-k\s+https/i,
    message: "Turns off a security control (TLS verification, a firewall, SIP, Defender, commit hooks).",
  },
  {
    id: "supply_chain.package_hijack",
    severity: "warn",
    re: /\b(npm|pip|pnpm|yarn|gem|cargo)\s+(install|add|i)\b[^\n]{0,80}(--registry\s|--index-url\s|-i\s+https?:\/\/|--extra-index-url)/i,
    message: "Installs packages from a non-default registry; say which and why.",
  },
  {
    id: "supply_chain.unpinned_dependency",
    severity: "warn",
    re: /\b(npx|bunx|pipx\s+run|uvx)\s+(?!skills\b|@modelcontextprotocol\/inspector\b)[a-z@][\w@./-]*(?![^\n]*@\d)/i,
    message: "Runs a package straight from the registry without a pinned version.",
  },

  // ---- embedded secrets --------------------------------------------------
  {
    id: "secret.api_key",
    severity: "block",
    re: /\b(sk-[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|glpat-[A-Za-z0-9_-]{20}|npm_[A-Za-z0-9]{36}|re_[A-Za-z0-9]{20,}|sq0[a-z]{3}-[A-Za-z0-9_-]{20,})\b/,
    message: "Contains what looks like a live credential. Remove it and rotate it.",
  },

  // ---- obfuscation -------------------------------------------------------
  {
    id: "obfuscation.base64_blob",
    severity: "block",
    re: /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{120,}={0,2}(?![A-Za-z0-9+/])/,
    message: "A long encoded blob; a skill is meant to be read.",
  },
  {
    id: "obfuscation.hex_escapes",
    severity: "block",
    re: /(\\x[0-9a-f]{2}){8,}|(\\u[0-9a-f]{4}){6,}|(%[0-9a-f]{2}){12,}/i,
    message: "A run of escaped bytes; write the text in the open.",
  },
  {
    id: "obfuscation.reversed",
    severity: "warn",
    re: /\|\s*rev\s*\|\s*(ba)?sh\b|\.split\(['"]{2}\)\.reverse\(\)\.join/i,
    message: "Reverses a string before running it.",
  },
];

/**
 * Characters that are invisible on a page and meaningful to a model: zero
 * width joiners and spaces, bidi overrides, soft hyphens, the Unicode tag
 * block (U+E0000 to U+E007F, which is how text is smuggled past a reader),
 * and the private-use areas. Any one of them is a block: a skill has no
 * legitimate use for text that a person cannot see.
 */
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿­᠎-]|[\uDB40][\uDC00-\uDC7F]/;

/**
 * Letters from scripts that have look-alikes in Latin (Cyrillic, Greek) inside
 * an otherwise Latin word: "аdmin" with a Cyrillic а. A whole word in another
 * script is fine; a mixed word is a homoglyph.
 */
const MIXED_SCRIPT = /(?<![\p{L}\p{N}])(?=[\p{L}\p{N}]*[A-Za-z])(?=[\p{L}\p{N}]*[\u0400-\u04FF\u0370-\u03FF])[\p{L}\p{N}]+(?![\p{L}\p{N}])/u;

const clip = (s: string, n = 96) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Line endings, BOM and trailing whitespace normalised; more than two blank lines collapsed. */
export function clean(raw: string): string {
  return raw
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
}

export type Frontmatter = { name: string; description: string; body: string };

/** The `---` block at the top, or null when there is none. Only name and description are read. */
export function frontmatter(text: string): Frontmatter | null {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const fields: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1].toLowerCase()] = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { name: fields.name ?? "", description: fields.description ?? "", body: m[2] };
}

/** name: lowercase, digits and hyphens, the way `npx skills` and Claude Code want a directory called. */
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * Run every cleaner over a skill. Returns the findings in document order; the
 * caller decides what a `block` means (it means the review stops).
 */
export function scan(text: string): Finding[] {
  const out: Finding[] = [];
  const lines = text.split("\n");

  if (text.length > MAX_SKILL_CHARS) {
    out.push({ rule: "structure.too_long", severity: "block", message: `A skill is at most ${MAX_SKILL_CHARS.toLocaleString("en-US")} characters; this is ${text.length.toLocaleString("en-US")}.` });
  }
  if (text.length < MIN_SKILL_CHARS) {
    out.push({ rule: "structure.too_short", severity: "block", message: `A skill needs at least ${MIN_SKILL_CHARS} characters of instructions to be worth reviewing.` });
  }

  const fm = frontmatter(text);
  if (!fm) {
    out.push({ rule: "structure.no_frontmatter", severity: "block", message: "Start with a YAML front matter block: ---, name:, description:, ---." });
  } else {
    if (!SLUG.test(fm.name)) {
      out.push({ rule: "structure.bad_name", severity: "block", message: "name must be 1 to 64 lowercase letters, digits and hyphens, like `bulk-classify`." });
    }
    if (fm.description.length < 20 || fm.description.length > 1024) {
      out.push({ rule: "structure.bad_description", severity: "block", message: "description must say in 20 to 1,024 characters what the skill does and when to use it." });
    }
    if (!/^#{1,3}\s|\n#{1,3}\s|\n- |\n\d+\. |\n {4}\S/.test(fm.body)) {
      out.push({ rule: "structure.no_steps", severity: "warn", message: "No headings, lists or code blocks: a skill reads better as steps than as a paragraph." });
    }
  }

  const invisible = text.match(INVISIBLE);
  if (invisible) {
    const at = text.indexOf(invisible[0]);
    out.push({
      rule: "hidden_text.invisible_characters",
      severity: "block",
      message: `Contains an invisible character (U+${invisible[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}). Remove zero-width, bidi and tag characters.`,
      line: text.slice(0, at).split("\n").length,
    });
  }
  const mixed = text.match(MIXED_SCRIPT);
  if (mixed) {
    out.push({ rule: "hidden_text.homoglyph", severity: "block", message: "A word mixes Latin with Cyrillic or Greek letters, which is how look-alike text is smuggled in.", excerpt: clip(mixed[0]) });
  }

  lines.forEach((line, i) => {
    if (line.length > MAX_LINE_CHARS) {
      out.push({ rule: "structure.long_line", severity: "block", message: `Line ${i + 1} is ${line.length} characters; nothing readable is that long.`, line: i + 1 });
      return;
    }
    for (const r of RULES) {
      const m = line.match(r.re);
      if (!m) continue;
      // One report per rule, at its first hit; the judge and the page get a summary, not a log.
      if (out.some((f) => f.rule === r.id)) continue;
      out.push({ rule: r.id, severity: r.severity, message: r.message, line: i + 1, excerpt: clip(m[0].trim()) });
    }
  });

  // Links: count and shape. A skill that is mostly links is an advert.
  const links = [...text.matchAll(/https?:\/\/[^\s)"'`<>]+/g)].map((m) => m[0]);
  if (links.length > 40) {
    out.push({ rule: "structure.link_farm", severity: "block", message: `${links.length} links; a skill is instructions, not a directory.` });
  }
  const insecure = links.find((l) => l.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(l));
  if (insecure) {
    out.push({ rule: "exfiltration.plain_http", severity: "warn", message: "Links over plain http; use https.", excerpt: clip(insecure) });
  }

  return out;
}

export const blocked = (findings: Finding[]) => findings.filter((f) => f.severity === "block");
export const warnings = (findings: Finding[]) => findings.filter((f) => f.severity === "warn");
