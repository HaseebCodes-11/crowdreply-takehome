import http from 'node:http';
import { PORT } from './config.ts';
import { describeStats, loadAll } from './ingest.ts';
import { competitors } from './competitors.ts';
import { visibility } from './metrics.ts';
import { shareOfVoice } from './shareOfVoice.ts';
import { getAnswer, getBrand, listBrands } from './store.ts';

type Handler = (params: string[], query: URLSearchParams) => unknown | Promise<unknown>;

class NotFound extends Error {}
class BadRequest extends Error {}

const MAX_DAYS = 365;

// The `days` query parameter: a whole number of days from 1 to 365. Left out, it is `fallback`.
// Anything else is the caller's mistake and gets a 400, not a window nobody asked for.
function daysParam(q: URLSearchParams, fallback: number): number {
  const raw = q.get('days');
  if (raw === null) return fallback;
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(n >= 1 && n <= MAX_DAYS)) throw new BadRequest(`days must be a whole number from 1 to ${MAX_DAYS}.`);
  return n;
}

const routes: [RegExp, Handler][] = [
  [/^\/brands$/, () => ({ brands: listBrands() })],
  [/^\/brands\/([\w-]+)\/visibility$/, ([id], q) => {
    if (!getBrand(id)) throw new NotFound();
    return visibility(id, daysParam(q, 30));
  }],
  [/^\/brands\/([\w-]+)\/competitors$/, async ([id]) => {
    if (!getBrand(id)) throw new NotFound();
    return { brandId: id, competitors: await competitors(id) };
  }],
  [/^\/brands\/([\w-]+)\/share-of-voice$/, async ([id], q) => {
    if (!getBrand(id)) throw new NotFound();
    return shareOfVoice(id, daysParam(q, 90));
  }],
  [/^\/responses\/([\w-]+)$/, ([id]) => {
    const a = getAnswer(id);
    if (!a) throw new NotFound();
    return a;
  }],
];

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return send(405, { error: 'Only GET is supported.' });
    for (const [re, handler] of routes) {
      const m = url.pathname.match(re);
      if (!m) continue;
      try {
        return send(200, await handler(m.slice(1), url.searchParams));
      } catch (e) {
        if (e instanceof NotFound) return send(404, { error: 'Not found.' });
        if (e instanceof BadRequest) return send(400, { error: e.message });
        console.error(e);
        return send(500, { error: 'Something went wrong.' });
      }
    }
    send(404, { error: 'Not found.' });
  });
}

if (process.argv[1]?.endsWith('server.ts')) {
  const stats = await loadAll();
  console.log(describeStats(stats));
  createServer().listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
}
