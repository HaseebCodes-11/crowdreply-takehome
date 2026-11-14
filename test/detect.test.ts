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
