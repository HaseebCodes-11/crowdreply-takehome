// End to end: starts the real server as its own process (`node src/server.ts`, which is what
// `npm start` runs) and talks to it over HTTP. Every other test file imports the code. This one uses
// only the documented interface: environment variables in, HTTP out.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';

interface Running {
  child: ChildProcess;
  base: string;
  log: string;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

async function start(settings: Record<string, string> = {}): Promise<Running> {
  const port = await freePort();
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.NOW; // the developer's shell must not leak into the test
  delete env.DATA_DIR;
  Object.assign(env, settings, { PORT: String(port) });
  const child = spawn(process.execPath, ['src/server.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const running: Running = { child, base: `http://localhost:${port}`, log: '' };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${running.log}`)), 30_000);
    child.stdout!.on('data', (d) => {
      running.log += d;
      if (running.log.includes('Listening on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr!.on('data', (d) => (running.log += d));
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with code ${code}:\n${running.log}`));
    });
  });
  return running;
}

let live: Running; // default settings: "today" is the newest answer in the feed, 2026-11-14
let pinned: Running; // NOW=2026-11-11, the second day of the ChatGPT outage

before(async () => {
  [live, pinned] = await Promise.all([start(), start({ NOW: '2026-11-11' })]);
});

after(() => {
  live?.child.kill();
  pinned?.child.kill();
});

const call = async (server: Running, path: string, method = 'GET') => {
  const res = await fetch(server.base + path, { method });
  return { status: res.status, type: res.headers.get('content-type'), body: (await res.json()) as any };
};
const get = (path: string) => call(live, path);

const MODELS = ['chatgpt', 'perplexity', 'gemini', 'google_aio', 'google_ai_mode'];
const BRANDS = ['barkandbloom', 'compass', 'driftwell', 'fieldnote', 'lumora', 'nookbox', 'peakmint', 'tasklane'];
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

test('the server starts and reports what ingest did', () => {
  assert.match(live.log, /Loaded 8 brands and 3400 answers \(0 skipped; 209 duplicate deliveries ignored\)/);
  assert.match(live.log, /69 answers are marked failed and not counted/);
  assert.match(live.log, /Citations: 1981 rewritten to the page they point at, 328 dropped/);
});

test('GET /brands lists the eight brands as JSON', async () => {
  const { status, type, body } = await get('/brands');
  assert.equal(status, 200);
  assert.equal(type, 'application/json');
  assert.deepEqual(body.brands.map((b: any) => b.id).sort(), BRANDS);
});

test('answers that used to be dropped are served', async () => {
  const a = await get('/responses/r_02ed75293f5602');
  assert.equal(a.status, 200);
  assert.equal(a.body.ownBrandMentioned, true);
  assert.equal(a.body.mentions.find((m: any) => m.name === 'Margina').domain, null);
  assert.equal((await get('/responses/r_2a8e74a45fba7d')).status, 200);
});

test('no model has more answers than the vendor asked questions', async () => {
  // 28 days of data in the 30-day window, 3 prompts a day: 84 answers per model at most.
  for (const id of BRANDS) {
    const { body } = await get(`/brands/${id}/visibility?days=30`);
    assert.equal(body.from, '2026-10-16');
    assert.equal(body.to, '2026-11-14');
    for (const m of MODELS) assert.ok(body.byModel[m].answers <= 84, `${id} ${m}: ${body.byModel[m].answers}`);
    assert.equal(body.overall.answers, sum(Object.fromEntries(MODELS.map((m) => [m, body.byModel[m].answers]))));
  }
});

test('visibility for the two brands the vendor got wrong', async () => {
  const compass = (await get('/brands/compass/visibility?days=30')).body.overall;
  assert.deepEqual([compass.mentioned, compass.answers], [174, 412]);
  const bark = (await get('/brands/barkandbloom/visibility?days=30')).body.overall;
  assert.deepEqual([bark.mentioned, bark.answers], [160, 415]);
});

test('own-brand detection on the example answers', async () => {
  const noun = (await get('/responses/r_5421763f19a03a')).body; // "works like a compass for every rep"
  assert.deepEqual([noun.ownBrandMentioned, noun.vendorIsMentioned], [false, true]);
  const spelled = (await get('/responses/r_ba4dcde1405aa2')).body; // "Bark and Bloom"
  assert.deepEqual([spelled.ownBrandMentioned, spelled.vendorIsMentioned], [true, false]);
  assert.equal((await get('/responses/r_81f61cfe3c1e34')).body.ownBrandMentioned, true); // barkandbloom.co
});

test('junk answers are failed with a reason', async () => {
  const reasons = { r_991f893225aecc: 'empty_text', r_c75b21627ed4b4: 'refusal', r_7424f93ca93846: 'prompt_echo' };
  for (const [id, reason] of Object.entries(reasons)) {
    const { body } = await get(`/responses/${id}`);
    assert.deepEqual([body.status, body.failureReason], ['failed', reason], id);
  }
  const ok = (await get('/responses/r_81879a839cfca2')).body;
  assert.deepEqual([ok.status, ok.failureReason], ['ok', null]);
});

test('with NOW pinned, the window ends on that day and the outage is "no data"', async () => {
  const { body } = await call(pinned, '/brands/fieldnote/visibility?days=2');
  assert.equal(body.from, '2026-11-10');
  assert.equal(body.to, '2026-11-11');
  assert.deepEqual(body.byModel.chatgpt, { answers: 0, mentioned: 0, visibility: 0 });
  assert.equal(body.overall.answers, 24); // 2 days x 3 prompts x 4 working models
});

test('the competitor list holds real competitors with working domains', async () => {
  const { body } = await get('/brands/tasklane/competitors');
  assert.deepEqual(body, {
    brandId: 'tasklane',
    competitors: [
      { name: 'Taskwyn', domain: 'taskwyn.com', mentions: 218 },
      { name: 'Sprintmoss', domain: 'sprintmoss.app', mentions: 208 },
      { name: 'Boardhaven', domain: 'boardhaven.com', mentions: 206 },
      { name: 'Trellova', domain: 'trellova.com', mentions: 205 },
      { name: 'Plandrift', domain: 'plandrift.io', mentions: 202 },
      { name: 'Kanbrik', domain: 'kanbrik.com', mentions: 194 },
    ],
  });
  const fieldnote = (await get('/brands/fieldnote/competitors')).body.competitors;
  assert.equal(fieldnote.find((c: any) => c.name === 'Inkpond').domain, 'inkpond.com');
});

test('citations are links a client can click', async () => {
  const driftwell = (await get('/responses/r_2a8e74a45fba7d')).body;
  assert.deepEqual(driftwell.citations, ['https://restwave.com/', 'https://dozely.com/blog/best-app-to-improve-sleep', 'https://driftwell.app/']);
  assert.equal(driftwell.rawCitations.length, 4);
  const gemini = (await get('/responses/r_dc44bd5062834e')).body;
  assert.deepEqual(gemini.citations, ['https://www.reddit.com/r/project-management/comments/292055']);
});

test('share of voice for every brand and model', async () => {
  for (const id of BRANDS) {
    const { status, body } = await get(`/brands/${id}/share-of-voice?days=90`);
    assert.equal(status, 200);
    const rivals = (await get(`/brands/${id}/competitors`)).body.competitors.map((c: any) => c.name);
    assert.deepEqual(body.competitors, rivals);
    for (const m of MODELS) assert.ok(Math.abs(sum(body.byModel[m]) - 1) < 1e-9, `${id} ${m}`);
  }
  const tasklane = (await get('/brands/tasklane/share-of-voice')).body;
  assert.equal(tasklane.days, 90);
  assert.equal(Math.round(tasklane.byModel.chatgpt.Tasklane * 1000), 151);
  assert.deepEqual(tasklane.counts.chatgpt, { Tasklane: 42, Taskwyn: 43, Sprintmoss: 41, Boardhaven: 40, Trellova: 37, Plandrift: 35, Kanbrik: 40 });
});

test('bad requests get a clear error and never a 500', async () => {
  for (const bad of ['abc', '0', '-5', '1.5', '366']) {
    for (const route of ['visibility', 'share-of-voice']) {
      const { status, body } = await get(`/brands/tasklane/${route}?days=${bad}`);
      assert.equal(status, 400, `${route}?days=${bad}`);
      assert.equal(body.error, 'days must be a whole number from 1 to 365.');
    }
  }
  assert.equal((await get('/brands/nope/visibility')).status, 404);
  assert.equal((await get('/brands/nope/competitors')).status, 404);
  assert.equal((await get('/brands/nope/share-of-voice')).status, 404);
  assert.equal((await get('/responses/r_does_not_exist')).status, 404);
  assert.equal((await get('/nothing/here')).status, 404);
  assert.equal((await call(live, '/brands', 'POST')).status, 405);
});
