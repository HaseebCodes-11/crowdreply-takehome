import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { isRedirectLink, normalizeCitations, resolveRedirects, unwrap } from '../src/citations.ts';
import { loadAll, type IngestStats } from '../src/ingest.ts';
import { allAnswers, getAnswer } from '../src/store.ts';

let stats: IngestStats;

before(async () => {
  stats = await loadAll();
});

test('a plain link is left alone', () => {
  assert.equal(unwrap('https://kanbrik.com/pricing'), 'https://kanbrik.com/pricing');
  assert.equal(unwrap('https://www.g2.com/categories/sales-crm?order=popular'), 'https://www.g2.com/categories/sales-crm?order=popular');
});

test('Google wrapper links are opened to the page they point at', () => {
  assert.equal(unwrap('/url?q=https%3A%2F%2Frestwave.com%2F&sa=U&ved=2ahUKEwis9OJNma9TloDtW'), 'https://restwave.com/');
  assert.equal(unwrap('/goto?url=https%3A%2F%2Fdozely.com%2Fblog%2Fbest-app-to-improve-sleep&ref=aio'), 'https://dozely.com/blog/best-app-to-improve-sleep');
  assert.equal(unwrap('https://www.google.com/url?q=https%3A%2F%2Fkanbrik.com%2F&sa=U&ved=2ahUKEwiHZrKDVoKTS609B&usg=AOvVaw'), 'https://kanbrik.com/');
  // The wrapped page keeps its own query string, the wrapper's tracking parameters are gone.
  assert.equal(unwrap('/url?q=https%3A%2F%2Fwww.g2.com%2Fcategories%2Fsales-crm%3Forder%3Dpopular&sa=U'), 'https://www.g2.com/categories/sales-crm?order=popular');
});

test('links that are not a cited page are dropped', () => {
  assert.equal(unwrap('/search?q=best%20app%20to%20improve%20sleep&sca_esv=2ahUKEwiCPrQ5dmSEhkVln'), null);
  assert.equal(unwrap('https://www.google.com/search?q=sleep+apps'), null);
  assert.equal(unwrap('/url?sa=U'), null);
  assert.equal(unwrap('/some/relative/page'), null);
  assert.equal(unwrap('javascript:alert(1)'), null);
  assert.equal(unwrap('not a link'), null);
  assert.equal(unwrap(''), null);
});

test('order is kept and repeats are removed', () => {
  assert.deepEqual(normalizeCitations(['https://a.com/', '/url?q=https%3A%2F%2Fb.com%2F', 'https://a.com/', '/goto?url=https%3A%2F%2Fb.com%2F&ref=aio']), ['https://a.com/', 'https://b.com/']);
});

test('a redirect link we know nothing about is kept as it is', async () => {
  const link = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/not-in-the-sample-data';
  assert.equal(isRedirectLink(link), true);
  await resolveRedirects([link]);
  assert.deepEqual(normalizeCitations([link]), [link]);
});

test('the Driftwell Google AI Overview answer gets real links', () => {
  const a = getAnswer('r_2a8e74a45fba7d');
  assert.deepEqual(a?.rawCitations, [
    '/url?q=https%3A%2F%2Frestwave.com%2F&sa=U&ved=2ahUKEwis9OJNma9TloDtW',
    '/goto?url=https%3A%2F%2Fdozely.com%2Fblog%2Fbest-app-to-improve-sleep&ref=aio',
    '/goto?url=https%3A%2F%2Fdriftwell.app%2F&ref=aio',
    '/search?q=best%20app%20to%20improve%20sleep&sca_esv=2ahUKEwiCPrQ5dmSEhkVln',
  ]);
  assert.deepEqual(a?.citations, ['https://restwave.com/', 'https://dozely.com/blog/best-app-to-improve-sleep', 'https://driftwell.app/']);
});

test('a Gemini answer gets the pages behind its redirect links, without the dead one', () => {
  // r_dc44bd5062834e cites two redirect links. The first returns 404.
  const a = getAnswer('r_dc44bd5062834e');
  assert.equal(a?.rawCitations.length, 2);
  assert.equal(a?.citations.length, 1);
  assert.ok(!isRedirectLink(a.citations[0]));
});

test('every stored citation is a full https link to a page outside Google', () => {
  let total = 0;
  for (const a of allAnswers()) {
    for (const c of a.citations) {
      total++;
      assert.match(c, /^https:\/\//, `${a.id}: ${c}`);
      const host = new URL(c).hostname;
      assert.ok(!/(^|\.)google\.com$/.test(host), `${a.id}: ${c}`);
    }
    assert.equal(new Set(a.citations).size, a.citations.length, `${a.id} has no repeated citation`);
  }
  assert.ok(total > 5000, `${total} citations kept`);
  assert.ok(stats.citationsRewritten > 1500, `${stats.citationsRewritten} rewritten`);
  assert.ok(stats.citationsDropped > 300, `${stats.citationsDropped} dropped`);
});
