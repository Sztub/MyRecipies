import type { UUID } from './types';

export function newId(): UUID {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
