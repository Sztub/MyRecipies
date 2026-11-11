import type { StringKey } from '../i18n';
import type { UUID } from './types';

export interface DefaultCategory {
  /** Fixed UUID so every device seeds the same IDs (avoids duplicates on a later sync/merge). */
  id: UUID;
  slug: 'mains' | 'soups' | 'desserts' | 'baking' | 'preserves' | 'salads' | 'other';
  nameKey: StringKey;
  order: number;
}

export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  {
    id: '0b6f6c1e-0000-4000-8000-000000000001',
    slug: 'mains',
    nameKey: 'category.mains',
    order: 1,
  },
  {
    id: '0b6f6c1e-0000-4000-8000-000000000002',
    slug: 'soups',
    nameKey: 'category.soups',
    order: 2,
  },
  {
    id: '0b6f6c1e-0000-4000-8000-000000000003',
    slug: 'desserts',
    nameKey: 'category.desserts',
    order: 3,
  },
  {
    id: '0b6f6c1e-0000-4000-8000-000000000004',
    slug: 'baking',
    nameKey: 'category.baking',
    order: 4,
  },
  {
    id: '0b6f6c1e-0000-4000-8000-000000000005',
    slug: 'preserves',
    nameKey: 'category.preserves',
    order: 5,
  },
  {
    id: '0b6f6c1e-0000-4000-8000-000000000006',
    slug: 'salads',
    nameKey: 'category.salads',
    order: 6,
  },
  {
    id: '0b6f6c1e-0000-4000-8000-000000000007',
    slug: 'other',
    nameKey: 'category.other',
    order: 7,
  },
];
