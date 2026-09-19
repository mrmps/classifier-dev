import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { SKILL_MD } from "../src/skill";
import { productServer, docsServer } from "../src/mcp";

const root = new URL("../", import.meta.url).pathname;
const read = (p: string) => readFileSync(root + p, "utf8");
const json = (p: string) => JSON.parse(read(p));

const claude = json("plugins/classifier/.claude-plugin/plugin.json");
const codex = json("plugins/classifier/.codex-plugin/plugin.json");
const mcp = json("plugins/classifier/.mcp.json");
const claudeMarket = json(".claude-plugin/marketplace.json");
const codexMarket = json(".agents/plugins/marketplace.json");

/**
 * The plugin is the site packaged for Claude Code, ChatGPT and Codex. What it
 * ships must be what the site serves, and the four files that name it must
 * agree, or an install gets a stale skill or a version that never bumps.
 */
describe("the plugin", () => {
  test("bundles the skill the site serves, byte for byte", () => {
    expect(read("plugins/classifier/skills/bulk-classify/SKILL.md")).toBe(SKILL_MD);
  });

  test("names one version everywhere", () => {
    const entry = claudeMarket.plugins.find((p: { name: string }) => p.name === "classifier");
    expect(codex.version).toBe(claude.version);
    expect(entry.version).toBe(claude.version);
    expect(entry.source).toBe("./plugins/classifier");
    expect(codexMarket.plugins[0].source.path).toBe("./plugins/classifier");
  });

  test("points both manifests at the served MCP endpoints", () => {
    expect(claude.mcpServers).toBe("./.mcp.json");
    expect(codex.mcpServers).toBe("./.mcp.json");
    expect(mcp.mcpServers.classifier).toEqual({ type: "http", url: "https://classifier.dev/mcp" });
    expect(mcp.mcpServers["classifier-docs"]).toEqual({ type: "http", url: "https://classifier.dev/mcp/docs" });
  });

  test("fits the ChatGPT directory limits", () => {
    const i = codex.interface;
    expect(i.displayName.length).toBeLessThanOrEqual(30);
    expect(i.shortDescription.length).toBeLessThanOrEqual(30);
    expect(i.shortDescription).not.toContain("\n");
    expect(i.longDescription.length).toBeLessThanOrEqual(4000);
    expect(codex.description.length).toBeLessThanOrEqual(1024);
    expect(i.defaultPrompt.length).toBeLessThanOrEqual(3);
    for (const p of i.defaultPrompt) expect(p.length).toBeLessThanOrEqual(128);
    expect(new Set(i.defaultPrompt).size).toBe(i.defaultPrompt.length);
    expect(i.brandColor).toMatch(/^#[0-9A-F]{6}$/i);
    expect(i.privacyPolicyURL).toBe("https://classifier.dev/privacy");
    expect(i.termsOfServiceURL).toBe("https://classifier.dev/terms");
    for (const f of ["logo", "composerIcon"]) expect(() => readFileSync(root + "plugins/classifier/" + i[f].replace("./", ""))).not.toThrow();
  });

  test("every tool it exposes is anonymous and annotated, so no client asks anyone to sign in", () => {
    const classify = async () => ({ status: 200, body: {} });
    for (const server of [productServer(classify), docsServer([])]) {
      for (const t of server.tools) {
        expect(t.name.length).toBeLessThanOrEqual(64);
        expect(t.title).toBeTruthy();
        expect(t.annotations.readOnlyHint).toBe(true);
        expect(t.annotations.destructiveHint).toBe(false);
      }
    }
  });
});
