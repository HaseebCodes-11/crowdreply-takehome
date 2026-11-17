import { competitors } from './competitors.ts';
import { countedAnswers } from './metrics.ts';
import { getBrand } from './store.ts';
import { MODELS, type Model } from './types.ts';

// Share of voice: for each model, out of all the times the brand or one of its real competitors was
// named, the share that went to each of them.
//
// - Answers are counted, not mentions: an answer that names Kanbrik twice counts once for Kanbrik.
// - Only answers visibility would count are used (inside the window, not failed).
// - "Real competitors" is exactly the list /brands/:id/competitors returns.
// - The client's brand is detected by our own reading of the text. Competitors come from the vendor's
//   mentions, which match the answer text for every real competitor in the sample feed.
// - Per model the shares add up to 1, or are all 0 when nobody was named.
export async function shareOfVoice(brandId: string, days: number, now?: string) {
  const brand = getBrand(brandId);
  if (!brand) return null;
  const rivals = (await competitors(brandId)).map((c) => c.name);
  const names = [brand.name, ...rivals];
  const { from, to, answers } = countedAnswers(brandId, days, now);

  const counts = {} as Record<Model, Record<string, number>>;
  for (const m of MODELS) counts[m] = Object.fromEntries(names.map((n) => [n, 0]));
  for (const a of answers) {
    const c = counts[a.model];
    if (a.ownBrandMentioned) c[brand.name]++;
    const named = new Set(a.mentions.map((m) => m.name));
    for (const r of rivals) if (named.has(r)) c[r]++;
  }

  const byModel = {} as Record<Model, Record<string, number>>;
  for (const m of MODELS) {
    const total = names.reduce((sum, n) => sum + counts[m][n], 0);
    byModel[m] = Object.fromEntries(names.map((n) => [n, total ? counts[m][n] / total : 0]));
  }
  // `counts` is the number of answers behind each share, so a share can be checked by hand.
  return { brandId, days, from, to, competitors: rivals, byModel, counts };
}
