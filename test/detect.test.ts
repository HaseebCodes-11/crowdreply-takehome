import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOwnBrandMentioned } from '../src/detect.ts';

const tasklane = { id: 'tasklane', name: 'Tasklane', domain: 'tasklane.io', category: 'Project management software', description: '' };

test('finds the brand when it is named in the answer', () => {
  assert.equal(isOwnBrandMentioned('1. **Tasklane** (tasklane.io): easy to set up.', tasklane, false), true);
});

test('does not find the brand when it is not named', () => {
  assert.equal(isOwnBrandMentioned('1. **Kanbrik**: good value.', tasklane, false), false);
});

const compass = { id: 'compass', name: 'Compass', domain: 'compasscrm.io', category: 'Sales CRM', description: '' };
const bark = { id: 'barkandbloom', name: 'Bark & Bloom', domain: 'barkandbloom.co', category: 'Pet grooming products', description: '' };
const nook = { id: 'nookbox', name: 'Nook-Box', domain: 'nook-box.com', category: 'Home storage', description: '' };

test('a common noun is not the brand, whatever the vendor says', () => {
  const text = 'A clear ideal customer profile works like a compass for every rep.';
  assert.equal(isOwnBrandMentioned(text, compass, true), false);
  assert.equal(isOwnBrandMentioned('Good forecasting gives the whole team a compass, not just the managers.', compass, true), false);
});

test('the brand is found when written as a name', () => {
  assert.equal(isOwnBrandMentioned('4. **Compass** (compasscrm.io): easy to set up.', compass, false), true);
  assert.equal(isOwnBrandMentioned('Small teams often pick Compass for its pipeline view.', compass, false), true);
  assert.equal(isOwnBrandMentioned('COMPASS is the cheapest option.', compass, false), true);
});

test('the brand is not found inside a longer word', () => {
  assert.equal(isOwnBrandMentioned('Compassion matters in sales. These tools encompass everything.', compass, false), false);
  assert.equal(isOwnBrandMentioned('Tasklanes are swim lanes for tasks.', tasklane, false), false);
});

test('a name with "&" is found however the "&" is written', () => {
  for (const text of ['2. **Bark and Bloom**: a reliable all-rounder.', 'Try Bark & Bloom.', 'Try Bark &amp; Bloom.', 'Try Bark&Bloom.', 'Try BarkandBloom.', "Try Bark 'n' Bloom."]) {
    assert.equal(isOwnBrandMentioned(text, bark, false), true, text);
  }
  assert.equal(isOwnBrandMentioned('The dog will bark and bloom into a happy pet.', bark, false), false);
});

test('a hyphenated name is found with a space or with nothing in between', () => {
  for (const text of ['**Nook-Box** stacks well.', 'Nook Box stacks well.', 'NookBox stacks well.']) {
    assert.equal(isOwnBrandMentioned(text, nook, false), true, text);
  }
});

test('the brand is found by its domain alone, but not by a lookalike domain', () => {
  assert.equal(isOwnBrandMentioned('Many reviewers recommend barkandbloom.co; it is good value.', bark, false), true);
  assert.equal(isOwnBrandMentioned('See https://www.barkandbloom.co/pricing for details.', bark, false), true);
  assert.equal(isOwnBrandMentioned('Many reviewers recommend barkandbloom.com.', bark, false), false);
  assert.equal(isOwnBrandMentioned('Many reviewers recommend notbarkandbloom.co.', bark, false), false);
});

test('empty text mentions nobody', () => {
  assert.equal(isOwnBrandMentioned('', compass, true), false);
});
