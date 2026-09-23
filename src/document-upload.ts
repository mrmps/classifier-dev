import { parser, type Token } from "stream-json/web/parser.js";
import { CL100K_TOKEN_SPLIT_REGEX } from "gpt-tokenizer/encodingParams/constants";
import { countContextTokens, LONG_CONTEXT_JOB_MAX_TOKENS, LONG_CONTEXT_MAX_RUN_CHARS, LongContextError } from "./long-context";

export const DOCUMENT_UPLOAD_MAX_BYTES = 100_000_000;
const invalid = (message: string) => new LongContextError(message, 400, "long_context_input");
const tooLarge = () => new LongContextError("A document supports at most 10,000,000 tokens and a 100 MB upload.", 413, "long_context_too_large");
type Save = (index: number, text: string, tokens: number) => Promise<void>;

/** BPE merges stay inside cl100k pre-tokenizer matches. Ending on a complete,
 * non-whitespace match also prevents its end-of-input whitespace rule changing
 * the count. Thus stored fragments sum to the whole document's exact tokens. */
class DocumentBuffer {
  private text = "";
  private runLength = 0;
  private whitespace = false;
  private nonempty = false;
  tokens = 0;
  parts = 0;
  constructor(private readonly save: Save) {}

  async append(value: string) {
    for (const [run] of value.matchAll(/\s+|\S+/g)) {
      const whitespace = /^\s/.test(run);
      this.runLength = whitespace === this.whitespace ? this.runLength + run.length : run.length;
      this.whitespace = whitespace;
      this.nonempty ||= !whitespace;
      if (this.runLength > LONG_CONTEXT_MAX_RUN_CHARS)
        throw invalid("Continuous whitespace or non-whitespace runs must not exceed 8192 UTF-16 code units.");
    }
    this.text += value;
    if (this.text.length >= 131_072) await this.flush(false);
  }

  private boundary(target: number) {
    let end = 0;
    for (const match of this.text.matchAll(new RegExp(CL100K_TOKEN_SPLIT_REGEX))) {
      const next = match.index + match[0].length;
      if (next > target) break;
      if (/\S$/.test(match[0])) end = next;
    }
    if (!end) throw invalid("The document contains an unsupported continuous text run.");
    return end;
  }

  private async flush(final: boolean) {
    while (this.text.length && (final || this.text.length >= 131_072)) {
      let end = final && this.text.length < 131_072 ? this.text.length : this.boundary(98_304);
      let tokens = countContextTokens(this.text.slice(0, end));
      while (tokens > 40_000) {
        end = this.boundary(Math.floor(end * 38_000 / tokens));
        tokens = countContextTokens(this.text.slice(0, end));
      }
      if (this.tokens + tokens > LONG_CONTEXT_JOB_MAX_TOKENS) throw tooLarge();
      await this.save(this.parts++, this.text.slice(0, end), tokens);
      this.tokens += tokens;
      this.text = this.text.slice(end);
    }
  }

  async end() {
    if (!this.nonempty) throw invalid("Provide a nonempty input document.");
    await this.flush(true);
    return { tokens: this.tokens, parts: this.parts };
  }
}

/** Decode bounded network frames, even when a runtime delivers a larger buffer. */
function documentText(request: Request): ReadableStream<string> {
  if (!request.body) throw invalid("Provide an input document.");
  if (Number(request.headers.get("content-length")) > DOCUMENT_UPLOAD_MAX_BYTES) throw tooLarge();
  let bytes = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const reader = request.body.getReader();
  let frame = new Uint8Array(0), offset = 0;
  return new ReadableStream<string>({
    async pull(controller) {
      if (offset === frame.length) {
        const next = await reader.read();
        if (next.done) { controller.enqueue(decoder.decode()); controller.close(); return; }
        frame = next.value; offset = 0;
        bytes += frame.byteLength;
        if (bytes > DOCUMENT_UPLOAD_MAX_BYTES) throw tooLarge();
      }
      const end = Math.min(offset + 16_384, frame.length);
      controller.enqueue(decoder.decode(frame.subarray(offset, end), { stream: true }));
      offset = end;
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

/** Parse one JSON input string without ever materializing that string. Labels
 * and the rubric can appear before or after it, just as with ordinary JSON. */
export async function receiveDocument(request: Request, save: Save) {
  const document = new DocumentBuffer(save);
  const body: Record<string, unknown> = {};
  const source = documentText(request);
  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  if (contentType === "text/plain") {
    const query = new URL(request.url).searchParams;
    body.labels = query.getAll("label");
    if (!(body.labels as string[]).length) body.labels = (query.get("labels") ?? "").split(",");
    if (query.has("instructions")) body.instructions = query.get("instructions");
    if (query.has("multi")) {
      if (!["true", "false"].includes(query.get("multi")!)) throw invalid("multi must be true or false.");
      body.multi = query.get("multi") === "true";
    }
    const reader = source.getReader();
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; await document.append(value); }
    } catch (error) {
      if (error instanceof LongContextError) throw error;
      throw invalid("Send a valid UTF-8 document.");
    } finally { await reader.cancel().catch(() => {}); }
  } else {
    if (contentType && contentType !== "application/json") throw invalid("Use application/json or text/plain.");
    const reader = source.pipeThrough(parser.asWebStream({ packValues: false, streamValues: true })).getReader();
    const seen = new Set<string>();
    let root = false, closed = false, field = "", array = "", string = "", value = "", input = false;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        const token = next.value as Token;
        switch (token.name) {
          case "startObject":
            if (root) throw invalid("Provide a JSON object with one input string and labels.");
            root = true; break;
          case "endObject": closed = true; break;
          case "startKey": string = "key"; value = ""; break;
          case "endKey":
            if (seen.has(value)) throw invalid("Duplicate JSON fields are not allowed.");
            if (!["input", "inputs", "items", "labels", "instructions", "multi", "tier", "model"].includes(value))
              throw invalid(`Unsupported document field: ${value}.`);
            seen.add(value); field = value; string = ""; break;
          case "startArray":
            if (array || !["labels", "inputs", "items"].includes(field)) throw invalid("Provide one input document and a labels array.");
            array = field; if (field === "labels") body.labels = []; break;
          case "endArray": array = ""; field = ""; break;
          case "startString":
            value = "";
            if (field === "input" || array === "inputs" || array === "items") {
              if (input) throw invalid("A document upload accepts exactly one input.");
              input = true; string = "input";
            } else if (array === "labels") string = "label";
            else if (["instructions", "tier", "model"].includes(field)) string = field;
            else throw invalid("Provide a JSON object with one input string and labels.");
            break;
          case "stringChunk":
            if (string === "input") await document.append(token.value);
            else {
              value += token.value;
              const limit = string === "instructions" ? 4000 : string === "label" ? 200 : 32;
              if (value.length > limit) throw invalid("The labels, instructions or field name exceed their limit.");
            }
            break;
          case "endString":
            if (string === "label") {
              (body.labels as string[]).push(value);
              if ((body.labels as string[]).length > 100) throw invalid("Provide at most 100 labels.");
            } else if (string !== "input") body[string] = value;
            string = ""; if (!array) field = ""; break;
          case "trueValue": case "falseValue":
            if (field !== "multi" || array) throw invalid("Only multi accepts a boolean.");
            body.multi = token.value; field = ""; break;
          default: throw invalid("Provide one input string, labels, and optional instructions/multi.");
        }
      }
      if (!root || !closed || !input) throw invalid("Provide a JSON object with one input string and labels.");
      if (body.model !== undefined && body.model !== "jev") throw invalid("Document uploads use the Jev model.");
    } catch (error) {
      if (error instanceof LongContextError) throw error;
      throw invalid("Send valid UTF-8 JSON with one input string and labels.");
    } finally { await reader.cancel().catch(() => {}); }
  }
  return { body, ...await document.end() };
}
