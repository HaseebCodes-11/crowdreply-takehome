import type { Brand } from './types.ts';

interface Matcher {
  name: RegExp | null;
  domain: RegExp | null;
  needsCapital: boolean;
}

const matchers = new Map<string, Matcher>();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}])';

// The brand name as people actually write it. The words must match; what sits between them may vary:
// "Bark & Bloom" is also written "Bark and Bloom", "Nook-Box" may be written "Nook Box".
function nameRegex(name: string): RegExp | null {
  const parts = name.split(/([^\p{L}\p{N}]+)/u);
  const words = parts.filter((_, i) => i % 2 === 0);
  const gaps = parts.filter((_, i) => i % 2 === 1);
  let body = '';
  words.forEach((word, i) => {
    if (!word) return; // the name starts or ends with punctuation
    if (body) {
      const gap = gaps[i - 1] ?? '';
      body += /[&+]/.test(gap) ? "\\s*(?:&amp;|&|\\+|and|'?n'?)\\s*" : '[\\s\\-]*';
    }
    body += escape(word);
  });
  return body ? new RegExp(NOT_WORD_BEFORE + body + NOT_WORD_AFTER, 'giu') : null;
}

// The brand's own domain, as a whole host: "barkandbloom.co" must not match inside "barkandbloom.com".
function domainRegex(domain: string): RegExp | null {
  const host = domain.trim().toLowerCase().replace(/^www\./, '');
  return host ? new RegExp('(?<![\\p{L}\\p{N}-])' + escape(host) + '(?![\\p{L}\\p{N}-])', 'iu') : null;
}

function matcherFor(brand: Brand): Matcher {
  const key = brand.name + '\n' + brand.domain;
  let m = matchers.get(key);
  if (!m) {
    const first = brand.name.trim().charAt(0);
    m = { name: nameRegex(brand.name), domain: domainRegex(brand.domain), needsCapital: first !== first.toLowerCase() };
    matchers.set(key, m);
  }
  return m;
}

// Is the tracked brand named in this answer?
//
// We decide this from the text ourselves. The vendor's flag is a case-insensitive substring match, so it
// says yes to "works like a compass for every rep" for the brand Compass, and no to "Bark and Bloom" for
// the brand Bark & Bloom. It is still passed in so callers do not change, but it is not used.
//
// The brand counts as named when the text contains its domain, or its name as a whole word. A name that
// starts with a capital must be written with one, which is what separates Compass from a compass.
export function isOwnBrandMentioned(text: string, brand: Brand, _vendorSaysMentioned?: boolean): boolean {
  if (!text) return false;
  const m = matcherFor(brand);
  if (m.domain?.test(text)) return true;
  if (!m.name) return false;
  for (const hit of text.matchAll(m.name)) {
    const first = hit[0].charAt(0);
    if (!m.needsCapital || first !== first.toLowerCase()) return true;
  }
  return false;
}
