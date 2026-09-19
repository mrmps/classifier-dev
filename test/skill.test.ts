import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import worker from "../src/index";
import type { Env } from "../src/index";
import { SKILL_MD, SKILL_NAME } from "../src/skill";

const env = {} as Env;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const fetchPath = (path: string) => worker.fetch(new Request(`https://classifier.dev${path}`), env, ctx);

/**
 * `npx skills add https://classifier.dev` reads the discovery index, fetches
 * the URL it names and checks the digest against the bytes. All three have to
 * describe the file in src/SKILL.md as written — and under Bun the import has
 * to be the Markdown, not the HTML its default .md loader renders.
 */
describe("the agent skill", () => {
  test("is served as the Markdown in src/SKILL.md, byte for byte", async () => {
    const source = readFileSync(new URL("../src/SKILL.md", import.meta.url), "utf8");
    expect(SKILL_MD).toBe(source);
    expect(SKILL_MD.startsWith(`---\nname: ${SKILL_NAME}\n`)).toBe(true);
    const res = await fetchPath("/skill.md");
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(await res.text()).toBe(source);
  });

  test("has a discovery index whose digest is the served file's sha256", async () => {
    const index = (await (await fetchPath("/.well-known/skills/index.json")).json()) as {
      skills: { name: string; url: string; digest: string }[];
    };
    const [skill] = index.skills;
    expect(skill.name).toBe(SKILL_NAME);
    expect(skill.url).toBe("https://classifier.dev/skill.md");
    const bytes = new Uint8Array(await (await fetchPath("/skill.md")).arrayBuffer());
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(skill.digest).toBe(`sha256:${hex}`);
    // The legacy path the skills CLI falls back to serves the same index.
    expect(await (await fetchPath("/.well-known/agent-skills/index.json")).json()).toEqual(index);
  });

  test("names commands the site actually offers", () => {
    for (const cmd of ["npm i -g classifier-dev", "classify bug,feature,praise < feedback.txt", "curl https://classifier.dev -d", "GET /openapi.json", "GET /benchmark"]) {
      expect(SKILL_MD).toContain(cmd);
    }
  });
});
