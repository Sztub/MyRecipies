import { describe, expect, it } from 'vitest';
import { withRepoLock } from './repoLock';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('withRepoLock', () => {
  it('runs one operation at a time, in order, and keeps going after a failure', async () => {
    const log: string[] = [];
    let active = 0;
    let maxActive = 0;
    const op = (name: string, fail = false) =>
      withRepoLock(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        log.push(`start ${name}`);
        await tick();
        log.push(`end ${name}`);
        active--;
        if (fail) throw new Error(name);
        return name;
      });

    const results = await Promise.allSettled([op('sync'), op('backup', true), op('restore')]);
    expect(maxActive).toBe(1);
    expect(log).toEqual(['start sync', 'end sync', 'start backup', 'end backup', 'start restore', 'end restore']);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});
