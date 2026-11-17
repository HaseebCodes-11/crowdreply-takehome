import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { loadAll } from '../src/ingest.ts';
import { createServer } from '../src/server.ts';

let server: Server;
let base = '';

before(async () => {
  await loadAll();
  server = createServer();
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

const get = async (p: string) => {
  const res = await fetch(base + p);
  return { status: res.status, body: (await res.json()) as any };
};

test('lists the tracked brands', async () => {
  const { status, body } = await get('/brands');
  assert.equal(status, 200);
  assert.deepEqual(body.brands.map((b: any) => b.id).sort(), ['barkandbloom', 'compass', 'driftwell', 'fieldnote', 'lumora', 'nookbox', 'peakmint', 'tasklane']);
});

test('visibility has a number between 0 and 1 for every model', async () => {
  const { body } = await get('/brands/tasklane/visibility?days=30');
  for (const m of ['chatgpt', 'perplexity', 'gemini', 'google_aio', 'google_ai_mode']) {
    assert.ok(body.byModel[m].answers > 0, `${m} has answers`);
    assert.ok(body.byModel[m].visibility >= 0 && body.byModel[m].visibility <= 1);
  }
});

test('visibility only counts answers inside the window', async () => {
  const short = (await get('/brands/tasklane/visibility?days=7')).body;
  const long = (await get('/brands/tasklane/visibility?days=30')).body;
  assert.ok(short.overall.answers < long.overall.answers);
});

test('competitors never include the brand itself', async () => {
  const { body } = await get('/brands/tasklane/competitors');
  assert.ok(body.competitors.length > 0);
  assert.ok(!body.competitors.some((c: any) => c.name === 'Tasklane'));
});

test('a single answer can be fetched by id', async () => {
  const { body: vis } = await get('/brands/fieldnote/visibility?days=30');
  assert.ok(vis.overall.answers > 0);
  const { status } = await get('/responses/does-not-exist');
  assert.equal(status, 404);
});

test('unknown brands return 404', async () => {
  assert.equal((await get('/brands/nope/visibility')).status, 404);
});

test('a days value that is not a whole number from 1 to 365 is rejected', async () => {
  for (const bad of ['abc', '0', '-5', '1.5', '366', '', '7days', '1e2']) {
    const { status, body } = await get(`/brands/tasklane/visibility?days=${bad}`);
    assert.equal(status, 400, `days=${bad}`);
    assert.equal(body.error, 'days must be a whole number from 1 to 365.');
  }
});

test('valid days values still work, and the default is 30', async () => {
  assert.equal((await get('/brands/tasklane/visibility?days=1')).body.days, 1);
  assert.equal((await get('/brands/tasklane/visibility?days=365')).body.days, 365);
  const byDefault = (await get('/brands/tasklane/visibility')).body;
  assert.equal(byDefault.days, 30);
  assert.equal(byDefault.from, '2026-10-16');
  assert.equal(byDefault.to, '2026-11-14');
});

test('a stored answer carries the fields the README documents, plus the added ones', async () => {
  const { status, body } = await get('/responses/r_81879a839cfca2');
  assert.equal(status, 200);
  for (const key of ['id', 'brandId', 'model', 'prompt', 'fetchedAt', 'day', 'status', 'text', 'ownBrandMentioned', 'mentions', 'citations']) {
    assert.ok(key in body, `${key} is present`);
  }
  for (const key of ['failureReason', 'vendorIsMentioned', 'rawCitations']) assert.ok(key in body, `${key} is added`);
  assert.equal(body.status, 'ok');
  assert.ok(!body.mentions.some((m: any) => m.name === 'Compass'), 'mentions list other brands only');
});
