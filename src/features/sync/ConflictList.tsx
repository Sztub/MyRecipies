import { liveQuery } from 'dexie';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { db } from '../../db';
import type { Category, Ingredient, Step, Tag } from '../../domain/types';
import { categoryName, t, type StringKey } from '../../i18n';
import { listConflicts, resolveConflict, type AnyRecord, type SyncConflict } from '../../lib/sync';
import { formatIngredient } from '../recipes/formatIngredient';
import { TEXT_FIELDS, buildEdited, differingFields, isDeleteConflict, type FieldChoice } from './diff';
import { peerLabel } from './SyncNow';
import styles from './sync.module.css';

const FIELD_KEYS: Record<string, StringKey> = {
  title: 'sync.field.title',
  name: 'sync.field.name',
  categoryId: 'sync.field.categoryId',
  tagIds: 'sync.field.tagIds',
  servings: 'sync.field.servings',
  ingredients: 'sync.field.ingredients',
  steps: 'sync.field.steps',
  notes: 'sync.field.notes',
  photoHashes: 'sync.field.photoHashes',
  favourite: 'sync.field.favourite',
  rating: 'sync.field.rating',
  lastCookedAt: 'sync.field.lastCookedAt',
  order: 'sync.field.order',
};

const ENTITY_KEYS: Record<SyncConflict['entity'], StringKey> = {
  recipes: 'sync.entity.recipes',
  categories: 'sync.entity.categories',
  tags: 'sync.entity.tags',
};

interface Names {
  tags: Map<string, string>;
  categories: Map<string, string>;
}

function fieldLabel(field: string): string {
  const key = FIELD_KEYS[field];
  return key ? t(key) : field;
}

function recordTitle(r: AnyRecord): string {
  if ('title' in r) return r.title;
  if ('order' in r) return categoryName(r as Category);
  return (r as Tag).name;
}

function renderValue(field: string, value: unknown, names: Names): ReactNode {
  const empty = <span className={styles.muted}>{t('sync.conflict.empty')}</span>;
  if (value === undefined || value === null || value === '') return empty;
  switch (field) {
    case 'ingredients': {
      const list = value as Ingredient[];
      if (!list.length) return empty;
      return (
        <ul className={styles.valueList}>
          {list.map((i) => (
            <li key={i.id}>{formatIngredient(i)}</li>
          ))}
        </ul>
      );
    }
    case 'steps': {
      const list = value as Step[];
      if (!list.length) return empty;
      return (
        <ol className={styles.valueList}>
          {list.map((s) => (
            <li key={s.id}>{s.text}</li>
          ))}
        </ol>
      );
    }
    case 'tagIds': {
      const ids = value as string[];
      if (!ids.length) return empty;
      return ids.map((id) => names.tags.get(id) ?? '?').join(', ');
    }
    case 'categoryId':
      return names.categories.get(value as string) ?? '?';
    case 'photoHashes':
      return t('sync.field.photoCount', { count: (value as string[]).length });
    default:
      if (typeof value === 'string') return <span className={styles.preWrap}>{value}</span>;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return JSON.stringify(value);
  }
}

function useNames(): Names {
  const [names, setNames] = useState<Names>({ tags: new Map(), categories: new Map() });
  useEffect(() => {
    const sub = liveQuery(async () => ({
      tags: new Map((await db.tags.toArray()).map((x) => [x.id, x.name])),
      categories: new Map((await db.categories.toArray()).map((x) => [x.id, categoryName(x)])),
    })).subscribe({ next: setNames, error: () => {} });
    return () => sub.unsubscribe();
  }, []);
  return names;
}

function ConflictCard({ conflict, names }: { conflict: SyncConflict; names: Names }) {
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const { local, remote } = conflict;
  const deletion = isDeleteConflict(local, remote);
  const fields = deletion ? [] : differingFields(local, remote);
  const [choices, setChoices] = useState<Record<string, FieldChoice>>({});
  const theirs = peerLabel({ peerId: conflict.peerId, name: conflict.peerName });
  const shown = local.deleted ? remote : local;

  async function resolve(choice: 'mine' | 'theirs' | AnyRecord) {
    setBusy(true);
    setFailed(false);
    try {
      await resolveConflict(conflict.id, choice);
      // The live list drops this card.
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  function choose(field: string, c: FieldChoice) {
    setChoices((cur) => ({ ...cur, [field]: c }));
  }

  function startEdit() {
    const init: Record<string, FieldChoice> = {};
    const l = local as unknown as Record<string, unknown>;
    for (const f of fields) {
      init[f] = TEXT_FIELDS.has(f) ? { from: 'mine', text: String(l[f] ?? '') } : { from: 'mine' };
    }
    setChoices(init);
    setEditing(true);
  }

  return (
    <li className={styles.card} aria-labelledby={`${uid}-t`} data-testid="conflict">
      <h4 id={`${uid}-t`} className={styles.cardTitle}>
        <span className={styles.muted}>{t(ENTITY_KEYS[conflict.entity])}:</span> {recordTitle(shown)}
      </h4>
      <p className={styles.hint}>{t('sync.conflict.from', { name: theirs })}</p>

      <div className={styles.compare} role="table" aria-label={t('sync.conflict.compare')}>
        <div className={styles.compareHead} role="row">
          <span role="columnheader" className={styles.fieldName} />
          <span role="columnheader">{t('sync.conflict.mine')}</span>
          <span role="columnheader">{t('sync.conflict.theirs', { name: theirs })}</span>
        </div>
        {deletion ? (
          <div className={styles.compareRow} role="row">
            <span role="rowheader" className={styles.fieldName}>
              {t('sync.field.status')}
            </span>
            <span role="cell">{local.deleted ? t('sync.conflict.deleted') : t('sync.conflict.exists')}</span>
            <span role="cell">{remote.deleted ? t('sync.conflict.deleted') : t('sync.conflict.exists')}</span>
          </div>
        ) : (
          fields.map((f) => {
            const lv = (local as unknown as Record<string, unknown>)[f];
            const rv = (remote as unknown as Record<string, unknown>)[f];
            const c = choices[f];
            return (
              <div className={styles.compareRow} role="row" key={f} data-field={f}>
                <span role="rowheader" className={styles.fieldName}>
                  {fieldLabel(f)}
                </span>
                <span role="cell" className={styles.value}>
                  {renderValue(f, lv, names)}
                </span>
                <span role="cell" className={styles.value}>
                  {renderValue(f, rv, names)}
                </span>
                {editing && c && (
                  <fieldset className={styles.editRow}>
                    <legend className={styles.srOnly}>{fieldLabel(f)}</legend>
                    <label className={styles.radio}>
                      <input
                        type="radio"
                        name={`${uid}-${f}`}
                        checked={c.from === 'mine'}
                        onChange={() =>
                          choose(f, TEXT_FIELDS.has(f) ? { from: 'mine', text: String(lv ?? '') } : { from: 'mine' })
                        }
                      />
                      {t('sync.conflict.useMine')}
                    </label>
                    <label className={styles.radio}>
                      <input
                        type="radio"
                        name={`${uid}-${f}`}
                        checked={c.from === 'theirs'}
                        onChange={() =>
                          choose(
                            f,
                            TEXT_FIELDS.has(f) ? { from: 'theirs', text: String(rv ?? '') } : { from: 'theirs' },
                          )
                        }
                      />
                      {t('sync.conflict.useTheirs')}
                    </label>
                    {TEXT_FIELDS.has(f) && (
                      <label className={styles.editText}>
                        <span className={styles.srOnly}>
                          {t('sync.conflict.editField', { field: fieldLabel(f) })}
                        </span>
                        {f === 'notes' ? (
                          <textarea
                            value={c.text ?? ''}
                            onChange={(e) => choose(f, { ...c, text: e.target.value })}
                            rows={3}
                          />
                        ) : (
                          <input
                            value={c.text ?? ''}
                            onChange={(e) => choose(f, { ...c, text: e.target.value })}
                          />
                        )}
                      </label>
                    )}
                  </fieldset>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className={styles.actions}>
        {editing ? (
          <>
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => void resolve(buildEdited(local, remote, choices))}
            >
              {t('sync.conflict.save')}
            </button>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => setEditing(false)}>
              {t('sync.conflict.cancel')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={styles.primary} disabled={busy} onClick={() => void resolve('mine')}>
              {t('sync.conflict.keepMine')}
            </button>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => void resolve('theirs')}>
              {t('sync.conflict.keepTheirs')}
            </button>
            {!deletion && fields.length > 0 && (
              <button type="button" className={styles.secondary} disabled={busy} onClick={startEdit}>
                {t('sync.conflict.edit')}
              </button>
            )}
          </>
        )}
      </div>
      {failed && (
        <p className={styles.error} role="alert">
          {t('sync.conflict.failed')}
        </p>
      )}
    </li>
  );
}

/** Open conflicts with side-by-side "mine / theirs" per field. Updates live. */
export function ConflictList() {
  const [conflicts, setConflicts] = useState<SyncConflict[] | null>(null);
  const [resolvedSome, setResolvedSome] = useState(false);
  const names = useNames();
  useEffect(() => {
    let prev = -1;
    const sub = liveQuery(() => listConflicts()).subscribe({
      next: (list) => {
        if (prev > list.length) setResolvedSome(true);
        prev = list.length;
        setConflicts(list);
      },
      error: () => setConflicts([]),
    });
    return () => sub.unsubscribe();
  }, []);

  if (conflicts === null) return <p role="status">{t('backup.loading')}</p>;
  return (
    <>
      {resolvedSome && (
        <p className={styles.ok} role="status">
          {t('sync.conflict.resolved')}
        </p>
      )}
      {conflicts.length === 0 ? (
        <p className={styles.hint} data-testid="no-conflicts">
          {t('sync.conflicts.none')}
        </p>
      ) : (
        <>
          <p className={styles.hint}>{t('sync.conflicts.hint')}</p>
          <ul className={styles.cards}>
            {conflicts.map((c) => (
              <ConflictCard key={c.id} conflict={c} names={names} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
