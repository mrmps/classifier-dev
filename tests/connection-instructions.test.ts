import { describe, expect, test } from "bun:test";
import {
  getAgentSetupPrompt,
  getConnectionInstructions,
} from "../src/features/onboarding/connection-instructions";

describe("agent setup handoff", () => {
  test.each(["Claude Code", "Codex", "Cursor", "Other"])(
    "%s prompt uses the correct endpoint and requests secure credential setup",
    (client) => {
      const prompt = getAgentSetupPrompt(client, "http://127.0.0.1:3000/");
      expect(prompt).toContain("http://127.0.0.1:3000/mcp");
      expect(prompt).toContain("server classifier");
      expect(prompt).toContain("CLASSIFIER_API_KEY");
      expect(prompt).toContain("do not ask me to paste the key into chat");
      expect(prompt).toContain(
        "Only report success after the real tool call succeeds",
      );
      expect(prompt).not.toContain("classifier_agent_");
    },
  );
  test("hosted prompt avoids localhost instructions and uses production server name", () => {
    const prompt = getAgentSetupPrompt("Codex", "https://classifier.dev");
    expect(prompt).toContain("server classifier at https://classifier.dev/mcp");
    expect(prompt).not.toContain("classifier-local");
    expect(prompt).not.toContain("runs on my computer");
  });
  test("ChatGPT does not offer fake supported setup", () => {
    const prompt = getAgentSetupPrompt("ChatGPT", "http://localhost:3000");
    expect(prompt).toContain("not available yet");
    expect(prompt).toContain("hosted OAuth");
  });
  test("manual setup quotes shell metacharacters without altering the secret", () => {
    const secret = "test'$(touch /tmp/not-executed)";
    const setup = getConnectionInstructions({
      client: "Claude Code",
      secret,
      origin: "https://classifier.dev",
    }).setup;
    expect(setup).toContain(
      "'Authorization: Bearer test'\"'\"'$(touch /tmp/not-executed)'",
    );
    expect(
      getAgentSetupPrompt("Claude Code", "https://classifier.dev"),
    ).not.toContain(secret);
  });
  test("Cursor config references environment rather than embedding the credential", () => {
    const result = getConnectionInstructions({
      client: "Cursor",
      secret: "classifier_agent_test_private",
      origin: "https://classifier.dev",
    });
    expect(result.setup).not.toContain("classifier_agent_test_private");
    expect(
      JSON.parse(result.setup).mcpServers.classifier.headers.Authorization,
    ).toBe("Bearer ${env:CLASSIFIER_API_KEY}");
  });
});
