import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { failureReason } from '../src/failure.ts';
import { loadAll, type IngestStats } from '../src/ingest.ts';
import { visibility } from '../src/metrics.ts';
import { allAnswers, getAnswer } from '../src/store.ts';

let stats: IngestStats;

before(async () => {
  stats = await loadAll();
});

const prompt = 'best note taking app for user research';

test('a real answer is not a failure, even when it names no brand', () => {
  assert.equal(failureReason({ httpStatus: 200, prompt, text: '1. **Quillbase**: good value.' }), null);
  assert.equal(failureReason({ httpStatus: 200, prompt, text: 'There is no clear leader in this category yet.' }), null);
});

test('an error status, empty text, an echoed prompt and the refusal are failures', () => {
  assert.equal(failureReason({ httpStatus: 503, prompt, text: '1. **Quillbase**: good value.' }), 'http_error');
  assert.equal(failureReason({ httpStatus: 200, prompt, text: '' }), 'empty_text');
  assert.equal(failureReason({ httpStatus: 200, prompt, text: '  \n ' }), 'empty_text');
  assert.equal(failureReason({ httpStatus: 200, prompt, text: ' Best note taking app for user research ' }), 'prompt_echo');
  assert.equal(failureReason({ httpStatus: 200, prompt, text: "I don't have search results for that query right now." }), 'refusal');
});

test('the junk ChatGPT answers of 10 and 11 November are stored as failed', () => {
  assert.equal(getAnswer('r_991f893225aecc')?.status, 'failed');
  assert.equal(getAnswer('r_991f893225aecc')?.failureReason, 'empty_text');
  assert.equal(getAnswer('r_c75b21627ed4b4')?.failureReason, 'refusal');
  assert.equal(getAnswer('r_7424f93ca93846')?.failureReason, 'prompt_echo');
});

test('healthy answers stay ok', () => {
  const a = getAnswer('r_81879a839cfca2');
  assert.equal(a?.status, 'ok');
  assert.equal(a?.failureReason, null);
});

test('69 answers in the sample feed are failed, and none of them carries any content', () => {
  assert.equal(stats.failed, 69);
  assert.deepEqual(stats.failedByReason, { empty_text: 10, refusal: 23, prompt_echo: 36 });
  const failed = allAnswers().filter((a) => a.status === 'failed');
  assert.equal(failed.length, 69);
  assert.ok(failed.every((a) => a.mentions.length === 0 && a.citations.length === 0));
});

test('failed answers are left out of visibility instead of counting as misses', () => {
  // All six Fieldnote ChatGPT answers on these two days were junk. That is "no data", not 0% visibility.
  const v = visibility('fieldnote', 2, '2026-11-11');
  assert.deepEqual(v.byModel.chatgpt, { answers: 0, mentioned: 0, visibility: 0 });
  assert.ok(v.byModel.gemini.answers > 0);
});
