/**
 * Write wrangler.toml from wrangler.example.toml.
 *
 * wrangler.toml is gitignored so real account identifiers never land in the
 * repository, which leaves CI with no config to deploy. The example carries the
 * shape — crons, bindings, migrations, rules — and the three values it holds
 * back come from the environment. What this writes is byte-identical to the
 * wrangler.toml a maintainer keeps locally.
 *
 * Because this is what CI deploys, the example is no longer a copy of the
 * config that can quietly fall behind it. It is the config.
 *
 *   CLOUDFLARE_ACCOUNT_ID=... STATS_KV_ID=... REPORT_TO=... node .github/render-wrangler.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILL = {
  YOUR_CLOUDFLARE_ACCOUNT_ID: "CLOUDFLARE_ACCOUNT_ID",
  YOUR_KV_NAMESPACE_ID: "STATS_KV_ID",
  "you@example.com": "REPORT_TO",
};

const missing = Object.values(FILL).filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`missing: ${missing.join(", ")}`);
  console.error("Set them as repository secrets; see the deploy workflow.");
  process.exit(1);
}

// The header comment tells a human to copy the file, which CI has just done.
let toml = readFileSync("wrangler.example.toml", "utf8").replace(/^#[^\n]*\n/gm, "").replace(/^\n+/, "");
for (const [placeholder, name] of Object.entries(FILL)) {
  if (!toml.includes(placeholder)) {
    console.error(`wrangler.example.toml no longer contains ${placeholder}.`);
    console.error("Someone changed the example without changing this script; CI would deploy a config with a hole in it.");
    process.exit(1);
  }
  toml = toml.split(placeholder).join(process.env[name]);
}

// A leftover placeholder would deploy to an account that does not exist, and
// wrangler's error would not say why.
const leftover = toml.match(/YOUR_[A-Z_]+|you@example\.com/);
if (leftover) {
  console.error(`wrangler.toml still contains the placeholder ${leftover[0]}.`);
  process.exit(1);
}

writeFileSync("wrangler.toml", toml);
console.log("wrangler.toml written from wrangler.example.toml");
