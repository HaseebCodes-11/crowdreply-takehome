export const MODELS = ['chatgpt', 'perplexity', 'gemini', 'google_aio', 'google_ai_mode'] as const;
export type Model = (typeof MODELS)[number];

export interface Brand {
  id: string;
  name: string;
  domain: string;
  category: string;
  description: string;
}

// One answer as the vendor sends it (data/feed/*.json).
export interface VendorResponse {
  id: string;
  brandId: string;
  model: Model;
  prompt: string;
  fetchedAt: string;
  httpStatus: number;
  text: string;
  isMentioned: boolean; // the vendor's own view of whether the tracked brand is in the answer
  mentions: VendorMention[];
  citations: string[];
}

export interface VendorMention {
  name: string;
  domain: string | null;
  position: number;
}

// Why we do not count an answer: the fetch failed, or the model returned nothing usable.
export type FailureReason = 'http_error' | 'empty_text' | 'prompt_echo' | 'refusal';

// One answer as we store it.
export interface Answer {
  id: string;
  brandId: string;
  model: Model;
  prompt: string;
  fetchedAt: string;
  day: string; // YYYY-MM-DD, UTC
  status: 'ok' | 'failed';
  failureReason: FailureReason | null; // why status is 'failed', null when it is 'ok'
  text: string;
  ownBrandMentioned: boolean; // our own reading of the text, see detect.ts
  vendorIsMentioned: boolean; // what the vendor claimed. Kept for audit, never used in a metric
  mentions: Mention[]; // other brands named in the answer
  citations: string[];
}

export interface Mention {
  name: string;
  domain: string | null;
  position: number;
}
