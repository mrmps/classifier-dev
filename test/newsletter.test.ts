// Run with: npm test
//
// Two things here are worth a test. An address that a real person typed must
// survive normalising, because rejecting a good address is the only failure
// the form cannot recover from. And the address must reach Postgres as a bound
// parameter, never as text in a statement — an apostrophe in a name is enough
// to matter, and the same hole is how a table gets read back out.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ROADMAP, normalise, roadmapDoc, subscribe, Unavailable } from "../src/newsletter";

const CONN = "postgresql://writer:pw@ep-test.us-east-1.aws.neon.tech/neondb?sslmode=require";
const env = { NEWSLETTER_DATABASE_URL: CONN } as never;

let realFetch: typeof globalThis.fetch;
beforeEach(() => void (realFetch = globalThis.fetch));
afterEach(() => void (globalThis.fetch = realFetch));

/** Records the one request subscribe() makes. */
function capture(status = 200) {
  const seen: { url: string; headers: Headers; body: { query: string; params: unknown[] } }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify({ rowCount: 1 }), { status });
  }) as typeof globalThis.fetch;
  return seen;
}

describe("normalise", () => {
  it("keeps addresses people actually have", () => {
    for (const good of [
      "a@b.co",
      "first.last@sub.domain.example",
      "user+classifier@gmail.com",
      "o'brien@example.ie",
      "user_name-1@example.co.uk",
    ]) {
      expect(normalise(good)).toBe(good);
    }
  });

  it("trims and lowercases, so the same person is one row", () => {
    expect(normalise("  Someone@Example.COM \n")).toBe("someone@example.com");
  });

  it("rejects what is not an address", () => {
    for (const bad of [
      "",
      "   ",
      "nodomain",
      "no@tld",
      "two@@example.com",
      "spaces in@example.com",
      "a@b.com, c@d.com",
      "a@b.com;c@d.com",
      `${"a".repeat(250)}@example.com`,
      null,
      undefined,
      42,
      { email: "a@b.com" },
    ]) {
      expect(normalise(bad)).toBeNull();
    }
  });
});

describe("the printed roadmap", () => {
  it("prints every item, so the page and the plain text cannot drift", () => {
    const doc = roadmapDoc();
    for (const r of ROADMAP) {
      expect(doc).toContain(r.name);
      expect(doc).toContain(r.what);
    }
  });

  it("stays inside the width the rest of the docs use", () => {
    for (const line of roadmapDoc().split("\n")) expect(line.length).toBeLessThanOrEqual(78);
  });

  it("tells the reader what is kept", () => {
    expect(roadmapDoc()).toContain("the address and the date");
  });
});

describe("subscribe", () => {
  it("binds the address instead of writing it into the statement", async () => {
    const seen = capture();
    await subscribe(env, "o'brien@example.ie", "form");

    expect(seen).toHaveLength(1);
    expect(seen[0].body.params[0]).toBe("o'brien@example.ie");
    expect(seen[0].body.query).not.toContain("o'brien");
    expect(seen[0].body.query).toContain("$1");
  });

  it("makes a repeat signup a no-op, so the answer is never an address oracle", async () => {
    const seen = capture();
    await subscribe(env, "someone@example.com", "api");
    expect(seen[0].body.query).toContain("on conflict (email) do nothing");
  });

  it("writes only the address and where it came from", async () => {
    const seen = capture();
    await subscribe(env, "someone@example.com", "form");

    const { query, params } = seen[0].body;
    expect(params).toEqual(["someone@example.com", "form"]);
    // No column that could tie the row to a request.
    for (const forbidden of ["ip", "user_agent", "request_id", "country"]) {
      expect(query).not.toContain(forbidden);
    }
  });

  it("talks to the host in the connection string, over HTTP", async () => {
    const seen = capture();
    await subscribe(env, "someone@example.com", "api");
    expect(seen[0].url).toBe("https://ep-test.us-east-1.aws.neon.tech/sql");
    expect(seen[0].headers.get("neon-connection-string")).toBe(CONN);
  });

  it("fails loudly when Postgres says no, without repeating the password", async () => {
    capture(403);
    const err = await subscribe(env, "someone@example.com", "api").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Unavailable);
    expect((err as Error).message).toContain("403");
    expect((err as Error).message).not.toContain("pw");
  });

  it("fails when the binding is missing rather than pretending to have saved", async () => {
    capture();
    const err = await subscribe({} as never, "someone@example.com", "api").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Unavailable);
  });
});
