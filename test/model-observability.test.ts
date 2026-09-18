import { describe, expect, test } from "bun:test";

import { summarizeModels } from "../src/index";

describe("model observability", () => {
  test("reports one model without calling the batch mixed", () => {
    expect(summarizeModels([
      { model: "jev-1.13.0" },
      { model: "jev-1.13.0" },
    ])).toEqual({
      model: "jev-1.13.0",
      modelsUsed: ["jev-1.13.0"],
    });
  });

  test("reports mixed batches and every model that served them", () => {
    expect(summarizeModels([
      { model: "jev-1.13.0" },
      { model: "google/gemini-3.8-flash" },
      { model: "jev-1.13.0" },
    ])).toEqual({
      model: "mixed",
      modelsUsed: ["jev-1.13.0", "google/gemini-3.8-flash"],
    });
  });
});
