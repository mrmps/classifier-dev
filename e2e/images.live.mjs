import assert from 'node:assert/strict';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const origin = process.env.CLASSIFIER_ENDPOINT ?? 'https://classifier.dev';
const key = process.env.CLASSIFIER_API_KEY;
assert.ok(key, 'Set CLASSIFIER_API_KEY');
assert.ok(process.env.IMAGE_FIXTURE, 'Set IMAGE_FIXTURE to a JPEG photograph of a cat');
const image = `data:image/jpeg;base64,${(await readFile(process.env.IMAGE_FIXTURE)).toString('base64')}`;
const body = { model: 'imajev-4b', images: [image], state: '', share_data: false,
  questions: { subject: { type: 'choice', instructions: 'What animal is visible?', criteria: { cat: null, dog: null, horse: null } } } };
const evidence = [];
async function send(name, payload, expected, token = key) {
  const start = performance.now();
  const response = await fetch(`${origin}/v1/systemone`, { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json();
  evidence.push({ name, status: response.status, ms: performance.now() - start, result,
    billing: response.headers.get('x-billing-status'), timing: response.headers.get('server-timing') });
  assert.ok(expected.includes(response.status), `${name}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}
try {
  const result = await send('image decision', body, [200]);
  assert.equal(result.model, 'imajev-4b');
  assert.equal(result.answers.subject.choice, 'cat');
  assert.ok(result.usage.input_tokens > 0);
  assert.equal(result.usage.output_tokens, 0);
  assert.ok(Number.isFinite(result.answers.subject.unknown_probability));
  assert.equal(typeof result.answers.subject.abstained, 'boolean');
  const types = await send('typed questions', { ...body, questions: {
    ...body.questions,
    animal: { type: 'noul', instructions: 'An animal is visible in the photograph.' },
    count: { type: 'score', instructions: 'How many cats are visible?', criteria: ['zero', 'one', 'two or more'] },
  } }, [200]);
  assert.ok(types.answers.animal.noul > 0.5);
  assert.ok(types.answers.count.score >= 0 && types.answers.count.score <= 2);
  assert.ok(types.usage.input_tokens > result.usage.input_tokens);
  const sdk = new TypeSafeClient({ apiKey: key, baseURL: origin, retry: { maxRetries: 0 } });
  const sdkStarted = performance.now();
  const sdkResult = await sdk.systemOne(body);
  assert.equal(sdkResult.answers.subject.choice, 'cat');
  assert.equal(sdkResult.model, 'imajev-4b');
  evidence.push({ name: 'TypeSafe SDK image request', ms: performance.now() - sdkStarted, result: sdkResult });
  await send('invalid credential', body, [401, 403], 'classifier_agent_invalid');
  await send('invalid image', { ...body, images: ['data:image/jpeg;base64,AAAA'] }, [400, 422]);
  await send('remote URL refused', { ...body, images: ['http://127.0.0.1/private'] }, [400, 422]);
  await send('too many images', { ...body, images: [image, image, image] }, [400, 422]);
  await send('empty images', { ...body, images: [] }, [400, 422]);
  await send('oversized request', { ...body, state: 'x'.repeat(1_000_001) }, [413]);
  await send('retired model', { ...body, model: 'dgemma' }, [400, 422]);
  console.log(`Passed ${evidence.length} live image checks`);
} finally {
  await mkdir('captures', { recursive: true });
  await writeFile('captures/images-e2e.json', JSON.stringify({ origin, evidence }, null, 2));
}
