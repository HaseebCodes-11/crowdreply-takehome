import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError, checkResponse, loadAll, type IngestStats } from '../src/ingest.ts';
import { allAnswers, answersFor, getAnswer } from '../src/store.ts';

let stats: IngestStats;

before(async () => {
  stats = await loadAll();
});

const valid = {
  id: 'r_test',
  brandId: 'tasklane',
  model: 'chatgpt',
  prompt: 'best project management software',
  fetchedAt: '2026-11-02T09:14:00Z',
  httpStatus: 200,
  text: '1. **Kanbrik**: good value.',
  isMentioned: false,
  mentions: [{ name: 'Kanbrik', domain: 'kanbrik.com', position: 1 }],
  citations: ['https://kanbrik.com/pricing'],
};

const reasonFor = (raw: unknown) => {
  try {
    checkResponse(raw);
  } catch (e) {
    if (e instanceof ValidationError) return e.reason;
    throw e;
  }
  return null;
};

test('an answer is kept when one of its mentions has no domain', () => {
  // r_02ed75293f5602 names Fieldnote, and lists the competitor Margina with domain null.
  const a = getAnswer('r_02ed75293f5602');
  assert.ok(a, 'the answer is stored');
  assert.equal(a.brandId, 'fieldnote');
  const margina = a.mentions.find((m) => m.name === 'Margina');
  assert.ok(margina, 'the mention is kept');
  assert.equal(margina.domain, null);
});

test('nothing in the sample feed is skipped', () => {
  assert.equal(stats.skipped, 0);
  assert.deepEqual(stats.skippedByReason, {});
});

test('an answer the vendor delivers twice is stored and counted once', async () => {
  // r_1abf85aa322bf1 is in 2026-10-18.json and again, byte for byte, in 2026-10-19.json.
  assert.equal(answersFor('compass').filter((a) => a.id === 'r_1abf85aa322bf1').length, 1);
  assert.equal(stats.duplicates, 209);
  assert.equal(stats.conflictingDuplicates, 0);
  assert.equal(stats.saved, 3400);
  assert.equal(allAnswers().length, 3400);
  assert.equal(new Set(allAnswers().map((a) => a.id)).size, 3400);

  await loadAll(); // loading the same feed again must not add anything
  assert.equal(allAnswers().length, 3400);
});

test('a mention without a domain or position is kept, a mention without a name is dropped', () => {
  const raw = checkResponse({ ...valid, mentions: [{ name: 'Perplexity', domain: null }, { domain: 'x.com', position: 2 }, { name: 'Kanbrik', domain: '', position: 3 }] });
  assert.deepEqual(raw.mentions, [
    { name: 'Perplexity', domain: null, position: 1 },
    { name: 'Kanbrik', domain: null, position: 3 },
  ]);
});

test('missing optional parts are filled in instead of losing the answer', () => {
  const { text, mentions, citations, prompt, ...partial } = valid;
  const raw = checkResponse(partial);
  assert.equal(raw.text, '');
  assert.equal(raw.prompt, '');
  assert.deepEqual(raw.mentions, []);
  assert.deepEqual(raw.citations, []);
});

test('an answer that cannot be attributed is rejected with a reason', () => {
  assert.equal(reasonFor(valid), null);
  assert.equal(reasonFor('nope'), 'not_an_object');
  assert.equal(reasonFor({ ...valid, id: '' }), 'missing_id');
  assert.equal(reasonFor({ ...valid, brandId: 'unknown-co' }), 'unknown_brand');
  assert.equal(reasonFor({ ...valid, model: 'bard' }), 'unknown_model');
  assert.equal(reasonFor({ ...valid, fetchedAt: 'yesterday' }), 'bad_fetched_at');
});
