import { cookedAgo } from '../../domain/cooked';
import { t } from '../../i18n';

/** "today", "yesterday", "3 weeks ago" … in the UI language; undefined when never cooked. */
export function cookedAgoLabel(lastCookedAt: string | undefined, now?: Date): string | undefined {
  const ago = cookedAgo(lastCookedAt, now);
  if (!ago) return undefined;
  switch (ago.unit) {
    case 'today':
      return t('cooked.ago.today');
    case 'yesterday':
      return t('cooked.ago.yesterday');
    case 'days':
      return t('cooked.ago.days', { count: ago.count });
    case 'weeks':
      return t('cooked.ago.weeks', { count: ago.count });
    case 'months':
      return t('cooked.ago.months', { count: ago.count });
    case 'years':
      return t('cooked.ago.years', { count: ago.count });
  }
}
