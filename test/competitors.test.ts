import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { competitors } from '../src/competitors.ts';
import { loadAll } from '../src/ingest.ts';
import { llmUsage } from '../src/lib/llm.ts';
import { listBrands } from '../src/store.ts';

before(async () => {
  await loadAll();
});

// The tests in this file run in order and share the LLM call counter.

test('Tasklane competitors are the six real ones, with a live domain each', async () => {
  const list = await competitors('tasklane');
  assert.deepEqual(list, [
    { name: 'Taskwyn', domain: 'taskwyn.com', mentions: 218 },
    { name: 'Sprintmoss', domain: 'sprintmoss.app', mentions: 208 }, // not sprintmoss.com, which is parked
    { name: 'Boardhaven', domain: 'boardhaven.com', mentions: 206 },
    { name: 'Trellova', domain: 'trellova.com', mentions: 205 },
    { name: 'Plandrift', domain: 'plandrift.io', mentions: 202 }, // not plandrift.com, which does not exist
    { name: 'Kanbrik', domain: 'kanbrik.com', mentions: 194 },
  ]);
  for (const platform of ['Reddit', 'Amazon', 'Zoom', 'Slack', 'YouTube', 'G2', 'Capterra', 'Google']) {
    assert.ok(!list.some((c) => c.name === platform), `${platform} is not a competitor`);
  }
});

test('the LLM is only asked about names that appear often, and survives rate limits', () => {
  // Tasklane has 55 candidate names. 15 appear in 20 or more answers. The stand-in rate-limits every
  // 13th call, so exactly one retry is expected on top.
  assert.equal(llmUsage().calls, 16);
});

test('asking again costs nothing', async () => {
  const before = llmUsage().calls;
  await competitors('tasklane');
  await Promise.all([competitors('tasklane'), competitors('tasklane')]);
  assert.equal(llmUsage().calls, before);
});

test('a competitor whose only domain fails DNS is kept', async () => {
  // inkpond.com returns servfail. That is a resolver problem, not proof the domain is gone.
  const inkpond = (await competitors('fieldnote')).find((c) => c.name === 'Inkpond');
  assert.ok(inkpond, 'Inkpond is still listed');
  assert.equal(inkpond.domain, 'inkpond.com');
});

test('a dead domain is never shown', async () => {
  // The vendor reports both pipewell.io and pipewellhq.com. The second does not exist.
  const pipewell = (await competitors('compass')).find((c) => c.name === 'Pipewell');
  assert.equal(pipewell?.domain, 'pipewell.io');
});

test('every brand gets five or six real competitors for under ninety credits in total', async () => {
  for (const b of listBrands()) {
    const list = await competitors(b.id);
    assert.ok(list.length === 5 || list.length === 6, `${b.id} has ${list.length} competitors`);
    assert.ok(!list.some((c) => c.name === b.name), `${b.id} is not its own competitor`);
    assert.ok(list.every((c) => c.mentions >= 190), `${b.id} competitors are all named often`);
  }
  // 76 names across the eight brands, plus one retry for every 13th call. Classifying every name
  // the vendor ever listed would be 429 names.
  assert.ok(llmUsage().calls < 90, `${llmUsage().calls} LLM calls for all eight brands`);
});

test('an unknown brand has no competitors', async () => {
  assert.deepEqual(await competitors('nope'), []);
});
