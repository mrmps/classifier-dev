import { describe, expect, test } from "bun:test";

import { OPENAPI } from "../src/openapi";
import { parseFeedback, CATEGORIES } from "../src/feedback";

/**
 * The spec once described a flat {category, summary} body while the endpoint
 * read the feedback.now envelope, so an agent that followed openapi.json was
 * rejected with "signal.category must be one of ...". The example in the spec
 * is what an agent copies, so it has to be what the validator accepts, and the
 * vocabularies have to be the validator's own.
 */
describe("the feedback spec matches the validator", () => {
  const schemas = OPENAPI.components.schemas as Record<string, { example?: Record<string, unknown>; required?: string[]; properties: Record<string, { enum?: string[]; properties?: Record<string, { enum?: string[] }> }> }>;
  const report = schemas.FeedbackReport;
  const post = (OPENAPI.paths as Record<string, { post?: { requestBody: { content: Record<string, { schema: { $ref?: string } }> } } }>)["/api/v1/feedback"].post!;

  test("POST /api/v1/feedback is documented with the envelope, not a flat body", () => {
    expect(post.requestBody.content["application/json"].schema.$ref).toBe("#/components/schemas/FeedbackReport");
    expect(report.required).toEqual(["signal", "content"]);
  });

  test("the example parses as-is", () => {
    const parsed = parseFeedback(report.example!);
    expect(parsed.signal.category).toBe("bug");
    expect(parsed.content.title).toContain("/v1/classify");
    expect(parsed.evidence).toHaveLength(1);
  });

  test("the categories are the validator's", () => {
    expect(report.properties.signal.properties!.category.enum).toEqual([...CATEGORIES]);
    expect(schemas.Observation.properties.category.enum).toEqual([...CATEGORIES]);
  });

  test("the flat body the old spec described is still rejected, with a message that names the envelope", () => {
    expect(() => parseFeedback({ category: "bug", summary: "x" })).toThrow(/signal\.category/);
  });
});
