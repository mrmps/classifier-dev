import { describe, expect, test } from "bun:test";

import worker from "../src/index";
import type { Env } from "../src/index";

const env = {} as Env;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

const fetchPage = (path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://classifier.dev${path}`, { headers }), env, ctx);

const BROWSER = { accept: "text/html,application/xhtml+xml" };

describe("every answer", () => {
  test("negotiated 404s tell caches that Accept changes the answer", async () => {
    const res = await fetchPage("/v1/missing", { accept: "application/json" });
    expect(res.status).toBe(404);
    expect(res.headers.get("vary")).toContain("accept");
  });

  test("documentation variants include User-Agent in their cache key", async () => {
    for (const path of ["/", "/developers"]) {
      for (const agent of ["curl/8", "Mozilla/5.0", "ChatGPT-User"]) {
        const res = await fetchPage(path, { accept: "text/html", "user-agent": agent });
        expect(res.headers.get("vary")).toContain("user-agent");
      }
    }
  });
  test("insists on HTTPS, states its type, and keeps the path to itself", async () => {
    for (const path of ["/", "/privacy", "/openapi.json", "/llms.txt"]) {
      const res = await fetchPage(path);
      expect(res.headers.get("strict-transport-security")).toContain("max-age=31536000");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    }
  });
});

describe("the rendered pages", () => {
  test("may load nothing from anywhere", async () => {
    const csp = (await fetchPage("/", BROWSER)).headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
  });

  test("name every script they carry, by hash", async () => {
    const res = await fetchPage("/", BROWSER);
    const body = await res.text();
    const csp = res.headers.get("content-security-policy")!;
    const hashes = [...csp.matchAll(/'sha256-([A-Za-z0-9+/=]+)'/g)].map((m) => m[1]);
    const scripts = [...body.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    expect(hashes.length).toBe(scripts.length);
    for (const src of scripts) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(src));
      expect(hashes).toContain(btoa(String.fromCharCode(...new Uint8Array(digest))));
    }
  });

  test("get a policy that fits the page they are, not the last one rendered", async () => {
    const home = (await fetchPage("/", BROWSER)).headers.get("content-security-policy");
    const privacy = (await fetchPage("/privacy", BROWSER)).headers.get("content-security-policy");
    expect(home).not.toBe(privacy);
  });
});

describe("the operator endpoints", () => {
  test("do not take a key from the query string any more", async () => {
    const res = await fetchPage("/report?key=whatever-it-used-to-be");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("classifier.dev —");
  });

  test("and say nothing about themselves without one", async () => {
    for (const path of ["/report", "/alerts"]) {
      const res = await fetchPage(path);
      expect(res.status).toBe(404);
    }
  });
});
