// bun run skills/check.ts [path ...]
//
// The first gate of the live review, run locally: the cleaners over each
// SKILL.md, with every block and warning printed. A skill that blocks here
// blocks there; a warning is what the judge will be shown.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { blocked, clean, frontmatter, scan, warnings } from "../src/skillscan";

const args = process.argv.slice(2);
const root = join(import.meta.dir);
const files = args.length
  ? args
  : readdirSync(root)
      .filter((d) => !d.startsWith("_") && statSync(join(root, d)).isDirectory())
      .map((d) => join(root, d, "SKILL.md"));

let bad = 0;
for (const file of files) {
  const text = clean(readFileSync(file, "utf8"));
  const findings = scan(text);
  const fm = frontmatter(text);
  const blocks = blocked(findings);
  const warns = warnings(findings);
  const name = fm?.name ?? "(no front matter)";
  console.log(`${blocks.length ? "BLOCK" : warns.length ? "warn " : "ok   "}  ${name}  ${text.length.toLocaleString("en-US")} chars  ${file}`);
  for (const f of [...blocks, ...warns]) {
    console.log(`        ${f.severity}  ${f.rule}${f.line ? ` (line ${f.line})` : ""}: ${f.message}${f.excerpt ? `  [${f.excerpt}]` : ""}`);
  }
  if (blocks.length) bad++;
}
if (bad) {
  console.log(`\n${bad} of ${files.length} would be blocked.`);
  process.exit(1);
}
