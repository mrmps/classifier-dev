import { describe, expect, test } from "bun:test";

import worker from "../src/index";
import type { Env } from "../src/index";

const env = {} as Env;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

const fetchPath = (path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://classifier.dev${path}`, { headers }), env, ctx);

/**
 * GET /{labels}/{text} means any two-segment path reads as a classification,
 * which used to swallow the service's own namespaces: /v1/classifyy came back
 * as `Provide at least 2 labels; got 1 ("v1")`, and a scanner asking for
 * /.well-known/security.txt got the same. Both are 404s.
 */
describe("a path inside a namespace this service owns", () => {
  const typos = [
    "/v1/nope",
    "/v1/classifyy",
    "/v1/health/extra",
    "/api/nope",
    "/mcp/nope",
    "/admin/nope",
    "/.well-known/nope",
    "/.well-known/dnt-policy.txt",
  ];

  test("is a 404, not a classification error", async () => {
    for (const path of typos) {
      const res = await fetchPath(path);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("at least 2 labels");
    }
  });

  test("is still a 404 when it is asked for as JSON", async () => {
    const res = await fetchPath("/v1/classifyy", { accept: "application/json" });
    expect(res.status).toBe(404);
    expect((await res.json() as { code: string }).code).toBe("not_found");
  });

  test("does not catch a label list that happens to start with one", async () => {
    // The guard keys off an exact first segment, and a label list keeps its
    // commas, so this is two labels and a text — not the v1 namespace.
    const res = await fetchPath("/v1,v2/some+text");
    expect(res.status).not.toBe(404);
  });
});

describe("security.txt", () => {
  test("answers on the path RFC 9116 reserves, and on the bare one", async () => {
    for (const path of ["/.well-known/security.txt", "/security.txt"]) {
      const res = await fetchPath(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
    }
  });

  test("carries the contact the contact page gives, and an Expires in the future", async () => {
    const body = await (await fetchPath("/.well-known/security.txt")).text();
    expect(body).toContain("Contact: mailto:contact@classifier.dev");
    expect(body).toContain("Canonical: https://classifier.dev/.well-known/security.txt");

    const expires = body.match(/^Expires: (.+)$/m)?.[1];
    expect(expires).toBeTruthy();
    const at = new Date(expires!).getTime();
    expect(at).toBeGreaterThan(Date.now());
    // The RFC caps it at a year out; six months leaves room and never expires
    // on its own.
    expect(at).toBeLessThan(Date.now() + 365 * 24 * 60 * 60 * 1000);
  });
});
