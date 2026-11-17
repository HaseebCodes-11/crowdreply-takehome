import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadAll } from '../src/ingest.ts';
import { countedAnswers, visibility, windowStart } from '../src/metrics.ts';

before(async () => {
  await loadAll();
});

test('a window includes both its first and last day', () => {
  assert.equal(windowStart(1, '2026-11-11'), '2026-11-11');
  assert.equal(windowStart(2, '2026-11-11'), '2026-11-10');
  assert.equal(windowStart(30, '2026-11-14'), '2026-10-16');
});

test('answers fetched after the end of the window are not counted', () => {
  // The feed runs to 2026-11-14. With "today" pinned to 2026-11-11, a 2-day window is Nov 10 and Nov 11 only.
  const v = visibility('tasklane', 2, '2026-11-11');
  assert.equal(v.from, '2026-11-10');
  assert.equal(v.to, '2026-11-11');
  const { answers } = countedAnswers('tasklane', 2, '2026-11-11');
  assert.ok(answers.length > 0);
  assert.ok(answers.every((a) => a.day === '2026-11-10' || a.day === '2026-11-11'));
  assert.equal(v.overall.answers, answers.length);
  // 2 days x 3 prompts for each model, at most.
  for (const m of Object.values(v.byModel)) assert.ok(m.answers <= 6, `${m.answers} answers in a 2-day window`);
});
