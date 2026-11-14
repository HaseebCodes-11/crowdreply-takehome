// Loads the vendor's daily batches from data/feed and stores them as answers.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.ts';
import { isOwnBrandMentioned } from './detect.ts';
import { getBrand, saveAnswer, saveBrands } from './store.ts';
import { MODELS, type Answer, type Brand, type VendorResponse } from './types.ts';

class ValidationError extends Error {}

function toAnswer(raw: VendorResponse): Answer {
  const brand = getBrand(raw.brandId);
  if (!brand) throw new ValidationError(`unknown brand ${raw.brandId}`);
  if (!MODELS.includes(raw.model)) throw new ValidationError(`unknown model ${raw.model}`);
  for (const m of raw.mentions) {
    if (!m.name) throw new ValidationError('mention without a name');
    if (!m.domain) throw new ValidationError(`mention ${m.name} has no domain`);
  }
  return {
    id: raw.id,
    brandId: raw.brandId,
    model: raw.model,
    prompt: raw.prompt,
    fetchedAt: raw.fetchedAt,
    day: raw.fetchedAt.slice(0, 10),
    status: raw.httpStatus === 200 ? 'ok' : 'failed',
    text: raw.text,
    ownBrandMentioned: isOwnBrandMentioned(raw.text, brand, raw.isMentioned),
    mentions: raw.mentions.filter((m) => m.name !== brand.name).map((m) => ({ name: m.name, domain: m.domain, position: m.position })),
    citations: raw.citations,
  };
}

export async function loadAll() {
  const brands = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'brands.json'), 'utf8')) as Brand[];
  saveBrands(brands);

  const feedDir = path.join(DATA_DIR, 'feed');
  let saved = 0;
  let skipped = 0;
  for (const file of fs.readdirSync(feedDir).filter((f) => f.endsWith('.json')).sort()) {
    const batch = JSON.parse(fs.readFileSync(path.join(feedDir, file), 'utf8')) as { responses: VendorResponse[] };
    for (const raw of batch.responses) {
      try {
        saveAnswer(toAnswer(raw));
        saved++;
      } catch (e) {
        if (e instanceof ValidationError) {
          skipped++;
          continue;
        }
        throw e;
      }
    }
  }
  return { brands: brands.length, saved, skipped };
}
