// Browser walkthrough harness. Run from the project root: node e2e/viewer.mjs, then open http://localhost:4700
// Starts the real service twice (default settings on 4600, NOW=2026-11-11 on 4601), then serves a
// test page on 4700 that calls both through a same-origin proxy and shows each result.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TARGETS = { live: 4600, pinned: 4601 };
const children = [];

function startService(port, extra) {
  const env = { ...process.env, ...extra, PORT: String(port) };
  if (!extra.NOW) delete env.NOW;
  delete env.DATA_DIR;
  const child = spawn(process.execPath, ['src/server.ts'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(child);
  return new Promise((resolve, reject) => {
    let log = '';
    child.stdout.on('data', (d) => { log += d; process.stdout.write(`[${port}] ${d}`); if (log.includes('Listening on')) resolve(); });
    child.once('exit', (code) => reject(new Error(`service on ${port} exited with ${code}`)));
  });
}

const stop = () => { for (const c of children) c.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

await Promise.all([startService(TARGETS.live, {}), startService(TARGETS.pinned, { NOW: '2026-11-11' })]);

http.createServer(async (req, res) => {
  const m = (req.url ?? '/').match(/^\/(live|pinned)(\/.*)$/);
  if (!m) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(here, 'viewer.html')));
  }
  try {
    const upstream = await fetch(`http://localhost:${TARGETS[m[1]]}${m[2]}`, { method: req.method });
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
    res.end(await upstream.text());
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(e) }));
  }
}).listen(4700, () => console.log('Viewer ready on http://localhost:4700'));
