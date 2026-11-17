import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { loadAll } from '../src/ingest.ts';
import { createServer } from '../src/server.ts';
import { shareOfVoice } from '../src/shareOfVoice.ts';
import { getAnswer, saveAnswer } from '../src/store.ts';

const MODELS = ['chatgpt', 'perplexity', 'gemini', 'google_aio', 'google_ai_mode'];
const TASKLANE_RIVALS = ['Taskwyn', 'Sprintmoss', 'Boardhaven', 'Trellova', 'Plandrift', 'Kanbrik'];

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

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
const round3 = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));

test('the response has the shape from the brief', async () => {
  const { status, body } = await get('/brands/tasklane/share-of-voice?days=90');
  assert.equal(status, 200);
  assert.equal(body.brandId, 'tasklane');
  assert.equal(body.days, 90);
  assert.deepEqual(body.competitors, TASKLANE_RIVALS);
  assert.deepEqual(Object.keys(body.byModel), MODELS);
  for (const m of MODELS) assert.deepEqual(Object.keys(body.byModel[m]), ['Tasklane', ...TASKLANE_RIVALS]);
});

test('the competitors are exactly the ones /competitors returns', async () => {
  for (const id of ['tasklane', 'compass', 'barkandbloom']) {
    const list = (await get(`/brands/${id}/competitors`)).body.competitors.map((c: any) => c.name);
    assert.deepEqual((await get(`/brands/${id}/share-of-voice`)).body.competitors, list);
  }
});

test('for each model the shares add up to 1', async () => {
  for (const id of ['tasklane', 'compass', 'barkandbloom', 'fieldnote', 'lumora', 'driftwell', 'nookbox', 'peakmint']) {
    const { body } = await get(`/brands/${id}/share-of-voice?days=90`);
    for (const m of MODELS) assert.ok(Math.abs(sum(body.byModel[m]) - 1) < 1e-9, `${id} ${m} sums to ${sum(body.byModel[m])}`);
  }
});

test('Tasklane on ChatGPT over 90 days matches a count made by hand from the feed', async () => {
  // Expected values come from a separate script over data/feed, not from this code.
  const { body } = await get('/brands/tasklane/share-of-voice?days=90');
  assert.deepEqual(round3(body.byModel.chatgpt), {
    Tasklane: 0.151,
    Taskwyn: 0.155,
    Sprintmoss: 0.147,
    Boardhaven: 0.144,
    Trellova: 0.133,
    Plandrift: 0.126,
    Kanbrik: 0.144,
  });
  // The share is the count over the total of all counts.
  const counts = body.counts.chatgpt;
  assert.equal(body.byModel.chatgpt.Tasklane, counts.Tasklane / sum(counts));
});

test('the default window is 90 days', async () => {
  const { body } = await get('/brands/tasklane/share-of-voice');
  assert.equal(body.days, 90);
  assert.equal(body.from, '2026-08-17');
  assert.equal(body.to, '2026-11-14');
});

test('only answers inside the window are counted', async () => {
  const d90 = (await get('/brands/tasklane/share-of-voice?days=90')).body;
  const d365 = (await get('/brands/tasklane/share-of-voice?days=365')).body; // reaches the July batch
  const d7 = (await get('/brands/tasklane/share-of-voice?days=7')).body;
  assert.ok(sum(d365.counts.chatgpt) > sum(d90.counts.chatgpt));
  assert.ok(sum(d7.counts.chatgpt) < sum(d90.counts.chatgpt));
});

test('when nobody is named the shares are all 0', async () => {
  // Every Fieldnote ChatGPT answer on 10 and 11 November failed, so that model has nothing to count.
  const sov = await shareOfVoice('fieldnote', 2, '2026-11-11');
  assert.ok(sov);
  assert.ok(Object.values(sov.byModel.chatgpt).every((v) => v === 0));
  assert.ok(Math.abs(sum(sov.byModel.gemini) - 1) < 1e-9);
});

test('an answer that names a competitor twice counts once', async () => {
  const before = (await shareOfVoice('tasklane', 90))!.counts.chatgpt;
  const template = getAnswer('r_dc44bd5062834e')!;
  saveAnswer({
    ...template,
    id: 'r_test_twice',
    model: 'chatgpt',
    fetchedAt: '2026-11-14T10:00:00Z',
    day: '2026-11-14',
    ownBrandMentioned: false,
    mentions: [
      { name: 'Kanbrik', domain: 'kanbrik.com', position: 1 },
      { name: 'Kanbrik', domain: 'kanbrik.com', position: 2 },
      { name: 'Reddit', domain: 'reddit.com', position: 3 },
    ],
  });
  const after = (await shareOfVoice('tasklane', 90))!.counts.chatgpt;
  assert.equal(after.Kanbrik, before.Kanbrik + 1);
  assert.equal(after.Tasklane, before.Tasklane);
  assert.equal(sum(after), sum(before) + 1); // Reddit is not a real competitor and adds nothing
});

test('unknown brands and bad days values are rejected', async () => {
  assert.equal((await get('/brands/nope/share-of-voice')).status, 404);
  assert.equal((await get('/brands/tasklane/share-of-voice?days=0')).status, 400);
});
