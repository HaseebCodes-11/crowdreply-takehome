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

// One answer as we store it.
export interface Answer {
  id: string;
  brandId: string;
  model: Model;
  prompt: string;
  fetchedAt: string;
  day: string; // YYYY-MM-DD, UTC
  status: 'ok' | 'failed';
  text: string;
  ownBrandMentioned: boolean;
  mentions: Mention[]; // other brands named in the answer
  citations: string[];
}

export interface Mention {
  name: string;
  domain: string | null;
  position: number;
}
