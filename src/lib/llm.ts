// Offline stand-in for the LLM we call to classify brands. It answers from data/llm/fixture.json
// so the task runs without an API key. Treat it like a paid API:
//   - every call costs 1 credit and takes a moment,
//   - it sometimes rate-limits you (LlmRateLimitError), and a retry usually works.
// Please call it through classifyCompetitor() rather than reading the fixture file directly.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.ts';
import type { Brand } from '../types.ts';

export class LlmRateLimitError extends Error {}

let fixture: Record<string, Record<string, boolean>> | null = null;
let credits = 0;
let calls = 0;

export interface CompetitorVerdict {
  isCompetitor: boolean;
  reason: string;
}

// Asks the model whether `candidate` is a real competitor of `brand`.
export async function classifyCompetitor(brand: Brand, candidate: string): Promise<CompetitorVerdict> {
  fixture ??= JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'llm', 'fixture.json'), 'utf8')) as Record<string, Record<string, boolean>>;
  calls++;
  credits++;
  await new Promise((r) => setTimeout(r, 25));
  if (calls % 13 === 0) throw new LlmRateLimitError('429: rate limited, retry after a short wait');
  const isCompetitor = fixture[brand.id]?.[candidate] === true;
  return {
    isCompetitor,
    reason: isCompetitor
      ? `${candidate} sells a similar product to ${brand.category.toLowerCase()} buyers.`
      : `${candidate} is not a direct alternative to ${brand.name}.`,
  };
}

export function llmUsage() {
  return { calls, credits };
}
