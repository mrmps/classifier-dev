#!/usr/bin/env node
// node skills/submit.mjs [name ...]
//
// Posts each seed skill to the live review and prints the verdict. With
// CLASSIFIER_API_KEY set to the partner bearer the hourly budget does not
// apply; without it, five an hour. A skill that is already listed answers
// 409 and is skipped. Nothing is written locally.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const origin = process.env.CLASSIFIER_ORIGIN ?? "https://classifier.dev";
const key = process.env.CLASSIFIER_API_KEY;
const names = process.argv.slice(2);
const dirs = readdirSync(root).filter((d) => !d.startsWith("_") && statSync(join(root, d)).isDirectory() && (!names.length || names.includes(d)));

let listed = 0;
for (const dir of dirs) {
  const skill = readFileSync(join(root, dir, "SKILL.md"), "utf8");
  const started = Date.now();
  const res = await fetch(`${origin}/v1/skills`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ skill, author: "classifier.dev", source: `https://github.com/mrmps/classifier-dev/tree/main/skills/${dir}` }),
  });
  const body = await res.json().catch(() => ({}));
  const s = ((Date.now() - started) / 1000).toFixed(1);
  if (res.status === 201) {
    const j = body.skill.review.judge;
    listed++;
    console.log(`listed   ${body.skill.review.score}  ${dir}  (safety ${j.safety} usefulness ${j.usefulness} novelty ${j.novelty} clarity ${j.clarity}, ${s}s)  ${body.url}`);
    for (const c of j.concerns ?? []) console.log(`           - ${c}`);
    if (j.notes) console.log(`           note: ${j.notes}`);
  } else if (res.status === 200) {
    console.log(`rejected ${body.stage.padEnd(8)}  ${dir}  (${s}s)`);
    for (const r of body.reasons ?? []) console.log(`           - ${r}`);
    if (body.judge) console.log(`           judge: safety ${body.judge.safety} usefulness ${body.judge.usefulness} novelty ${body.judge.novelty} clarity ${body.judge.clarity}; ${body.judge.notes ?? ""}`);
    if (body.jev) console.log(`           jev: ${JSON.stringify(body.jev)}`);
  } else if (res.status === 409) {
    console.log(`already  ${dir}  ${body.url}`);
  } else {
    console.log(`error ${res.status}  ${dir}  ${body.error ?? ""} (${body.code ?? ""})`);
    if (res.status === 429) {
      console.log(`           retry after ${res.headers.get("retry-after")}s`);
      break;
    }
  }
}
console.log(`\n${listed} newly listed of ${dirs.length} submitted.`);
