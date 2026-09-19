import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import worker, { type Env } from "../src/index";
import { OPENAPI } from "../src/openapi";

const ajv = new Ajv2020({ strict: false });
const env = { STATS: { get: async () => null, put: async () => {} } } as unknown as Env;
const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;

async function submit(path: string, body: unknown) {
  return worker.fetch(new Request(`https://classifier.dev${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), env, ctx);
}

test("the feedback request schema agrees with the endpoint on required content", async () => {
  const validate = ajv.compile(OPENAPI.components.schemas.FeedbackReport);
  const cases = [
    { body: OPENAPI.components.schemas.FeedbackReport.example, valid: true },
    ...[{ title: "A bug" }, { summary: "A bug" }, { title: "", summary: "A bug" }, { title: "A bug", summary: "" }]
      .map((content) => ({ body: { signal: { category: "bug" }, content }, valid: true })),
    ...[{}, { title: "" }, { summary: "" }, { title: " \t", summary: "\n\u00a0" }]
      .map((content) => ({ body: { signal: { category: "bug" }, content }, valid: false })),
    { body: { category: "bug", summary: "Old flat body" }, valid: false },
    { body: { signal: { category: "bug" } }, valid: false },
  ];
  for (const { body, valid } of cases) {
    expect((await submit("/api/v1/feedback", body)).status).toBe(valid ? 202 : 400);
    expect(validate(body)).toBe(valid);
  }
});

test("the observation schema requires the same nonblank summary as the endpoint", async () => {
  const validate = ajv.compile(OPENAPI.components.schemas.Observation);
  for (const summary of ["A useful observation", "", " \t\n\u00a0"]) {
    const body = { category: "friction", summary };
    const valid = summary.trim().length > 0;
    expect((await submit("/api/v1/observations", body)).status).toBe(valid ? 202 : 400);
    expect(validate(body)).toBe(valid);
  }
});
