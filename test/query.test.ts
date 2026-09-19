// Run with: npm test
//
// The GET surface has two spellings, /{labels}/{text} and /?labels=&text=,
// and nuqs reads the second. These pin down that both mean the same request,
// that the old flags still work, and that a malformed request is answered with
// a URL that would have worked.
import { describe, it, expect } from "bun:test";
import { hasClassifyQuery, readGet, readQuery, suggest, USAGE } from "../src/query";

const u = (s: string) => new URL(`https://classifier.dev${s}`);
const path = (s: string) => decodeURIComponent(u(s).pathname).replace(/^\/+/, "");
const get = (s: string) => readGet(path(s), u(s));

describe("query form", () => {
  it("reads labels and text from the query string", () => {
    const r = get("/?labels=spam,not+spam&text=Win+a+free+iPhone");
    expect(r.labels).toEqual(["spam", "not spam"]);
    expect(r.text).toBe("Win a free iPhone");
    expect(r.form).toBe("query");
    expect(r.nothing).toBe(false);
  });

  it("reads every option the path form takes, with the documented spellings", () => {
    const r = get("/?labels=a,b&text=x&tier=smart&instructions=judge+the+tone&multi=1&max_labels=3&verbose=1");
    expect(r.tier).toBe("smart");
    expect(r.instructions).toBe("judge the tone");
    expect(r.multi).toEqual({ max: 3 });
    expect(r.verbose).toBe(true);
  });

  it("accepts true/yes/on for flags and max_labels alone implies multi", () => {
    expect(get("/?labels=a,b&text=x&verbose=true").verbose).toBe(true);
    expect(get("/?labels=a,b&text=x&multi=yes").multi).toEqual({ max: undefined });
    expect(get("/?labels=a,b&text=x&max_labels=2").multi).toEqual({ max: 2 });
    expect(get("/?labels=a,b&text=x&multi=0").multi).toBeUndefined();
  });

  it("falls back to defaults on values it cannot read instead of throwing", () => {
    const r = get("/?labels=a,b&text=x&tier=bogus&max_labels=lots");
    expect(r.tier).toBe("fast");
    expect(r.multi).toBeUndefined();
  });

  it("honours the names agents guess", () => {
    expect(get("/?classes=a,b&input=hello").labels).toEqual(["a", "b"]);
    expect(get("/?classes=a,b&input=hello").text).toBe("hello");
    expect(get("/?categories=a,b&q=hello").text).toBe("hello");
    expect(hasClassifyQuery(u("/?q=hi"))).toBe(true);
    expect(hasClassifyQuery(u("/?format=text"))).toBe(false);
  });

  it("lets the canonical name win over an alias", () => {
    expect(readQuery(u("/?text=yes&input=no")).text).toBe("yes");
  });

  it("drops empty labels and trims", () => {
    expect(get("/?labels=a,,+b+,&text=+x+").labels).toEqual(["a", "b"]);
    expect(get("/?labels=a,,+b+,&text=+x+").text).toBe("x");
  });
});

describe("path form", () => {
  it("still works exactly as before", () => {
    const r = get("/spam,not+spam/Win+a+free+iPhone?verbose=1&tier=smart");
    expect(r.labels).toEqual(["spam", "not spam"]);
    expect(r.text).toBe("Win a free iPhone");
    expect(r.tier).toBe("smart");
    expect(r.verbose).toBe(true);
    expect(r.form).toBe("path");
  });

  it("keeps slashes inside the text", () => {
    expect(get("/a,b/one/two/three").text).toBe("one/two/three");
  });

  it("can take its text from the query string", () => {
    const r = get("/spam,not+spam?text=hello");
    expect(r.labels).toEqual(["spam", "not spam"]);
    expect(r.text).toBe("hello");
  });

  it("lets the query string override the path, since it names its fields", () => {
    const r = get("/a,b/old?labels=c,d&text=new");
    expect(r.labels).toEqual(["c", "d"]);
    expect(r.text).toBe("new");
  });

  it("treats a lone segment with no comma and no query as nothing, and a comma as labels missing their text", () => {
    expect(get("/favicon.ico").nothing).toBe(true);
    const r = get("/spam,not+spam");
    expect(r.nothing).toBe(false);
    expect(r.labels).toEqual(["spam", "not spam"]);
    expect(r.text).toBe("");
  });
});

describe("the hint on a malformed request", () => {
  const origin = "https://classifier.dev";

  it("is a URL in the spelling the caller used, keeping what they sent", () => {
    expect(suggest(origin, get("/?labels=spam,not+spam"))).toBe("https://classifier.dev/?labels=spam,not+spam&text=Win+a+free+iPhone");
    expect(suggest(origin, get("/spam,not+spam"))).toBe("https://classifier.dev/spam,not+spam/Win+a+free+iPhone");
    expect(suggest(origin, get("/?text=is+this+spam"))).toBe("https://classifier.dev/?labels=spam,not+spam&text=is+this+spam");
  });

  it("completes a single label with its negation", () => {
    expect(suggest(origin, get("/urgent/server+is+down"))).toBe("https://classifier.dev/urgent,not+urgent/server+is+down");
    expect(suggest(origin, get("/?labels=urgent&text=server+is+down"))).toBe("https://classifier.dev/?labels=urgent,not+urgent&text=server+is+down");
  });

  it("round-trips through the query parser", () => {
    const url = suggest(origin, get("/?labels=a,b&text=100%25+%26+more%3F"));
    const r = get(url.slice(origin.length));
    expect(r.labels).toEqual(["a", "b"]);
    expect(r.text).toBe("100% & more?");
  });

  it("does not echo a very long text back", () => {
    const r = get(`/?labels=a&text=${"x".repeat(500)}`);
    expect(suggest(origin, r)).not.toContain("xxxxx");
  });

  it("names both forms in the usage line", () => {
    expect(USAGE).toContain("/{labels}/{text}");
    expect(USAGE).toContain("?labels=");
  });
});
