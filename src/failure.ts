import type { FailureReason } from './types.ts';

// The refusal the vendor passes through as if it were an answer.
const REFUSAL = /^i don['’]t have search results for that query right now\.?$/i;

// Why an answer should not be counted, or null when it is a real answer.
//
// The vendor reports httpStatus 200 even when the model returned nothing useful, so the status code
// alone never marks an answer as failed. We look at the content instead. Each rule is exact on
// purpose: an answer that simply names no brand is a real result and must still count as a miss.
export function failureReason(r: { httpStatus: number; text: string; prompt: string }): FailureReason | null {
  if (r.httpStatus !== 200) return 'http_error';
  const text = r.text.trim();
  if (!text) return 'empty_text';
  const prompt = r.prompt.trim();
  if (prompt && text.toLowerCase() === prompt.toLowerCase()) return 'prompt_echo';
  if (REFUSAL.test(text)) return 'refusal';
  return null;
}
