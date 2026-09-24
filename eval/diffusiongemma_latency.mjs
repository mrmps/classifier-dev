// node --env-file=.dev.vars eval/diffusiongemma_latency.mjs
// Direct HTTP, one request in flight, alternating service order, no retries.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const samples = Number(process.env.BENCH_SAMPLES || 20);
assert.ok(Number.isInteger(samples) && samples > 0);
const services = [
  { name: 'TypeSafe Jev', url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0', key: process.env.TYPESAFE_API_KEY },
  { name: 'Existing DiffusionGemma (classifier.dev)', url: 'https://classifier.dev/v1/systemone', model: 'dgemma', key: 'unused' },
  { name: 'Beam DiffusionGemma', url: 'https://app.beam.cloud/v1/systemone', model: 'jev/diffusiongemma', key: process.env.BEAM_API_KEY },
];
for (const service of services) assert.ok(service.key, `${service.name} credential is required`);
const criteria = { billing: null, technical: null, sales: null, feedback: null };
const tickets = [
  ['Please refund the duplicate charge on my invoice.', 'billing'],
  ['The application crashes whenever I open the settings page.', 'technical'],
  ['Please send a quote for 500 enterprise seats.', 'sales'],
  ['I love the new design. Thank you for making it easier to use!', 'feedback'],
];
const category = (instructions) => ({ type: 'choice', instructions, criteria });
const image = 'data:image/png;base64,' + (await readFile('captures/diffusiongemma-red.png')).toString('base64');
const workloads = [
  { name: 'single_text', state: tickets[0][0], questions: { category: category('Which team should handle this ticket?') }, expected: { category: 'billing' } },
  { name: 'batch_16', state: Array.from({ length: 16 }, (_, i) => ({ id: `i${i}`, text: tickets[i % 4][0] })),
    questions: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`i${i}`, category(`Which team should handle item i${i}?`)])),
    expected: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`i${i}`, tickets[i % 4][1]])) },
  { name: 'long_text', state: { background: 'The company offers software subscriptions, product documentation, and customer assistance. '.repeat(100), ticket: tickets[0][0] },
    questions: { category: category('Which team should handle the ticket? The background is context, not the ticket.') }, expected: { category: 'billing' } },
  { name: 'image_3_decisions', state: 'Look at the attached image.', images: [image], questions: {
    color: { type: 'choice', instructions: 'What color is the image?', criteria: { red: null, blue: null, green: null } },
    red: { type: 'noul', instructions: 'Is the image red?' },
    intensity: { type: 'score', instructions: 'How red is the image?', criteria: ['Not red', 'Some red', 'Entirely red'] },
  }, expected: { color: 'red' } },
];
const report = { startedAt: new Date().toISOString(), runtime: process.version,
  protocol: { samplesPerWorkload: samples, warmupsPerServiceAndWorkload: 2, concurrency: 1, retries: 0,
    order: 'alternate service order every round; same state/questions for both services',
    percentiles: 'Median averages the two middle observations; p95 uses nearest rank',
    latency: 'client end-to-end milliseconds including network, headers and complete JSON response; persistent Node fetch connections',
    limitations: 'Same client, not co-located servers. Existing DiffusionGemma includes classifier.dev proxy overhead; TypeSafe and Beam use direct provider URLs. First request is not a verified cold start. Different models and tokenizers. Small synthetic correctness sanity check, not an accuracy or calibration benchmark. Image workload runs on both DiffusionGemma services; Jev is text-only.' },
  workloads: workloads.map(({ name, state, questions, images }) => ({ name, stateCharacters: JSON.stringify(state).length, decisions: Object.keys(questions).length, images: images?.length ?? 0 })),
  rows: [], summaries: [] };
const artifact = 'captures/diffusiongemma-latency.json';
await mkdir('captures', { recursive: true });
async function save() { await writeFile(artifact, JSON.stringify(report, null, 2)); }
async function call(service, work, round, warmup) {
  const body = JSON.stringify({ model: service.model, state: work.state, questions: work.questions, ...(work.images ? { images: work.images } : {}) });
  const start = performance.now();
  const row = { service: service.name, workload: work.name, round, warmup, at: new Date().toISOString(), requestBytes: Buffer.byteLength(body) };
  try {
    const response = await fetch(service.url, { method: 'POST', headers: { authorization: `Bearer ${service.key}`, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(65000) });
    row.headersMs = performance.now() - start;
    const text = await response.text();
    row.totalMs = performance.now() - start;
    row.status = response.status;
    const payload = JSON.parse(text);
    row.model = payload.model;
    row.usage = payload.usage;
    row.providerTiming = payload.diagnostics?.timing;
    row.valid = response.ok && payload.model === service.model && Object.keys(work.questions).every(id => payload.answers?.[id]?.type === work.questions[id].type);
    if (row.valid) {
      row.correct = Object.entries(work.expected).filter(([id, choice]) => payload.answers[id].choice === choice).length;
      row.decisionsChecked = Object.keys(work.expected).length;
      row.answers = payload.answers;
    } else row.error = payload.detail ?? payload.error ?? 'invalid response';
  } catch (error) { row.totalMs = performance.now() - start; row.valid = false; row.error = error.name; }
  report.rows.push(row);
  await save();
  console.log(`${warmup ? 'warmup' : 'sample'} ${work.name} ${service.name} ${round + 1}: ${row.status ?? row.error} ${Math.round(row.totalMs)}ms`);
  return row;
}
const applicable = (work) => services.filter(service => !work.images || service.model !== 'jev-1.13.0');
for (const work of workloads) for (const service of applicable(work)) for (let i = 0; i < 2; i++) {
  const row = await call(service, work, i, true);
  if (!row.valid) throw new Error(`${service.name} cannot run ${work.name}; see ${artifact}`);
}
for (let round = 0; round < samples; round++) for (const work of workloads) {
  const order = applicable(work);
  if (round % 2) order.reverse();
  for (const service of order) await call(service, work, round, false);
}
const percentile = (values, q) => q === .5 && values.length % 2 === 0
  ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
  : values[Math.max(0, Math.ceil(values.length * q) - 1)];
for (const work of workloads) for (const service of applicable(work)) {
  const all = report.rows.filter(r => !r.warmup && r.service === service.name && r.workload === work.name);
  const rows = all.filter(r => r.valid), times = rows.map(r => r.totalMs).sort((a, b) => a - b);
  report.summaries.push({ service: service.name, workload: work.name, requests: all.length, successful: rows.length,
    medianMs: percentile(times, .5), p95Ms: percentile(times, .95), minMs: times[0], maxMs: times.at(-1),
    meanMs: times.reduce((a, b) => a + b, 0) / times.length,
    medianInputTokens: percentile(rows.map(r => r.usage.input_tokens).sort((a, b) => a - b), .5),
    correct: rows.reduce((n, r) => n + r.correct, 0), checked: rows.reduce((n, r) => n + r.decisionsChecked, 0),
  });
}
report.finishedAt = new Date().toISOString();
await save();
console.table(report.summaries);
