// In-memory storage. Small enough for the sample data; a real deployment uses a database.

import type { Answer, Brand } from './types.ts';

const brands = new Map<string, Brand>();
const answers: Answer[] = [];
const answersById = new Map<string, Answer>();

export function saveBrands(list: Brand[]) {
  for (const b of list) brands.set(b.id, b);
}

export function getBrand(id: string) {
  return brands.get(id);
}

export function listBrands() {
  return [...brands.values()];
}

export function saveAnswer(a: Answer) {
  answers.push(a);
  answersById.set(a.id, a);
}

export function getAnswer(id: string) {
  return answersById.get(id);
}

export function answersFor(brandId: string) {
  return answers.filter((a) => a.brandId === brandId);
}

export function allAnswers() {
  return answers;
}
