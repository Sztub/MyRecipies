import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { categories, recipes, tags } from '../../db';
import { categoryName, t } from '../../i18n';
import { matchesRecipe, queryTokens } from '../../domain/search';
import { RECIPE_SORTS, SearchBox, filterFavourites, sortRecipes, type RecipeSort } from '../search';
import { cookedAgoLabel } from './cookedLabel';
import styles from './recipes.module.css';
import { useLoad } from './useLoad';

export function RecipeListPage() {
  const { data } = useLoad(async () => {
    const [r, c, tg] = await Promise.all([recipes.list(), categories.list(), tags.list()]);
    return { r, c, tg };
  });
  const [categoryId, setCategoryId] = useState<string>('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [onlyFav, setOnlyFav] = useState(false);
  const [sort, setSort] = useState<RecipeSort>('default');

  const groups = useMemo(() => {
    if (!data) return [];
    const tokens = queryTokens(query);
    const tagName = new Map(data.tg.map((x) => [x.id, x.name]));
    const catName = new Map(data.c.map((c) => [c.id, categoryName(c)]));
    const filtered = filterFavourites(data.r, onlyFav).filter(
      (rec) =>
        (!categoryId || rec.categoryId === categoryId) &&
        tagIds.every((id) => rec.tagIds.includes(id)) &&
        matchesRecipe(
          rec,
          [
            ...rec.tagIds.map((id) => tagName.get(id) ?? ''),
            (rec.categoryId && catName.get(rec.categoryId)) || '',
          ],
          tokens,
        ),
    );
    if (sort !== 'default') {
      const flat = sortRecipes(filtered, sort);
      return flat.length ? [{ key: 'sorted', name: t(`recipes.sort.${sort}`), items: flat }] : [];
    }
    const known = new Set(data.c.map((c) => c.id));
    const out = data.c
      .map((c) => ({
        key: c.id,
        name: categoryName(c),
        items: filtered.filter((r) => r.categoryId === c.id),
      }))
      .filter((g) => g.items.length > 0);
    const rest = filtered.filter((r) => !r.categoryId || !known.has(r.categoryId));
    if (rest.length) out.push({ key: 'none', name: t('recipes.uncategorized'), items: rest });
    return out;
  }, [data, categoryId, tagIds, query, onlyFav, sort]);

  const toggleTag = (id: string) =>
    setTagIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <section className={styles.page}>
      <h2 className={styles.heading}>{t('recipes.title')}</h2>
      <SearchBox value={query} onChange={setQuery} />

      {data && data.c.length > 0 && (
        <div role="group" aria-label={t('recipes.filter.category')} className={styles.row}>
          <button
            type="button"
            className={`${styles.chip} ${categoryId === '' ? styles.chipOn : ''}`}
            aria-pressed={categoryId === ''}
            onClick={() => setCategoryId('')}
          >
            {t('recipes.filter.all')}
          </button>
          {data.c.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`${styles.chip} ${categoryId === c.id ? styles.chipOn : ''}`}
              aria-pressed={categoryId === c.id}
              onClick={() => setCategoryId(categoryId === c.id ? '' : c.id)}
            >
              {categoryName(c)}
            </button>
          ))}
        </div>
      )}
      {data && data.r.length > 0 && (
        <div className={styles.row}>
          <button
            type="button"
            className={`${styles.chip} ${onlyFav ? styles.chipOn : ''}`}
            aria-pressed={onlyFav}
            onClick={() => setOnlyFav((v) => !v)}
          >
            <span aria-hidden="true">♥</span>&nbsp;{t('recipes.filter.favourites')}
          </button>
          <label className={styles.row}>
            <span className={styles.muted}>{t('recipes.sort')}</span>
            <select
              className={styles.chip}
              value={sort}
              onChange={(e) => setSort(e.target.value as RecipeSort)}
            >
              {RECIPE_SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`recipes.sort.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {data && data.tg.length > 0 && (
        <div role="group" aria-label={t('recipes.filter.tags')} className={styles.row}>
          {data.tg.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className={`${styles.chip} ${tagIds.includes(tag.id) ? styles.chipOn : ''}`}
              aria-pressed={tagIds.includes(tag.id)}
              onClick={() => toggleTag(tag.id)}
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}

      {!data && <p className={styles.muted}>{t('recipes.loading')}</p>}
      {data && data.r.length === 0 && (
        <>
          <p className={styles.muted}>{t('recipes.empty')}</p>
          <Link
            to="/recipes/new"
            className={`${styles.linkBtn} ${styles.primary}`}
            style={{ alignSelf: 'flex-start' }}
          >
            {t('recipes.new')}
          </Link>
        </>
      )}
      {data && data.r.length > 0 && (
        <p className={styles.muted}>{t('recipes.recipeCount', { count: data.r.length })}</p>
      )}
      {data && data.r.length > 0 && groups.length === 0 && (
        <p className={styles.muted}>{t('recipes.noResults')}</p>
      )}
      {groups.map((g) => (
        <section key={g.key} aria-label={g.name}>
          <h3 className={styles.sectionHeading} data-ui="section-heading">
            {g.name}
          </h3>
          <ul className={styles.list}>
            {g.items.map((r) => (
              <li key={r.id}>
                <Link to={`/recipes/${r.id}`} className={styles.card}>
                  {r.title}
                  {(r.favourite || r.rating || r.lastCookedAt) && (
                    <span className={styles.cardMeta} aria-hidden="true">
                      {[
                        r.favourite ? '♥' : '',
                        r.rating ? '★'.repeat(r.rating) : '',
                        cookedAgoLabel(r.lastCookedAt) ?? '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
