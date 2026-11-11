// T46: favourite / rating / lastCookedAt are ordinary fields for the sync engine.
import type { Recipe } from '../../domain/types';
import { emptySnapshot, mergeSnapshot, type Snapshot } from './merge';

const T0 = '2026-01-01T00:00:00.000Z';
const base: Recipe = {
  id: 'r1',
  createdAt: T0,
  updatedAt: T0,
  deviceId: 'dev-a',
  rev: 1,
  title: 'Pierogi',
  tagIds: [],
  ingredients: [],
  steps: [{ id: 's1', text: 'Mix.' }],
  photoHashes: [],
};
const snap = (r: Recipe): Snapshot => ({ ...emptySnapshot(), recipes: [r] });
const bump = (r: Recipe, over: Partial<Recipe>): Recipe => ({ ...r, ...over, rev: r.rev + 1 });
const opts = { deviceId: 'dev-me', now: '2026-02-01T00:00:00.000Z' };

describe('merge of favourite / rating / lastCookedAt', () => {
  it('favourite here + steps edit there combine without a conflict', () => {
    const local = bump(base, { favourite: true });
    const remote = bump(base, { steps: [{ id: 's1', text: 'Mix well.' }] });
    const res = mergeSnapshot(snap(local), snap(remote), snap(base), opts);
    expect(res.conflicts).toEqual([]);
    expect(res.changes).toHaveLength(1);
    const merged = res.changes[0]!.record as Recipe;
    expect(merged.favourite).toBe(true);
    expect(merged.steps[0]!.text).toBe('Mix well.');
    expect(merged.rev).toBe(3);
  });

  it('rating + lastCookedAt on one device, notes on the other combine', () => {
    const local = bump(base, { rating: 4, lastCookedAt: '2026-01-20' });
    const remote = bump(base, { notes: 'more salt' });
    const res = mergeSnapshot(snap(local), snap(remote), snap(base), opts);
    expect(res.conflicts).toEqual([]);
    expect(res.changes[0]!.record).toMatchObject({
      rating: 4,
      lastCookedAt: '2026-01-20',
      notes: 'more salt',
    });
  });

  it('only remote favourited: taken as is', () => {
    const remote = bump(base, { favourite: true });
    const res = mergeSnapshot(snap(base), snap(remote), snap(base), opts);
    expect(res.conflicts).toEqual([]);
    expect(res.changes[0]).toMatchObject({ kind: 'take-remote' });
  });

  it('same day cooked on both devices is equal; different ratings conflict on that field only', () => {
    const same = mergeSnapshot(
      snap(bump(base, { lastCookedAt: '2026-01-20' })),
      snap(bump(base, { lastCookedAt: '2026-01-20' })),
      snap(base),
      opts,
    );
    expect(same.conflicts).toEqual([]);

    const res = mergeSnapshot(
      snap(bump(base, { rating: 2 })),
      snap(bump(base, { rating: 5 })),
      snap(base),
      opts,
    );
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]!.fields).toEqual(['rating']);
  });
});
