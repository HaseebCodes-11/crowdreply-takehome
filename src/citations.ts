// Turns the citations the vendor sends into links a client can click.
//
// Three of the five models already send plain https links. The Google ones do not:
//   google_aio  sends links relative to google.com: /url?q=<page>, /goto?url=<page>, /search?q=<query>,
//               and the same wrapper as a full link: https://www.google.com/url?q=<page>
//   gemini      sends opaque redirect links: https://vertexaisearch.cloud.google.com/grounding-api-redirect/<token>
// A relative link shown in our app resolves against our own site and lands on a 404.

import { head } from './lib/http.ts';
import { mapLimit, sleep } from './util.ts';

const GOOGLE = 'https://www.google.com';
const TARGET_PARAMS = ['q', 'url'];
const REDIRECT_HOST = 'vertexaisearch.cloud.google.com';
const REDIRECT_PATH = '/grounding-api-redirect/';
const HEAD_CONCURRENCY = 16;
const HEAD_ATTEMPTS = 3;
const MAX_HOPS = 3;

function parse(link: string, base?: string): URL | null {
  try {
    const url = new URL(link, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

const isGoogleSearchHost = (host: string) => /^(www\.)?google\.[a-z.]+$/.test(host);

export function isRedirectLink(link: string): boolean {
  const url = parse(link);
  return !!url && url.hostname === REDIRECT_HOST && url.pathname.startsWith(REDIRECT_PATH);
}

// The page a Google link points at, or null when it does not point at a page.
// Links that are not Google wrappers come back unchanged.
export function unwrap(link: string, hops = 0): string | null {
  const text = link.trim();
  const relative = text.startsWith('/') && !text.startsWith('//');
  const url = relative ? parse(text, GOOGLE) : parse(text);
  if (!url) return null; // not a link, or a scheme we would never show (javascript:, mailto:)
  if (!relative && !isGoogleSearchHost(url.hostname)) return text;

  // A Google link. /url and /goto wrap the real page in a parameter. Anything else (/search, /maps)
  // is a Google page, not a source the answer cited.
  if (url.pathname !== '/url' && url.pathname !== '/goto') return null;
  for (const param of TARGET_PARAMS) {
    const target = url.searchParams.get(param);
    if (target && parse(target)) return hops < MAX_HOPS ? unwrap(target, hops + 1) : null;
  }
  return null;
}

// Where each redirect link leads. null means the link is dead.
const destinations = new Map<string, string | null>();

async function follow(link: string): Promise<string | null> {
  let current = link;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const res = await headWithRetry(current);
    if (!res) return current; // could not check it: keep the link, it is still a full https link
    if (res.status >= 400) return null; // 404 and friends: the source is gone
    if (res.status < 300 || !res.location) return current; // it serves a page itself
    const next = parse(res.location, current);
    if (!next) return null;
    const page = unwrap(next.href);
    if (!page || !isRedirectLink(page)) return page;
    current = page; // a redirect to another redirect: follow it
  }
  return null;
}

async function headWithRetry(link: string) {
  for (let attempt = 0; attempt < HEAD_ATTEMPTS; attempt++) {
    try {
      const res = await head(link);
      if (res.status < 500) return res;
    } catch {
      // network error: same handling as a 5xx
    }
    await sleep(20 * 2 ** attempt);
  }
  return null;
}

// Looks up where every redirect link in `links` leads, a few at a time, once per link.
// Call this before normalizeCitations() for the same links.
export async function resolveRedirects(links: Iterable<string>): Promise<void> {
  const todo = [...new Set(links)].filter((l) => isRedirectLink(l) && !destinations.has(l));
  const results = await mapLimit(todo, HEAD_CONCURRENCY, follow);
  todo.forEach((link, i) => destinations.set(link, results[i]));
}

// One answer's citations as full links to the cited pages, in the original order, without repeats.
// Google wrappers are opened, search-page links and dead redirect links are dropped.
export function normalizeCitations(raw: string[]): string[] {
  const out: string[] = [];
  for (const link of raw) {
    let page = unwrap(link);
    if (page && destinations.has(page)) page = destinations.get(page) ?? null;
    if (page && !out.includes(page)) out.push(page);
  }
  return out;
}
