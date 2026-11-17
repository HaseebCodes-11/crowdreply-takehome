// A brand's real competitors.
//
// The vendor's `mentions` list every name it found in an answer: real competitors, but also platforms
// (Reddit, Amazon, YouTube), the AI engines themselves, and one-off names. Counting them all is not a
// competitor list. We ask the LLM which names sell a competing product, and DNS which domain to show.

import { lookupDomain } from './lib/dns.ts';
import { LlmRateLimitError, classifyCompetitor } from './lib/llm.ts';
import { today } from './metrics.ts';
import { answersFor, getBrand } from './store.ts';
import type { Answer, Brand } from './types.ts';
import { mapLimit, sleep } from './util.ts';

export interface Competitor {
  name: string;
  domain: string | null;
  mentions: number; // answers that name this competitor
}

// Only names that appear in at least this many answers are sent to the LLM. Every call costs a credit.
// In the sample feed real competitors are named in 190+ answers each and one-off names in 7 or fewer,
// so this cuts the calls from about 54 per brand to about 10 without losing a competitor.
export const MIN_ANSWERS_TO_CLASSIFY = 20;

// One LLM call at a time. When the rate limiter trips it rejects every call that is in flight, and a
// rejected call still costs a credit. Four calls in parallel cost 108 credits for all brands; one at a
// time costs 82.
const LLM_CONCURRENCY = 1;
const LLM_RETRIES = 4;
const DNS_RETRIES = 2;

// One verdict per (brand, name), asked once. The promise is cached, so requests that arrive while the
// first one is still waiting share its call instead of paying again.
const verdicts = new Map<string, Promise<boolean>>();

async function askLlm(brand: Brand, name: string): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await classifyCompetitor(brand, name)).isCompetitor;
    } catch (e) {
      if (!(e instanceof LlmRateLimitError) || attempt >= LLM_RETRIES) throw e;
      await sleep(25 * 2 ** attempt); // rate limited: wait a little longer each time
    }
  }
}

function isRealCompetitor(brand: Brand, name: string): Promise<boolean> {
  const key = brand.id + '\n' + name;
  let verdict = verdicts.get(key);
  if (!verdict) {
    verdict = askLlm(brand, name);
    verdicts.set(key, verdict);
    verdict.catch(() => verdicts.delete(key)); // do not cache a failure; the next request tries again
  }
  return verdict;
}

type DomainHealth = 'ok' | 'elsewhere' | 'dead' | 'unknown';

const bare = (host: string) => host.toLowerCase().replace(/^www\./, '');

// 'ok'        resolves and serves its own site
// 'elsewhere' resolves, but sends visitors to a different site (a parked or sold domain)
// 'dead'      does not exist, or has no records
// 'unknown'   the resolver failed. That says nothing about the domain, so it is never treated as dead
const health = new Map<string, DomainHealth>();

async function domainHealth(domain: string): Promise<DomainHealth> {
  const known = health.get(domain);
  if (known) return known;
  let result: DomainHealth = 'unknown';
  for (let attempt = 0; attempt <= DNS_RETRIES && result === 'unknown'; attempt++) {
    try {
      const rec = await lookupDomain(domain);
      if (rec.status === 'nxdomain' || rec.status === 'nodata') result = 'dead';
      else if (rec.status === 'live') result = redirectsAway(domain, rec.redirect) ? 'elsewhere' : 'ok';
    } catch {
      // a resolver error is the same as servfail: try again, then give up as unknown
    }
  }
  if (result !== 'unknown') health.set(domain, result); // a failed lookup is retried on the next request
  return result;
}

function redirectsAway(domain: string, redirect: string | undefined): boolean {
  if (!redirect) return false;
  try {
    const from = bare(domain);
    const to = bare(new URL(redirect).hostname);
    return !(to === from || to.endsWith('.' + from) || from.endsWith('.' + to));
  } catch {
    return false;
  }
}

// The vendor reports more than one domain for some brands (plandrift.io and plandrift.com). Show the
// most-cited one that serves its own site. If none can be confirmed, show the most-cited one we could
// not check. Never show a domain that is dead or parked.
async function pickDomain(domains: Map<string, number>): Promise<string | null> {
  const byUse = [...domains].sort((a, b) => b[1] - a[1]).map(([d]) => d);
  const states = await Promise.all(byUse.map(domainHealth));
  const best = states.indexOf('ok');
  if (best >= 0) return byUse[best];
  const unchecked = states.indexOf('unknown');
  return unchecked >= 0 ? byUse[unchecked] : null;
}

interface Candidate {
  name: string;
  answers: number;
  domains: Map<string, number>;
}

// Every other brand named in these answers, counted once per answer.
function candidates(answers: Answer[]): Candidate[] {
  const byName = new Map<string, Candidate>();
  for (const a of answers) {
    const seen = new Set<string>();
    for (const m of a.mentions) {
      let c = byName.get(m.name);
      if (!c) {
        c = { name: m.name, answers: 0, domains: new Map() };
        byName.set(m.name, c);
      }
      if (!seen.has(m.name)) {
        seen.add(m.name);
        c.answers++;
      }
      if (m.domain) c.domains.set(m.domain, (c.domains.get(m.domain) ?? 0) + 1);
    }
  }
  return [...byName.values()];
}

// A brand's real competitors, most-named first. Only answers we count (not failed, not dated after
// "today") are used. The LLM is asked once per name for the lifetime of the process.
export async function competitors(brandId: string): Promise<Competitor[]> {
  const brand = getBrand(brandId);
  if (!brand) return [];
  const now = today();
  const counted = answersFor(brandId).filter((a) => a.status === 'ok' && a.day <= now);
  const frequent = candidates(counted).filter((c) => c.answers >= MIN_ANSWERS_TO_CLASSIFY);
  const real = await mapLimit(frequent, LLM_CONCURRENCY, (c) => isRealCompetitor(brand, c.name));
  const list = await Promise.all(
    frequent.filter((_, i) => real[i]).map(async (c) => ({ name: c.name, domain: await pickDomain(c.domains), mentions: c.answers })),
  );
  return list.sort((x, y) => y.mentions - x.mentions || x.name.localeCompare(y.name)).slice(0, 10);
}
