// Offline stand-in for a public DNS resolver (think 1.1.1.1). It answers from data/dns.json so
// everything runs without network access. Treat it like the real thing: it's async, and it can fail.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.ts';

export type DnsStatus = 'live' | 'nxdomain' | 'nodata' | 'servfail';

export interface DnsRecord {
  status: DnsStatus;
  nameservers?: string[];
  redirect?: string; // where http://<domain> redirects to, if anywhere
}

let records: Record<string, DnsRecord> | null = null;

export async function lookupDomain(domain: string): Promise<DnsRecord> {
  records ??= JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'dns.json'), 'utf8')) as Record<string, DnsRecord>;
  await new Promise((r) => setTimeout(r, 2));
  const host = domain.toLowerCase().replace(/^www\./, '');
  // A name the resolver has never heard of times out, like a real resolver having a bad day.
  return records[host] ?? { status: 'servfail' };
}
