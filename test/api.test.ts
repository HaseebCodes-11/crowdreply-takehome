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
