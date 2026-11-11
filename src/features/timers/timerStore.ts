import { useSyncExternalStore } from 'react';

/** A running (or just finished) step timer. Only the end time is stored, so reloads keep counting. */
export interface Timer {
  id: string;
  label: string;
  /** Length in seconds. */
  seconds: number;
  /** Epoch ms when the timer rings. */
  endAt: number;
  /** True once the alarm has been triggered; the timer stays until dismissed. */
  rang: boolean;
}

export const TIMERS_STORAGE_KEY = 'recipes.timers';

let timers: Timer[] = load();
const listeners = new Set<() => void>();
let alarm: (timer: Timer) => void = () => undefined;

function isTimer(v: unknown): v is Timer {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.label === 'string' &&
    typeof o.seconds === 'number' &&
    typeof o.endAt === 'number' &&
    typeof o.rang === 'boolean'
  );
}

function load(): Timer[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(TIMERS_STORAGE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(isTimer) : [];
  } catch {
    return [];
  }
}

function commit(next: Timer[]): void {
  timers = next;
  try {
    localStorage.setItem(TIMERS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode / quota): timers still work until reload.
  }
  listeners.forEach((l) => l());
}

function newId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getTimers(): readonly Timer[] {
  return timers;
}

export function startTimer(label: string, seconds: number): Timer {
  const timer: Timer = { id: newId(), label, seconds, endAt: Date.now() + seconds * 1000, rang: false };
  commit([...timers, timer]);
  return timer;
}

/** Cancel a running timer or dismiss a finished one. */
export function removeTimer(id: string): void {
  commit(timers.filter((t) => t.id !== id));
}

/** Set the function that rings the alarm (sound, vibration, notification). */
export function setAlarmHandler(fn: (timer: Timer) => void): void {
  alarm = fn;
}

/** Ring every timer whose time is up and has not rung yet. Returns true when something rang. */
export function checkTimers(now: number = Date.now()): boolean {
  const due = timers.filter((t) => !t.rang && t.endAt <= now);
  if (due.length === 0) return false;
  commit(timers.map((t) => (due.includes(t) ? { ...t, rang: true } : t)));
  due.forEach((t) => alarm({ ...t, rang: true }));
  return true;
}

export function subscribeTimers(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTimers(): readonly Timer[] {
  return useSyncExternalStore(subscribeTimers, getTimers, getTimers);
}

/** Re-read storage (used by tests that clear it). */
export function resetTimersForTests(): void {
  try {
    localStorage.removeItem(TIMERS_STORAGE_KEY);
  } catch {
    // ignore
  }
  timers = [];
  alarm = () => undefined;
  listeners.forEach((l) => l());
}
