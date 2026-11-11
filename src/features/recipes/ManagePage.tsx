import { useState } from 'react';
import { Link } from 'react-router-dom';
import { categories, recipes, tags, type SyncRepo } from '../../db';
import type { Category, SyncMeta, Tag } from '../../domain/types';
import { categoryName as label, t } from '../../i18n';
import styles from './recipes.module.css';
import { useLoad } from './useLoad';

interface Named extends SyncMeta {
  name: string;
}

interface SectionProps<T extends Named> {
  heading: string;
  newLabel: string;
  items: T[];
  onAdd: (name: string) => Promise<void>;
  onRename: (item: T, name: string) => Promise<void>;
  onDelete: (item: T) => Promise<void>;
}

function Section<T extends Named>({
  heading,
  newLabel,
  items,
  onAdd,
  onRename,
  onDelete,
}: SectionProps<T>) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<'manage.nameRequired' | 'manage.exists' | null>(null);

  const check = (value: string, selfId?: string) => {
    const v = value.trim();
    if (!v) return 'manage.nameRequired' as const;
    if (items.some((i) => i.id !== selfId && label(i).toLowerCase() === v.toLowerCase())) {
      return 'manage.exists' as const;
    }
    return null;
  };

  return (
    <section aria-label={heading} className={styles.page}>
      <h3 className={styles.sectionHeading}>{heading}</h3>
      <form
        className={styles.row}
        onSubmit={async (e) => {
          e.preventDefault();
          const problem = check(name);
          setError(problem);
          if (problem) return;
          await onAdd(name.trim());
          setName('');
        }}
      >
        <input
          className={styles.input}
          style={{ flex: 1 }}
          aria-label={newLabel}
          placeholder={newLabel}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className={`${styles.btn} ${styles.primary}`}>
          {t('manage.add')}
        </button>
      </form>
      {error && !editing && (
        <p className={styles.error} role="alert">
          {t(error)}
        </p>
      )}
      {items.length === 0 && <p className={styles.muted}>{t('manage.empty')}</p>}
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.id} className={styles.group}>
            {editing === item.id ? (
              <form
                className={styles.row}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const problem = check(editName, item.id);
                  setError(problem);
                  if (problem) return;
                  // Unchanged default name: keep the i18n key so it still follows the language.
                  if (editName.trim() !== label(item)) await onRename(item, editName.trim());
                  setEditing(null);
                }}
              >
                <input
                  className={styles.input}
                  style={{ flex: 1 }}
                  aria-label={`${t('manage.rename')} ${label(item)}`}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
                <button type="submit" className={`${styles.btn} ${styles.primary}`}>
                  {t('manage.save')}
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => {
                    setEditing(null);
                    setError(null);
                  }}
                >
                  {t('manage.cancel')}
                </button>
                {error && (
                  <p className={styles.error} role="alert">
                    {t(error)}
                  </p>
                )}
              </form>
            ) : (
              <div className={styles.row}>
                <span style={{ flex: 1 }}>{label(item)}</span>
                <button
                  type="button"
                  className={styles.btn}
                  aria-label={`${t('manage.rename')} ${label(item)}`}
                  onClick={() => {
                    setEditing(item.id);
                    setEditName(label(item));
                    setError(null);
                  }}
                >
                  {t('manage.rename')}
                </button>
                {deleting === item.id ? (
                  <>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.danger}`}
                      onClick={async () => {
                        await onDelete(item);
                        setDeleting(null);
                      }}
                    >
                      {t('manage.deleteYes')} {label(item)}
                    </button>
                    <button type="button" className={styles.btn} onClick={() => setDeleting(null)}>
                      {t('manage.cancel')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.danger}`}
                    aria-label={`${t('manage.delete')} ${label(item)}`}
                    onClick={() => setDeleting(item.id)}
                  >
                    {t('manage.delete')}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ManagePage() {
  const { data, reload } = useLoad(async () => {
    const [c, tg] = await Promise.all([categories.list(), tags.list()]);
    return { c, tg };
  });

  const renameIn = async <T extends Named>(repo: SyncRepo<T>, item: T, name: string) => {
    await repo.save({ ...item, name });
    await reload();
  };

  return (
    <section className={styles.page}>
      <Link to="/" className={styles.linkBtn} style={{ alignSelf: 'flex-start' }}>
        {t('manage.back')}
      </Link>
      <h2 className={styles.heading}>{t('manage.title')}</h2>
      {data && (
        <>
          <Section<Category>
            heading={t('manage.categories')}
            newLabel={t('manage.newCategory')}
            items={data.c}
            onAdd={async (name) => {
              const order = data.c.reduce((m, c) => Math.max(m, c.order), 0) + 1;
              await categories.save({ name, order });
              await reload();
            }}
            onRename={(item, name) => renameIn(categories, item, name)}
            onDelete={async (item) => {
              // Recipes keep working: the list shows them under "No category".
              await categories.softDelete(item.id);
              await reload();
            }}
          />
          <Section<Tag>
            heading={t('manage.tags')}
            newLabel={t('manage.newTag')}
            items={data.tg}
            onAdd={async (name) => {
              await tags.save({ name });
              await reload();
            }}
            onRename={(item, name) => renameIn(tags, item, name)}
            onDelete={async (item) => {
              // Remove the tag from recipes too so no dangling references remain.
              const all = await recipes.list();
              for (const r of all.filter((x) => x.tagIds.includes(item.id))) {
                await recipes.save({ ...r, tagIds: r.tagIds.filter((id) => id !== item.id) });
              }
              await tags.softDelete(item.id);
              await reload();
            }}
          />
        </>
      )}
    </section>
  );
}
