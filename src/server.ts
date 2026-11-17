import http from 'node:http';
import { PORT } from './config.ts';
import { describeStats, loadAll } from './ingest.ts';
import { competitors, visibility } from './metrics.ts';
import { getAnswer, getBrand, listBrands } from './store.ts';

type Handler = (params: string[], query: URLSearchParams) => unknown | Promise<unknown>;

class NotFound extends Error {}

const routes: [RegExp, Handler][] = [
  [/^\/brands$/, () => ({ brands: listBrands() })],
  [/^\/brands\/([\w-]+)\/visibility$/, ([id], q) => {
    if (!getBrand(id)) throw new NotFound();
    return visibility(id, Number(q.get('days') ?? 30));
  }],
  [/^\/brands\/([\w-]+)\/competitors$/, ([id]) => {
    if (!getBrand(id)) throw new NotFound();
    return { brandId: id, competitors: competitors(id) };
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
