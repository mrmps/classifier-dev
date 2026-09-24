import { readDimensions } from "./dimensions";
import { SpendingError } from "./spending/policy";

export const SCRAPE_NANODOLLARS = 2_200_000;
export const SCRAPE_PRICE = SCRAPE_NANODOLLARS / 1e9;
export interface ScrapeOptions { url: string; include: string[] }
export interface Article { url: string; markdown: string; html?: string; title?: string }
export function scrapeOptions(body: Record<string, unknown>): ScrapeOptions | undefined {
  if (!Object.hasOwn(body, "url")) {
    if (Object.hasOwn(body, "include")) throw new SpendingError(400, "invalid_request", "include requires url.");
    return;
  }
  const invalid = (message: string): never => { throw new SpendingError(400, "invalid_request", message); };
  if (["input", "inputs", "items"].some(key => Object.hasOwn(body, key))) invalid("Use url or text inputs, not both.");
  if (typeof body.url !== "string" || body.url.length > 8192) invalid("url must be a complete public HTTP or HTTPS URL, at most 8192 characters.");
  let url: URL;
  try { url = new URL(body.url as string); } catch { return invalid("url must be a complete public HTTP or HTTPS URL."); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      !host.includes(".") || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") ||
      host.includes(":") || /^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host))
    invalid("url must address a public HTTP or HTTPS website without embedded credentials.");
  const include = body.include ?? [];
  if (!Array.isArray(include) || include.some(format => !["markdown", "html"].includes(format))) invalid('include must be an array containing "markdown" and/or "html".');
  if (body.model !== undefined && body.model !== "jev") invalid("URL classification uses model jev.");
  if (body.processing !== undefined) invalid("processing is not supported for URL classification.");
  if (body.tier !== undefined && !["fast", "smart"].includes(String(body.tier))) invalid('tier must be "fast" or "smart".');
  if (body.instructions !== undefined && (typeof body.instructions !== "string" || body.instructions.length > 4000)) invalid("instructions must fit 4000 characters.");
  if (Object.hasOwn(body, "dimensions")) {
    if (["labels", "multi", "max_labels"].some(key => Object.hasOwn(body, key))) invalid("dimensions cannot be combined with labels, multi or max_labels.");
    try { readDimensions(body.dimensions); } catch { invalid("Provide valid classification dimensions."); }
  } else {
    const labels = body.labels;
    if (!Array.isArray(labels) || labels.length < 2 || labels.length > 100 || labels.some(label => typeof label !== "string" || !label.trim() || label.length > 200) || new Set(labels).size !== labels.length)
      invalid("Provide 2–100 distinct nonempty labels, at most 200 characters each.");
  }
  return { url: url.href, include: include as string[] };
}

export async function scrapeArticle(options: ScrapeOptions, key: string, signal: AbortSignal,
  billed: (charged: boolean) => void): Promise<Article> {
  const endpoint = new URL("https://api.context.dev/v1/web/scrape/markdown");
  endpoint.searchParams.set("url", options.url);
  endpoint.searchParams.set("useMainContentOnly", "true");
  endpoint.searchParams.set("includeHTML", String(options.include.includes("html")));
  endpoint.searchParams.set("pdf[ocr]", "false");
  endpoint.searchParams.set("timeoutOpts[milliseconds]", "45000");
  endpoint.searchParams.set("timeoutOpts[behavior]", "fail");
  // A lost response can still incur provider cost. Keep the bounded charge unless
  // the provider explicitly confirms it did not bill this attempt; never retry.
  if (signal.aborted) throw new SpendingError(400, "invalid_request", "The request was cancelled before scraping.");
  billed(true);
  try {
    const response = await fetch(endpoint, { headers: { authorization: `Bearer ${key}` }, redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(50000)]) });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8_000_000) { await reader.cancel(); throw new SpendingError(413, "scrape_too_large", "The scraped response exceeds 8 MB."); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (data?.key_metadata?.credits_consumed === 0) billed(false);
    if (!response.ok || data?.success !== true) throw new SpendingError(response.status === 429 ? 503 : 422, "scrape_failed", "Context.dev could not retrieve this URL. The page may be unavailable, blocked, or require a login.");
    if (typeof data.markdown !== "string" || !data.markdown.trim()) throw new SpendingError(422, "scrape_empty", "The URL returned no readable article text.");
    if (options.include.includes("html") && typeof data.html !== "string") throw new SpendingError(502, "scrape_failed", "Context.dev did not return the requested HTML.");
    return { url: options.url, markdown: data.markdown,
      ...(options.include.includes("html") ? { html: data.html } : {}),
      ...(typeof data.metadata?.title === "string" ? { title: data.metadata.title } : {}) };
  } catch (error) {
    if (error instanceof SpendingError) throw error;
    throw new SpendingError(502, "scrape_failed", "The scrape did not complete. Check pricing before retrying; a dispatched request may have incurred a scrape charge.");
  }
}
