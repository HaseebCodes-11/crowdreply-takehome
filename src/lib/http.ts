// Offline stand-in for making an HTTP HEAD request to a URL without following redirects. It answers
// from data/redirects.json so everything runs without network access. Unknown URLs come back as 200.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.ts';

export interface HeadResult {
  status: number;
  location?: string; // set on 3xx responses
}

let redirects: Record<string, HeadResult> | null = null;

export async function head(url: string): Promise<HeadResult> {
  redirects ??= JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'redirects.json'), 'utf8')) as Record<string, HeadResult>;
  await new Promise((r) => setTimeout(r, 2));
  return redirects[url] ?? { status: 200 };
}
