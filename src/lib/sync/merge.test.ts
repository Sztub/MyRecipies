import type { Category, Recipe, Tag } from '../../domain/types';
import { deepEqual, emptySnapshot, mergeSnapshot, sameRecord, type Snapshot } from './merge';

const T0 = '2026-01-01T00:00:00.000Z';
const NOW = '2026-02-01T00:00:00.000Z';

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    createdAt: T0,
    updatedAt: T0,
    deviceId: 'dev-a',
    rev: 1,
    title: 'Pierogi',
    tagIds: [],
    ingredients: [{ id: 'i1', name: 'flour', amount: 500, unit: 'g' }],
    steps: [{ id: 's1', text: 'Mix.' }],
    photoHashes: [],
    ...over,
  };
}

/** An edit as the repository would make it on another device: content change + meta change. */
function edit<T extends Recipe | Category | Tag>(r: T, over: Partial<T>, deviceId = 'dev-x'): T {
  return { ...r, ...over, rev: r.rev + 1, deviceId, updatedAt: '2026-01-15T00:00:00.000Z' };
}

function tomb<T extends Recipe | Category | Tag>(r: T, deviceId = 'dev-x'): T {
  return edit(r, { deleted: true } as Partial<T>, deviceId);
}

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return { ...emptySnapshot(), ...over };
}

const opts = { deviceId: 'dev-me', now: NOW };

describe('deepEqual / sameRecord', () => {
  it('treats missing and undefined keys alike, compares arrays in order', () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: [{ x: 1 }] }, { a: [{ x: 1 }] })).toBe(true);
    expect(deepEqual(null, {})).toBe(false);
  });

  it('ignores meta fields, compares tombstone state, two tombstones are equal', () => {
    const a = recipe();
    expect(sameRecord(a, { ...a, rev: 9, deviceId: 'z', updatedAt: NOW })).toBe(true);
    expect(sameRecord(a, { ...a, deleted: true })).toBe(false);
    expect(sameRecord({ ...a, deleted: true }, { ...a, title: 'x', deleted: true })).toBe(true);
  });
});

describe('mergeSnapshot – single record rules', () => {
  it('local == remote → nothing (even with different meta)', () => {
    const base = recipe();
    const l = edit(base, { title: 'Same' }, 'dev-me');
    const r = edit(base, { title: 'Same' }, 'dev-x');
    const res = mergeSnapshot(
      snap({ recipes: [l] }),
      snap({ recipes: [r] }),
      snap({ recipes: [base] }),
      opts,
    );
    expect(res.changes).toEqual([]);
    expect(res.conflicts).toEqual([]);
    expect(res.outcomes).toEqual([{ entity: 'recipes', recordId: 'r1', outcome: 'same' }]);
  });

  it('only remote changed → take remote verbatim', () => {
    const base = recipe();
    const r = edit(base, { title: 'Pierogi ruskie' });
    const res = mergeSnapshot(
      snap({ recipes: [base] }),
      snap({ recipes: [r] }),
      snap({ recipes: [base] }),
      opts,
    );
    expect(res.changes).toEqual([{ entity: 'recipes', kind: 'take-remote', record: r }]);
    expect(res.conflicts).toEqual([]);
  });

  it('only local changed → keep local', () => {
    const base = recipe();
    const l = edit(base, { title: 'Mine' }, 'dev-me');
    const res = mergeSnapshot(
      snap({ recipes: [l] }),
      snap({ recipes: [base] }),
      snap({ recipes: [base] }),
      opts,
    );
    expect(res.changes).toEqual([]);
    expect(res.outcomes[0]?.outcome).toBe('keep-local');
  });

  it('both changed different fields → combine, rev = max+1, this device, now', () => {
    const base = recipe();
    const l = edit(edit(base, { title: 'Pierogi babci' }, 'dev-me'), { servings: 4 }, 'dev-me'); // rev 3
    const r = edit(base, {
      ingredients: [...base.ingredients, { id: 'i2', name: 'salt', unit: 'pinch' }],
      tagIds: ['t1'],
    }); // rev 2
    const res = mergeSnapshot(
      snap({ recipes: [l] }),
      snap({ recipes: [r] }),
      snap({ recipes: [base] }),
      opts,
    );
    expect(res.conflicts).toEqual([]);
    expect(res.changes).toHaveLength(1);
    const merged = res.changes[0]!;
    expect(merged.kind).toBe('combine');
    expect(merged.record).toEqual({
      ...base,
      title: 'Pierogi babci',
      servings: 4,
      ingredients: r.ingredients,
      tagIds: ['t1'],
      rev: 4,
      deviceId: 'dev-me',
      updatedAt: NOW,
    });
  });

  it('a field removed on one side and another edited on the other combines', () => {
    const base = recipe({ notes: 'old note' });
    const l: Recipe = { ...edit(base, {}, 'dev-me') };
    delete l.notes;
    const r = edit(base, { title: 'New' });
    const res = mergeSnapshot(
      snap({ recipes: [l] }),
      snap({ recipes: [r] }),
      snap({ recipes: [base] }),
      opts,
    );
    const rec = res.changes[0]!.record as Recipe;
    expect(rec.title).toBe('New');
    expect('notes' in rec).toBe(false);
  });

  it('same field changed identically on both sides plus another remote change → take remote (no rev churn)', () => {
    const base = recipe();
    const l = edit(base, { title: 'X' }, 'dev-me');
    const r = edit(base, { title: 'X', servings: 2 });
    const res = mergeSnapshot(
      snap({ recipes: [l] }),
      snap({ recipes: [r] }),
      snap({ recipes: [base] }),
      opts,
    );
    expect(res.changes).toEqual([{ entity: 'recipes', kind: 'take-remote', record: r }]);
  });

  it('same field changed differently → conflict, local untouched', () => {
    const base = recipe();
    const l = edit(base, { title: 'Mine', servings: 2 }, 'dev-me');
    const r = edit(base, { title: 'Theirs', notes: 'n' });
    const res = mergeSnapshot(
      snap({ recipes: [l] }),
      snap({ recipes: [r] }),
      snap({ recipes: [base] }),
      opts,
    );
    expect(res.changes).toEqual([]);
    expect(res.conflicts).toEqual([
      {
        entity: 'recipes',
        recordId: 'r1',
        reason: 'same-field',
        fields: ['title'],
        local: l,
        remote: r,
      },
    ]);
  });

  it('array fields (ingredients, steps, tagIds, photoHashes) are one field each', () => {
    const base = recipe({ photoHashes: ['a'] });
    const l = edit(
      base,
      { ingredients: [{ id: 'i1', name: 'flour', amount: 600, unit: 'g' }] },
      'dev-me',
    );
    const r = edit(base, {
      ingredients: [{ id: 'i1', name: 'rye flour', amount: 500, unit: 'g' }],
    });
    const res = mergeSnapshot(
      snap({ recipes: [l] }),
      snap({ recipes: [r] }),
      snap({ recipes: [base] }),
      opts,
    );
    expect(res.conflicts.map((c) => c.fields)).toEqual([['ingredients']]);

    const l2 = edit(base, { photoHashes: ['a', 'b'] }, 'dev-me');
    const r2 = edit(base, { photoHashes: ['a', 'c'] });
    const res2 = mergeSnapshot(
      snap({ recipes: [l2] }),
      snap({ recipes: [r2] }),
      snap({ recipes: [base] }),
      opts,
    );
    expect(res2.conflicts.map((c) => c.fields)).toEqual([['photoHashes']]);
  });

  it('record only on remote → add (also tombstones); only on local → kept', () => {
    const onlyRemote = recipe({ id: 'r2', title: 'Bigos' });
    const remoteTomb = recipe({ id: 'r3', deleted: true, rev: 2 });
    const onlyLocal = recipe({ id: 'r4', title: 'Żurek' });
    const res = mergeSnapshot(
      snap({ recipes: [onlyLocal] }),
      snap({ recipes: [onlyRemote, remoteTomb] }),
      emptySnapshot(),
      opts,
    );
    expect(res.changes).toEqual([
      { entity: 'recipes', kind: 'add', record: onlyRemote },
      { entity: 'recipes', kind: 'add', record: remoteTomb },
    ]);
    expect(res.conflicts).toEqual([]);
  });

  it('first sync (no base): equal → nothing, different → conflict', () => {
    const a = recipe();
    const same = mergeSnapshot(
      snap({ recipes: [a] }),
      snap({ recipes: [{ ...a, rev: 5 }] }),
      emptySnapshot(),
      opts,
    );
    expect(same.changes).toEqual([]);
    expect(same.conflicts).toEqual([]);

    const r = edit(a, { title: 'Other' });
    const diff = mergeSnapshot(
      snap({ recipes: [a] }),
      snap({ recipes: [r] }),
      emptySnapshot(),
      opts,
    );
    expect(diff.changes).toEqual([]);
    expect(diff.conflicts).toMatchObject([
      { reason: 'first-sync', fields: ['title'], local: a, remote: r },
    ]);
  });

  describe('tombstones', () => {
    const base = recipe();

    it('remote deleted, local unchanged → take the tombstone', () => {
      const r = tomb(base);
      const res = mergeSnapshot(
        snap({ recipes: [base] }),
        snap({ recipes: [r] }),
        snap({ recipes: [base] }),
        opts,
      );
      expect(res.changes).toEqual([{ entity: 'recipes', kind: 'take-remote', record: r }]);
    });

    it('local deleted, remote unchanged → stays deleted', () => {
      const l = tomb(base, 'dev-me');
      const res = mergeSnapshot(
        snap({ recipes: [l] }),
        snap({ recipes: [base] }),
        snap({ recipes: [base] }),
        opts,
      );
      expect(res.changes).toEqual([]);
      expect(res.conflicts).toEqual([]);
    });

    it('remote deleted + local edited → conflict', () => {
      const l = edit(base, { title: 'Edited' }, 'dev-me');
      const r = tomb(base);
      const res = mergeSnapshot(
        snap({ recipes: [l] }),
        snap({ recipes: [r] }),
        snap({ recipes: [base] }),
        opts,
      );
      expect(res.changes).toEqual([]);
      expect(res.conflicts).toMatchObject([{ reason: 'delete-edit', local: l, remote: r }]);
    });

    it('local deleted + remote edited → conflict', () => {
      const l = tomb(base, 'dev-me');
      const r = edit(base, { title: 'Edited' });
      const res = mergeSnapshot(
        snap({ recipes: [l] }),
        snap({ recipes: [r] }),
        snap({ recipes: [base] }),
        opts,
      );
      expect(res.conflicts).toMatchObject([{ reason: 'delete-edit', local: l, remote: r }]);
    });

    it('deleted on both sides → deleted, nothing to do', () => {
      const l = tomb(edit(base, { title: 'x' }, 'dev-me'), 'dev-me');
      const r = tomb(base);
      const res = mergeSnapshot(
        snap({ recipes: [l] }),
        snap({ recipes: [r] }),
        snap({ recipes: [base] }),
        opts,
      );
      expect(res.changes).toEqual([]);
      expect(res.conflicts).toEqual([]);
      expect(res.outcomes[0]?.outcome).toBe('same');
    });

    it('first sync: tombstone vs alive → conflict', () => {
      const res = mergeSnapshot(
        snap({ recipes: [base] }),
        snap({ recipes: [tomb(base)] }),
        emptySnapshot(),
        opts,
      );
      expect(res.conflicts).toMatchObject([{ reason: 'first-sync' }]);
    });
  });

  it('categories and tags merge the same way', () => {
    const cat: Category = {
      id: 'c1',
      createdAt: T0,
      updatedAt: T0,
      deviceId: 'a',
      rev: 1,
      name: 'Soups',
      order: 1,
    };
    const tag: Tag = {
      id: 't1',
      createdAt: T0,
      updatedAt: T0,
      deviceId: 'a',
      rev: 1,
      name: 'vegan',
    };
    const tag2: Tag = { ...tag, id: 't2', name: 'quick' };
    const local = snap({
      categories: [edit(cat, { name: 'Zupy' }, 'dev-me')],
      tags: [edit(tag, { name: 'Vegan' }, 'dev-me'), tag2],
    });
    const remote = snap({
      categories: [edit(cat, { order: 5 })],
      tags: [edit(tag, { name: 'wegańskie' }), tomb(tag2)],
    });
    const base = snap({ categories: [cat], tags: [tag, tag2] });
    const res = mergeSnapshot(local, remote, base, opts);
    expect(res.changes).toEqual([
      {
        entity: 'categories',
        kind: 'combine',
        record: { ...cat, name: 'Zupy', order: 5, rev: 3, deviceId: 'dev-me', updatedAt: NOW },
      },
      { entity: 'tags', kind: 'take-remote', record: remote.tags[1] },
    ]);
    expect(res.conflicts).toMatchObject([{ entity: 'tags', recordId: 't1', fields: ['name'] }]);
  });

  it('without options, combined records keep local deviceId/updatedAt (applyMerge restamps)', () => {
    const base = recipe();
    const l = edit(base, { title: 'A' }, 'dev-me');
    const r = edit(base, { servings: 3 });
    const res = mergeSnapshot(
      snap({ recipes: [l] }),
      snap({ recipes: [r] }),
      snap({ recipes: [base] }),
    );
    expect(res.changes[0]!.record).toMatchObject({
      deviceId: 'dev-me',
      updatedAt: l.updatedAt,
      rev: 3,
    });
  });

  it('does not mutate its inputs', () => {
    const base = recipe();
    const l = edit(base, { title: 'A' }, 'dev-me');
    const r = edit(base, { servings: 3 });
    const input = { l: structuredClone(l), r: structuredClone(r), base: structuredClone(base) };
    mergeSnapshot(snap({ recipes: [l] }), snap({ recipes: [r] }), snap({ recipes: [base] }), opts);
    expect({ l, r, base }).toEqual(input);
  });
});
