# Shared Jeff serving acceptance

One loaded, unchanged Jeff Fast model must serve interactive and bulk HTTP requests on one GPU. Optimize useful completed requests and real input tokens per dollar, reporting end-to-end latency, overload and fairness. No training, reduced precision, truncation, response caching or benchmark tuning.

Before implementation, the consequential failures are: responses assigned to the wrong request; cross-request token contamination; padding/split changes; duplicate tokenization; event-loop blocking; unbounded queued requests or compiler memory; batch starvation; cancelled/expired work still consuming capacity; one malformed request poisoning unrelated requests; GPU OOM; readiness before successful inference; missing authentication; request text/token logging; unreported client lag or errors in load tests; and benchmarks that time a ready batch rather than actual HTTP arrivals.

Acceptance evidence:
- HTTP end-to-end checks for authentication, invalid schemas, context limits, concurrency/mapping, batching, deadlines, overload, metrics and recovery; no request-content logs.
- Collated token IDs, masks, option counts and graft splits exactly match the pinned original preparation for mixed requests.
- Actual HTTP predictions for both complete existing development panels pass the existing native and published-recipe quality gates. Preserve raw output hashes and per-type/proper-loss metrics. No JevBench calls.
- Load test low traffic, saturation, overload, and mixed interactive/bulk traffic. Report offered/achieved rate, success/error counts, p50/p95/p99 by priority, queue/preparation/inference time, batch-size histogram, real tokens/sec and GPU memory. Open-loop arrivals must include client scheduling lag; closed-loop concurrency separately locates the throughput plateau.
- Pin and verify model/code artifacts, preserve attribution, build a portable image/launch recipe, and commit source plus small reproducible evidence summaries. No credentials, weights, private request contents or unrelated application changes in commits.

Initial levers: max batch 1 versus adaptive up to 8; length-aware token budget; short bounded batching wait; aged bulk fairness. CPU encode once, then pad/collate without changing tokens. One dedicated inference thread owns the model. Admission bounds encoding+queued+in-flight work. Graph policy is explicit and evaluated, not silently changed.
