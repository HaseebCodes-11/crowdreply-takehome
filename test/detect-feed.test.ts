// Brand detection checked against the real feed.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadAll } from '../src/ingest.ts';
import { visibility } from '../src/metrics.ts';
import { allAnswers, getAnswer } from '../src/store.ts';

before(async () => {
  await loadAll();
});

test('Compass is not credited for the word "compass"', () => {
  // Both answers recommend other CRMs and end with a sentence that uses "compass" as a noun.
  for (const id of ['r_5421763f19a03a', 'r_6d33eefbe25360']) {
    const a = getAnswer(id);
    assert.equal(a?.vendorIsMentioned, true, `${id}: the vendor says mentioned`);
    assert.equal(a?.ownBrandMentioned, false, `${id}: we say not mentioned`);
  }
  // An answer that really lists Compass still counts.
  assert.equal(getAnswer('r_81879a839cfca2')?.ownBrandMentioned, true);
});

test('Bark & Bloom is credited when written "Bark and Bloom" or named by its domain', () => {
  for (const id of ['r_ba4dcde1405aa2', 'r_81f61cfe3c1e34']) {
    const a = getAnswer(id);
    assert.equal(a?.vendorIsMentioned, false, `${id}: the vendor says not mentioned`);
    assert.equal(a?.ownBrandMentioned, true, `${id}: we say mentioned`);
  }
});

test('we disagree with the vendor only where the vendor is wrong', () => {
  const disagreements: Record<string, number> = {};
  for (const a of allAnswers()) {
    if (a.ownBrandMentioned === a.vendorIsMentioned) continue;
    const key = `${a.brandId}: vendor ${a.vendorIsMentioned}, ours ${a.ownBrandMentioned}`;
    disagreements[key] = (disagreements[key] ?? 0) + 1;
  }
  assert.deepEqual(disagreements, {
    'compass: vendor true, ours false': 65,
    'barkandbloom: vendor false, ours true': 55,
  });
});

test('30-day visibility for the two affected brands', () => {
  const compass = visibility('compass', 30, '2026-11-14').overall;
  assert.deepEqual([compass.mentioned, compass.answers], [174, 412]);
  const bark = visibility('barkandbloom', 30, '2026-11-14').overall;
  assert.deepEqual([bark.mentioned, bark.answers], [160, 415]);
});
