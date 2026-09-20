import { describe, expect, test } from "bun:test";
import Ajv from "ajv";
import { productServer } from "../src/mcp";
import {
  onboardingSamples,
  onboardingSamplePresentation,
} from "../src/features/onboarding/samples";
import { getConnectionTask } from "../src/features/onboarding/connection-instructions";

const mainTasks = ["Filter research", "Group feedback", "Sort files"];
const server = productServer(async () => ({ status: 200, body: {} }));
const schema = server.tools.find(
  (tool) => tool.name === "classify_texts",
)!.inputSchema;
const validate = new Ajv().compile(schema);

describe("paste-ready onboarding tasks", () => {
  for (const [name, sample] of Object.entries(onboardingSamples)) {
    test(
      name + " fits the real MCP request schema and validation limits",
      async () => {
        expect(validate(sample)).toBe(true);
        expect(Object.keys(sample).sort()).toEqual([
          "inputs",
          "instructions",
          "labels",
        ]);
        expect(sample.instructions.length).toBeLessThanOrEqual(2000);
        expect(
          sample.inputs.every(
            (input) => input.length > 0 && input.length <= 32_000,
          ),
        ).toBe(true);
        expect(new Set(sample.labels).size).toBe(sample.labels.length);
        let received: Record<string, unknown> | undefined;
        const tool = productServer(async (body) => {
          received = body;
          return {
            status: 200,
            body: {
              results: sample.inputs.map(() => ({
                label: sample.labels[0],
                confidence: null,
              })),
            },
          };
        }).tools.find((tool) => tool.name === "classify_texts")!;
        await tool.run(sample, {
          req: new Request("https://classifier.dev/mcp"),
        });
        expect(received?.inputs).toEqual(sample.inputs);
        expect(received?.labels).toEqual(sample.labels);
        expect(received?.instructions).toBe(sample.instructions);
      },
    );
  }

  test.each(mainTasks)(
    "%s offers a meaningful batch with stable IDs and separate preview copy",
    (name) => {
      const sample = onboardingSamples[name];
      expect(sample.inputs.length).toBeGreaterThanOrEqual(8);
      expect(sample.inputs.length).toBeLessThanOrEqual(12);
      const ids = sample.inputs.map((input) => input.split(" | ")[0]);
      expect(new Set(ids).size).toBe(sample.inputs.length);
      expect(ids.every((id) => /^[RFD][0-9]{2}$/.test(id))).toBe(true);
      expect(onboardingSamplePresentation[name].summary.length).toBeGreaterThan(
        20,
      );
      expect(
        sample.labels.some((label) => /review|context|detail/.test(label)),
      ).toBe(true);
    },
  );

  test.each(mainTasks)(
    "%s prompt preserves exact API payload and asks for grounded output",
    (name) => {
      const sample = onboardingSamples[name];
      const fence = String.fromCharCode(96).repeat(3);
      const prompt = getConnectionTask(sample);
      const payload = prompt.split(fence + "json\n")[1].split("\n" + fence)[0];
      expect(JSON.parse(payload)).toEqual(sample);
      expect(prompt).toContain("Use classifier's classify_texts");
      expect(prompt).toContain("compact table");
      expect(prompt).toContain("zero-count labels");
      expect(prompt).toContain("never invent a score");
      expect(prompt).toContain("do not browse the web, inspect local files");
      expect(prompt).toContain(
        "If the tool is unavailable or the request fails",
      );
      expect(prompt).not.toContain("classifier_agent_");
    },
  );
});
