// Loads the vendor's daily batches from data/feed and stores them as answers.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.ts';
import { isOwnBrandMentioned } from './detect.ts';
import { failureReason } from './failure.ts';
import { getBrand, saveAnswer, saveBrands } from './store.ts';
import { MODELS, type Answer, type Brand, type Model, type VendorMention, type VendorResponse } from './types.ts';

// An answer we cannot use at all. `reason` is a short code so loadAll() can count skips by cause.
export class ValidationError extends Error {
  reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.reason = reason;
  }
}

export interface IngestStats {
  brands: number;
  saved: number;
  skipped: number;
  skippedByReason: Record<string, number>;
  duplicates: number; // repeat deliveries of an id we already had
  conflictingDuplicates: number; // repeats whose content differed from the first copy
  failed: number; // stored, but marked 'failed' and left out of every metric
  failedByReason: Record<string, number>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// The vendor lists some brands without a domain (and lists ChatGPT and Perplexity that way too).
// That is not a reason to lose the answer: keep the mention and leave its domain empty.
function cleanMentions(raw: unknown): VendorMention[] {
  if (!Array.isArray(raw)) return [];
  const out: VendorMention[] = [];
  raw.forEach((m, i) => {
    if (!isRecord(m) || typeof m.name !== 'string' || !m.name.trim()) return; // nothing to count without a name
    out.push({
      name: m.name,
      domain: typeof m.domain === 'string' && m.domain.trim() ? m.domain : null,
      position: typeof m.position === 'number' ? m.position : i + 1,
    });
  });
  return out;
}

// Checks one raw answer from the feed. Throws only when the answer cannot be attributed (no id, unknown
// brand or model, no usable date). Anything else that is missing is filled with an empty value.
export function checkResponse(raw: unknown): VendorResponse {
  if (!isRecord(raw)) throw new ValidationError('not_an_object', 'answer is not an object');
  if (typeof raw.id !== 'string' || !raw.id) throw new ValidationError('missing_id', 'answer has no id');
  if (typeof raw.brandId !== 'string' || !getBrand(raw.brandId)) throw new ValidationError('unknown_brand', `unknown brand ${String(raw.brandId)}`);
  if (!MODELS.includes(raw.model as Model)) throw new ValidationError('unknown_model', `unknown model ${String(raw.model)}`);
  if (typeof raw.fetchedAt !== 'string' || Number.isNaN(Date.parse(raw.fetchedAt))) throw new ValidationError('bad_fetched_at', `unusable fetchedAt on ${raw.id}`);
  return {
    id: raw.id,
    brandId: raw.brandId,
    model: raw.model as Model,
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
    fetchedAt: raw.fetchedAt,
    httpStatus: typeof raw.httpStatus === 'number' ? raw.httpStatus : 0,
    text: typeof raw.text === 'string' ? raw.text : '',
    isMentioned: raw.isMentioned === true,
    mentions: cleanMentions(raw.mentions),
    citations: Array.isArray(raw.citations) ? raw.citations.filter((c): c is string => typeof c === 'string') : [],
  };
}

function toAnswer(raw: VendorResponse, brand: Brand): Answer {
  const failure = failureReason(raw);
  return {
    id: raw.id,
    brandId: raw.brandId,
    model: raw.model,
    prompt: raw.prompt,
    fetchedAt: raw.fetchedAt,
    day: new Date(raw.fetchedAt).toISOString().slice(0, 10),
    status: failure ? 'failed' : 'ok',
    failureReason: failure,
    text: raw.text,
    ownBrandMentioned: isOwnBrandMentioned(raw.text, brand),
    vendorIsMentioned: raw.isMentioned,
    mentions: raw.mentions.filter((m) => m.name !== brand.name).map((m) => ({ name: m.name, domain: m.domain, position: m.position })),
    citations: raw.citations,
  };
}

// Reads one batch file. A file we cannot read is reported and skipped rather than stopping the whole load.
function readBatch(file: string): unknown[] | null {
  try {
    const batch = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (isRecord(batch) && Array.isArray(batch.responses)) return batch.responses;
  } catch {
    // fall through
  }
  console.warn(`Skipping unreadable feed file ${path.basename(file)}`);
  return null;
}

export async function loadAll(): Promise<IngestStats> {
  const brands = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'brands.json'), 'utf8')) as Brand[];
  saveBrands(brands);

  const feedDir = path.join(DATA_DIR, 'feed');
  const stats: IngestStats = { brands: brands.length, saved: 0, skipped: 0, skippedByReason: {}, duplicates: 0, conflictingDuplicates: 0, failed: 0, failedByReason: {} };
  const skip = (reason: string) => {
    stats.skipped++;
    stats.skippedByReason[reason] = (stats.skippedByReason[reason] ?? 0) + 1;
  };

  // The vendor delivers some answers twice, in the same file or again in the next day's file.
  // Collect one copy per id first, then store.
  const unique = new Map<string, VendorResponse>();

  for (const file of fs.readdirSync(feedDir).filter((f) => f.endsWith('.json')).sort()) {
    const responses = readBatch(path.join(feedDir, file));
    if (!responses) {
      skip('unreadable_file');
      continue;
    }
    for (const item of responses) {
      try {
        const raw = checkResponse(item);
        const earlier = unique.get(raw.id);
        if (!earlier) {
          unique.set(raw.id, raw);
          continue;
        }
        stats.duplicates++;
        if (JSON.stringify(raw) !== JSON.stringify(earlier)) {
          // Not seen in the sample feed. If a resent answer ever differs, the most recent fetch wins,
          // and for the same fetch time the copy delivered last wins.
          stats.conflictingDuplicates++;
          if (Date.parse(raw.fetchedAt) >= Date.parse(earlier.fetchedAt)) unique.set(raw.id, raw);
        }
      } catch (e) {
        if (e instanceof ValidationError) {
          skip(e.reason);
          continue;
        }
        throw e;
      }
    }
  }

  for (const raw of unique.values()) {
    const answer = toAnswer(raw, getBrand(raw.brandId)!);
    saveAnswer(answer);
    stats.saved++;
    if (answer.failureReason) {
      stats.failed++;
      stats.failedByReason[answer.failureReason] = (stats.failedByReason[answer.failureReason] ?? 0) + 1;
    }
  }
  return stats;
}

// One line for the startup log.
export function describeStats(s: IngestStats): string {
  const list = (counts: Record<string, number>) => Object.entries(counts).map(([r, n]) => `${r}: ${n}`).join(', ');
  const reasons = list(s.skippedByReason);
  const failures = s.failed ? ` ${s.failed} answers are marked failed and not counted (${list(s.failedByReason)}).` : '';
  const conflicts = s.conflictingDuplicates ? `, ${s.conflictingDuplicates} of them with different content` : '';
  return `Loaded ${s.brands} brands and ${s.saved} answers (${s.skipped} skipped${reasons ? `: ${reasons}` : ''}; ${s.duplicates} duplicate deliveries ignored${conflicts}).${failures}`;
}
