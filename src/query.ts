// The GET surface has two spellings of the same request. The path form is the
// one people type: /spam,not+spam/Win+a+free+iPhone. The query form is the one
// URL-state libraries emit: /?labels=spam,not+spam&text=Win+a+free+iPhone.
// nuqs owns the query form: one parser map reads it, and the same map
// serialises the URL we suggest back when a request is missing something, so
// the hint in an error is always a URL that would have worked.
import {
  createLoader,
  createParser,
  createSerializer,
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  type inferParserType,
} from "nuqs/server";

// The documented flags are ?verbose=1 and ?multi=1; nuqs's own boolean parser
// only reads "true", so this one keeps the old spelling and the obvious others.
const flag = createParser<boolean>({
  parse: (v) => /^(1|true|yes|on)$/i.test(v),
  serialize: (v) => (v ? "1" : "0"),
});

export const classifyQuery = {
  labels: parseAsArrayOf(parseAsString, ","),
  text: parseAsString,
  tier: parseAsStringLiteral(["fast", "smart"] as const).withDefault("fast"),
  instructions: parseAsString,
  multi: flag.withDefault(false),
  max_labels: parseAsInteger,
  verbose: flag.withDefault(false),
};
export type ClassifyQuery = inferParserType<typeof classifyQuery>;

const load = createLoader(classifyQuery);
const serialize = createSerializer(classifyQuery);

// Names an agent guesses before reading the docs. classifier.dev sorted the
// candidates itself (labels: "the text to classify" / "the list of categories"
// / "neither"); these are the ones it was confident about, plus q, which every
// search box on the web has trained people to try.
const ALIASES: Record<"text" | "labels", string[]> = {
  text: ["input", "content", "message", "body", "sentence", "query", "q"],
  labels: ["label", "classes", "categories", "options"],
};

/** Read the query string, honouring the aliases. Unknown values fall back to defaults rather than throwing. */
export function readQuery(url: URL): ClassifyQuery {
  const params = new URLSearchParams(url.search);
  for (const [canonical, names] of Object.entries(ALIASES)) {
    if (params.has(canonical)) continue;
    const hit = names.find((n) => params.has(n));
    if (hit) params.set(canonical, params.get(hit) ?? "");
  }
  return load(params);
}

/** True when the query string carries the request itself, not just options. */
export function hasClassifyQuery(url: URL): boolean {
  const p = url.searchParams;
  return ["text", "labels", ...ALIASES.text, ...ALIASES.labels].some((k) => p.has(k));
}

const plus = (s: string) => s.replace(/\+/g, " ").trim();
const splitLabels = (s: string) => s.split(",").map(plus).filter(Boolean);

export type GetRequest = {
  labels: string[];
  text: string;
  tier: "fast" | "smart";
  instructions?: string;
  multi?: { max?: number };
  verbose: boolean;
  /** Which spelling the caller used; the usage hint mirrors it. */
  form: "path" | "query";
  /** Nothing here reads as a classification request: a single segment with no comma and no query. */
  nothing: boolean;
};

/**
 * Merge both spellings into one request. The query string wins where both say
 * something, since it names its fields; the path fills whatever it left out,
 * so /spam,not+spam?text=hi and /?labels=spam,not+spam&text=hi are the same call.
 */
export function readGet(path: string, url: URL): GetRequest {
  const q = readQuery(url);
  const slash = path.indexOf("/");
  const pathLabels = splitLabels(slash > 0 ? path.slice(0, slash) : path);
  const pathText = slash > 0 ? plus(path.slice(slash + 1)) : "";
  const fromQuery = hasClassifyQuery(url);
  const labels = q.labels ? q.labels.map((l) => l.trim()).filter(Boolean) : pathLabels;
  const text = q.text !== null ? q.text.trim() : pathText;
  const max = q.max_labels && q.max_labels > 0 ? q.max_labels : undefined;
  return {
    labels,
    text,
    tier: q.tier,
    instructions: q.instructions ?? undefined,
    multi: q.multi || max ? { max } : undefined,
    verbose: q.verbose,
    form: fromQuery ? "query" : "path",
    nothing: !fromQuery && slash <= 0 && !path.includes(","),
  };
}

export const USAGE = "GET /{labels}/{text}  or  GET /?labels={a,b}&text={text}";

const pathSegment = (s: string) => encodeURIComponent(s).replace(/%20/g, "+").replace(/%2C/g, ",");

/**
 * A URL that would have worked, built from what the caller sent. Missing
 * pieces are filled with the same example the docs use, so the hint is
 * runnable as-is and obviously an example where it had to guess.
 */
export function suggest(origin: string, req: Pick<GetRequest, "labels" | "text" | "form">): string {
  let labels = [...new Set(req.labels.filter(Boolean))];
  if (labels.length === 0) labels = ["spam", "not spam"];
  else if (labels.length === 1) labels = [labels[0], `not ${labels[0]}`];
  const text = req.text.length > 0 && req.text.length <= 200 ? req.text : "Win a free iPhone";
  if (req.form === "query") return serialize(`${origin}/`, { labels, text });
  return `${origin}/${pathSegment(labels.join(","))}/${pathSegment(text)}`;
}
