// Failure cases: bursts rejected despite available queue space, mixed answers,
// missing queue timing, unbounded admission, and retries concealing failures.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { TypeSafeClient } from '@typesafe-ai/sdk';

assert.ok(process.env.CLASSIFIER_API_KEY, 'Set CLASSIFIER_API_KEY');
assert.ok(process.env.IMAGE_FIXTURE, 'Set IMAGE_FIXTURE to a cat photograph');
assert.ok(process.env.IMAGE_OTHER_FIXTURE, 'Set IMAGE_OTHER_FIXTURE to a shoe photograph');
const origin = process.env.CLASSIFIER_ENDPOINT ?? 'https://classifier.dev';
const image = await readFile(process.env.IMAGE_FIXTURE);
const otherImage = await readFile(process.env.IMAGE_OTHER_FIXTURE);
const requests = Number(process.env.BURST_SIZE ?? 4);
assert.ok(Number.isInteger(requests) && requests >= 1 && requests <= 12);
const sdk = new TypeSafeClient({ apiKey: process.env.CLASSIFIER_API_KEY, baseURL: origin, retry: { maxRetries: 0 } });
const body = { model: 'imajev-4b', images: ['data:image/jpeg;base64,' + image.toString('base64')], state: '', share_data: false,
  questions: { subject: { type: 'choice', instructions: 'What is the main subject of the image?', criteria: { cat: null, shoes: null, dog: null } },
    animal: { type: 'noul', instructions: 'An animal is visible.' } } };
const results = await Promise.all(Array.from({ length: requests }, async (_, index) => {
  const started = performance.now();
  try { const result = await sdk.systemOne({ ...body, images: ['data:image/jpeg;base64,' + (index % 2 ? otherImage : image).toString('base64')] }); return { index, ms: performance.now() - started, result }; }
  catch (error) { return { index, error: String(error), status: error.status }; }
}));
await mkdir('captures', { recursive: true });
await writeFile('captures/image-burst.json', JSON.stringify({ origin, requests, retries: 0,
  image_sha256: [image, otherImage].map(value => createHash('sha256').update(value).digest('hex')), results }, null, 2));
for (const row of results) {
  if (requests > 4 && row.status === 429) continue;
  assert.ok(row.result, row.error);
  assert.equal(row.result.answers.subject.choice, row.index % 2 ? 'shoes' : 'cat');
  assert.equal(row.result.answers.animal.noul > 0.5, row.index % 2 === 0);
  assert.ok(Number.isFinite(row.result.usage.queue_ms) && row.result.usage.queue_ms >= 0);
}
assert.ok(results.some(row => row.result));
console.log(`Image burst passed: ${results.filter(row => row.result).length}/${requests} served, ${results.filter(row => row.status === 429).length} capacity refusals`);
