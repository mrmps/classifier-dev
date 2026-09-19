import { describe, expect, test } from "bun:test";
import worker, { type Env } from "../src/index";

const env = {} as Env;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const post = (path: string, body: string, contentType = "application/json") => worker.fetch(
  new Request(`https://classifier.dev${path}`, { method: "POST", headers: { "content-type": contentType }, body }), env, ctx,
);

describe("malformed request bodies", () => {
  for (const path of ["/v1/classify", "/subscribe", "/api/v1/feedback", "/api/v1/observations", "/api/v1/feedback/fb_test/attachments"]) {
    test(`${path} rejects non-object JSON and invalid JSON with a 400`, async () => {
      for (const body of ["null", "[]", "42", "true", '"hello"', "{"]) {
        const response = await post(path, body);
        expect(response.status).toBe(400);
        expect((await response.json() as { error: string }).error).toBeTruthy();
      }
    });
  }

  test("invalid labels cannot crash the error formatter", async () => {
    for (const labels of [[null], [42], [{}], [{ toString: null }], [null, "other"]]) {
      const response = await post("/v1/classify", JSON.stringify({ input: "hello", labels }));
      expect(response.status).toBe(400);
      expect((await response.json() as { code: string }).code).toBe(labels.length < 2 ? "too_few_labels" : "empty_label");
    }
  });

  test("a malformed multipart subscription returns a form error", async () => {
    const response = await post("/subscribe", "broken", "multipart/form-data");
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  test("a public smart batch that cannot fit any minute is a size error", async () => {
    const response = await post("/v1/classify", JSON.stringify({
      inputs: Array(201).fill("An ordinary sentence"), labels: ["positive", "negative"], tier: "smart",
    }));
    expect(response.status).toBe(400);
    expect((await response.json() as { code: string }).code).toBe("too_many_inputs");
  });
});
