#!/usr/bin/env node
// Cut a CLI release: bump the version, stamp the changelog, tag, push.
// Publishing to npm happens in CI from the tag (.github/workflows/publish-cli.yml),
// or run `npm publish` here if you are logged in.
//
//   node release.js patch|minor|major|<x.y.z>
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const sh = (cmd) => execSync(cmd, { stdio: "inherit" });
const out = (cmd) => execSync(cmd).toString().trim();

const bump = process.argv[2];
if (!bump) { console.error("usage: node release.js patch|minor|major|<x.y.z>"); process.exit(2); }
if (out("git status --porcelain")) { console.error("working tree is dirty; commit first"); process.exit(1); }

const pkgPath = new URL("./package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const [maj, min, pat] = pkg.version.split(".").map(Number);
const next =
  bump === "major" ? `${maj + 1}.0.0` :
  bump === "minor" ? `${maj}.${min + 1}.0` :
  bump === "patch" ? `${maj}.${min}.${pat + 1}` :
  /^\d+\.\d+\.\d+$/.test(bump) ? bump : null;
if (!next) { console.error(`bad bump: ${bump}`); process.exit(2); }

const changelog = readFileSync(new URL("./CHANGELOG.md", import.meta.url), "utf8");
if (!changelog.includes("## Unreleased")) {
  console.error("CHANGELOG.md needs an '## Unreleased' section describing this release");
  process.exit(1);
}
const today = new Date().toISOString().slice(0, 10);
writeFileSync(new URL("./CHANGELOG.md", import.meta.url), changelog.replace("## Unreleased", `## ${next} — ${today}`));
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

sh("node --test");
sh(`git add package.json CHANGELOG.md && git commit -q -m "cli ${next}"`);
sh(`git tag cli-v${next}`);
sh(`git push -q origin HEAD cli-v${next}`);
console.log(`\nreleased cli-v${next}. CI publishes it; or: cd cli && npm publish`);
