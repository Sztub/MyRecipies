import { photos, recipes, seedDefaults, tags } from '../db';
import { DEFAULT_CATEGORIES } from '../domain/defaults';
import type { Ingredient, Photo, Recipe, Unit } from '../domain/types';
import { sha256Hex } from '../lib/image';

/** Dev-only sample data (Polish). Never imported in production builds. */

const catId = (slug: string) => DEFAULT_CATEGORIES.find((c) => c.slug === slug)!.id;

/** Deterministic UUID-shaped id: stable across loads, so loading twice never duplicates. */
const sid = (kind: number, n: number) =>
  `5a3b1e00-0000-4000-8000-${kind.toString(16).padStart(4, '0')}${n.toString(16).padStart(8, '0')}`;

const TAGS = [
  { id: sid(1, 1), name: 'tradycyjne' },
  { id: sid(1, 2), name: 'szybkie' },
  { id: sid(1, 3), name: 'wegetariańskie' },
  { id: sid(1, 4), name: 'obiad' },
  { id: sid(1, 5), name: 'święta' },
];

type Ing = [name: string, amount?: number, unit?: Unit, extra?: { unitText?: string; note?: string }];

interface Def {
  key: number;
  title: string;
  category: string;
  tags: number[];
  servings?: number;
  notes?: string;
  ingredients: Ing[];
  steps: string[];
  color: string;
}

const DEFS: Def[] = [
  {
    key: 1,
    title: 'Pierogi ruskie',
    category: 'mains',
    tags: [1, 3, 4],
    servings: 6,
    notes: 'Ciasto warto odstawić pod miską na 20 minut.',
    color: '#c9a66b',
    ingredients: [
      ['Mąka pszenna', 500, 'g'],
      ['Woda ciepła', 1, 'glass'],
      ['Ziemniaki', 600, 'g'],
      ['Twaróg', 250, 'g'],
      ['Cebula', 2, 'pcs'],
      ['Sól', undefined, 'pinch'],
      ['Pieprz', undefined, 'to_taste'],
      ['Masło do podania', 1, 'other', { unitText: 'kostka', note: 'do smażenia cebulki' }],
    ],
    steps: [
      'Zagnieć ciasto z mąki, ciepłej wody i szczypty soli.',
      'Ugotuj ziemniaki, przeciśnij je i wymieszaj z twarogiem i podsmażoną cebulą.',
      'Rozwałkuj ciasto, wykrój kółka, nałóż farsz i zlep brzegi.',
      'Gotuj w osolonej wodzie 3 minuty od wypłynięcia.',
    ],
  },
  {
    key: 2,
    title: 'Żurek',
    category: 'soups',
    tags: [1, 5],
    servings: 6,
    color: '#d8d0a8',
    ingredients: [
      ['Zakwas na żurek', 500, 'ml'],
      ['Biała kiełbasa', 400, 'g'],
      ['Wywar mięsny', 1.5, 'l'],
      ['Jajka', 4, 'pcs'],
      ['Majeranek', 1, 'tsp'],
      ['Czosnek', 3, 'other', { unitText: 'ząbki' }],
      ['Śmietana', 3, 'tbsp'],
    ],
    steps: [
      'Zagotuj wywar, dodaj kiełbasę i gotuj 20 minut.',
      'Wlej zakwas, dopraw majerankiem i czosnkiem.',
      'Zabiel śmietaną i podaj z jajkiem na twardo.',
    ],
  },
  {
    key: 3,
    title: 'Kotlet schabowy',
    category: 'mains',
    tags: [1, 4],
    servings: 4,
    color: '#b88a4a',
    ingredients: [
      ['Schab bez kości', 600, 'g'],
      ['Jajko', 2, 'pcs'],
      ['Bułka tarta', 150, 'g'],
      ['Mąka', 3, 'tbsp'],
      ['Smalec lub olej', 200, 'ml', { note: 'do smażenia' }],
      ['Sól i pieprz', undefined, 'to_taste'],
    ],
    steps: [
      'Pokrój schab na plastry i rozbij tłuczkiem.',
      'Oprósz solą i pieprzem, obtocz w mące, jajku i bułce tartej.',
      'Smaż na złoty kolor po 3–4 minuty z każdej strony.',
    ],
  },
  {
    key: 4,
    title: 'Placki ziemniaczane',
    category: 'mains',
    tags: [2, 3],
    servings: 4,
    color: '#caa05a',
    ingredients: [
      ['Ziemniaki', 1, 'kg'],
      ['Cebula', 1, 'pcs'],
      ['Jajko', 1, 'pcs'],
      ['Mąka', 3, 'tbsp'],
      ['Sól', 1, 'tsp'],
      ['Olej do smażenia', 100, 'ml'],
    ],
    steps: [
      'Zetrzyj ziemniaki i cebulę na drobnej tarce, odciśnij nadmiar soku.',
      'Dodaj jajko, mąkę i sól, wymieszaj.',
      'Smaż małe placki na rozgrzanym oleju do zarumienienia.',
    ],
  },
  {
    key: 5,
    title: 'Sernik na zimno',
    category: 'desserts',
    tags: [5],
    servings: 10,
    notes: 'Najlepszy po nocy w lodówce.',
    color: '#efe0b8',
    ingredients: [
      ['Twaróg sernikowy', 1, 'kg'],
      ['Cukier puder', 150, 'g'],
      ['Żelatyna', 2, 'tbsp'],
      ['Śmietanka 30%', 400, 'ml'],
      ['Herbatniki', 250, 'g'],
      ['Masło', 100, 'g'],
      ['Owoce do dekoracji', 1, 'other', { unitText: 'garść' }],
    ],
    steps: [
      'Pokrusz herbatniki, wymieszaj z roztopionym masłem i wyłóż spód formy.',
      'Utrzyj twaróg z cukrem, dodaj rozpuszczoną żelatynę i ubitą śmietankę.',
      'Wyłóż masę na spód i schładzaj minimum 4 godziny.',
    ],
  },
  {
    key: 6,
    title: 'Mizeria',
    category: 'salads',
    tags: [2, 3],
    servings: 4,
    color: '#a9c58a',
    ingredients: [
      ['Ogórki', 4, 'pcs'],
      ['Śmietana 18%', 150, 'ml'],
      ['Koperek', 1, 'tbsp'],
      ['Sól', undefined, 'pinch'],
      ['Cukier', undefined, 'to_taste'],
    ],
    steps: [
      'Pokrój ogórki w cienkie plasterki i lekko posól.',
      'Wymieszaj ze śmietaną i posiekanym koperkiem, dopraw do smaku.',
    ],
  },
];

/** Tiny SVG placeholder (deterministic, so the hash is stable). */
function placeholder(title: string, color: string): Blob {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">` +
    `<rect width="400" height="300" fill="${color}"/>` +
    `<circle cx="200" cy="150" r="80" fill="#ffffff" fill-opacity="0.45"/>` +
    `<text x="200" y="285" font-size="22" text-anchor="middle" fill="#333333">${title}</text></svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

/** Titles of the sample recipes. */
export const SAMPLE_TITLES: readonly string[] = DEFS.map((d) => d.title);

/**
 * Loads the sample recipes, tags and placeholder photos. Idempotent: fixed IDs, and records that
 * already exist (possibly edited by the user) are left untouched.
 * @returns number of recipes newly added
 */
export async function loadSampleRecipes(): Promise<number> {
  await seedDefaults();
  for (const tag of TAGS) {
    if (!(await tags.get(tag.id, { includeDeleted: true }))) await tags.save(tag);
  }
  let added = 0;
  for (const def of DEFS) {
    const id = sid(2, def.key);
    if (await recipes.get(id, { includeDeleted: true })) continue;
    const blob = placeholder(def.title, def.color);
    const hash = await sha256Hex(blob);
    const photo: Photo = {
      hash,
      mime: 'image/svg+xml',
      width: 400,
      height: 300,
      size: blob.size,
      blob,
      createdAt: new Date().toISOString(),
    };
    await photos.put(photo);
    const ingredients: Ingredient[] = def.ingredients.map(([name, amount, unit, extra], i) => ({
      id: sid(3, def.key * 100 + i),
      name,
      ...(amount !== undefined ? { amount } : {}),
      ...(unit ? { unit } : {}),
      ...extra,
    }));
    const draft: Omit<Recipe, 'createdAt' | 'updatedAt' | 'deviceId' | 'rev'> = {
      id,
      title: def.title,
      categoryId: catId(def.category),
      tagIds: def.tags.map((n) => TAGS[n - 1]!.id),
      ingredients,
      steps: def.steps.map((text, i) => ({ id: sid(4, def.key * 100 + i), text })),
      ...(def.servings !== undefined ? { servings: def.servings } : {}),
      ...(def.notes ? { notes: def.notes } : {}),
      photoHashes: [hash],
    };
    await recipes.save(draft);
    added++;
  }
  return added;
}
