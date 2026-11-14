import type { Brand } from './types.ts';

// Is the tracked brand named in this answer? We trust the vendor's flag, and double-check the text
// ourselves in case the vendor missed it.
export function isOwnBrandMentioned(text: string, brand: Brand, vendorSaysMentioned: boolean): boolean {
  if (vendorSaysMentioned) return true;
  return text.toLowerCase().includes(brand.name.toLowerCase());
}
