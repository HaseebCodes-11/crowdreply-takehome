import { answersFor, allAnswers } from './store.ts';
import { MODELS, type Model } from './types.ts';
import { NOW_OVERRIDE } from './config.ts';

export function today(): string {
  if (NOW_OVERRIDE) return NOW_OVERRIDE;
  let latest = '';
  for (const a of allAnswers()) if (a.day > latest) latest = a.day;
  return latest;
}

// First day inside a window of `days` days that ends today (inclusive).
export function windowStart(days: number): string {
  const d = new Date(today() + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days + 1);
  return d.toISOString().slice(0, 10);
}

export interface ModelVisibility {
  answers: number;
  mentioned: number;
  visibility: number; // mentioned / answers, 0 to 1
}

// Share of answers that name the brand, per model, over the last `days` days.
export function visibility(brandId: string, days: number) {
  const from = windowStart(days);
  const byModel = {} as Record<Model, ModelVisibility>;
  for (const m of MODELS) byModel[m] = { answers: 0, mentioned: 0, visibility: 0 };
  for (const a of answersFor(brandId)) {
    if (a.day < from || a.status !== 'ok') continue;
    byModel[a.model].answers++;
    if (a.ownBrandMentioned) byModel[a.model].mentioned++;
  }
  let answers = 0;
  let mentioned = 0;
  for (const m of MODELS) {
    const v = byModel[m];
    v.visibility = v.answers ? v.mentioned / v.answers : 0;
    answers += v.answers;
    mentioned += v.mentioned;
  }
  return { brandId, days, from, to: today(), byModel, overall: { answers, mentioned, visibility: answers ? mentioned / answers : 0 } };
}

// A brand's competitors: the brands named most often alongside it.
export function competitors(brandId: string) {
  const counts = new Map<string, { name: string; domain: string | null; mentions: number }>();
  for (const a of answersFor(brandId)) {
    for (const m of a.mentions) {
      const c = counts.get(m.name) ?? { name: m.name, domain: m.domain, mentions: 0 };
      c.mentions++;
      counts.set(m.name, c);
    }
  }
  return [...counts.values()].sort((x, y) => y.mentions - x.mentions).slice(0, 10);
}
