/** What each reason code means, in the words the caller would use. */
const REASON_TEXT: Record<string, string> = {
  bad_json: "body was not valid JSON",
  no_input: "no text to classify",
  too_many_inputs: "over 1,000 inputs",
  too_few_labels: "fewer than 2 labels",
  too_many_labels: "over 100 labels",
  empty_label: "a label was empty or not a string",
  duplicate_labels: "labels were not distinct",
  empty_input: "an input was empty or not a string",
  input_too_long: "an input was over 32,000 characters",
  rate_limit_minute: "per-minute rate limit",
  rate_limit_day: "daily rate limit",
  bad_dimensions: "invalid dimension definitions or conflicting options",
  too_many_decisions: "too many item × dimension decisions",
  dimension_context_too_large: "input and dimension exceed the model context",
  chain_exhausted: "every model in the chain failed",
  batch_unavailable: "batch too large for the LLM fallback",
  timeout: "upstream timed out",
  upstream_other: "other upstream failure",
};
export const reasonText = (r: string) =>
  REASON_TEXT[r] ??
  (r.startsWith("typesafe_") ? `TypeSafe returned ${r.slice(9)}` : r);
