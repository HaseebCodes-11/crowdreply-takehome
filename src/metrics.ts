import { answersFor, allAnswers } from './store.ts';
import { MODELS, type Answer, type Model } from './types.ts';
import { NOW_OVERRIDE } from './config.ts';

export function today(): string {
  if (NOW_OVERRIDE) return NOW_OVERRIDE;
  let latest = '';
  for (const a of allAnswers()) if (a.day > latest) latest = a.day;
  return latest;
}

// First day inside a window of `days` days that ends on `to` (inclusive).
export function windowStart(days: number, to: string = today()): string {
  const d = new Date(to + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days + 1);
  return d.toISOString().slice(0, 10);
}

// The answers we count for a brand: fetched inside the window (both ends included) and not failed.
// Every metric that looks at a window goes through here so they all count the same answers.
export function countedAnswers(brandId: string, days: number, to: string = today()): { from: string; to: string; answers: Answer[] } {
  const from = windowStart(days, to);
  const answers = answersFor(brandId).filter((a) => a.day >= from && a.day <= to && a.status === 'ok');
  return { from, to, answers };
}

export interface ModelVisibility {
  answers: number;
  mentioned: number;
  visibility: number; // mentioned / answers, 0 to 1
}

// Share of answers that name the brand, per model, over the last `days` days.
export function visibility(brandId: string, days: number, now: string = today()) {
  const { from, to, answers: counted } = countedAnswers(brandId, days, now);
  const byModel = {} as Record<Model, ModelVisibility>;
  for (const m of MODELS) byModel[m] = { answers: 0, mentioned: 0, visibility: 0 };
  for (const a of counted) {
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
  return { brandId, days, from, to, byModel, overall: { answers, mentioned, visibility: answers ? mentioned / answers : 0 } };
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
