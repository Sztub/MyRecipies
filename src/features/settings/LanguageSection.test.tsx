import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../app/App';
import { categories, initDb, recipes, resetDb } from '../../db';
import { LANGUAGE_STORAGE_KEY, initI18n, resetI18nForTests } from '../../i18n';

beforeEach(async () => {
  localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  resetI18nForTests('pl'); // the app default
  await resetDb();
  await initDb();
});

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

describe('language (PL default)', () => {
  it('shows Polish by default and switches to English, persisting the choice', async () => {
    renderAt('/settings');
    expect(await screen.findByRole('heading', { level: 2, name: 'Ustawienia' })).toBeInTheDocument();
    const select = screen.getByLabelText('Język aplikacji');
    expect(select).toHaveValue('pl');

    await userEvent.selectOptions(select, 'en');
    expect(await screen.findByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Recipes' })).toBeInTheDocument();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');

    // "Reload": a fresh start reads the saved choice.
    resetI18nForTests('pl');
    expect(initI18n()).toBe('en');
  });

  it('shows default categories, counts and units in Polish; renamed categories keep their name', async () => {
    const cats = await categories.list();
    await categories.save({ ...cats[2]!, name: 'Słodkości' });
    const r = await recipes.save({
      title: 'Naleśniki',
      categoryId: cats[1]!.id,
      tagIds: [],
      servings: 5,
      ingredients: [
        { id: crypto.randomUUID(), name: 'mąki', amount: 2, unit: 'glass' },
        { id: crypto.randomUUID(), name: 'cukru', amount: 5, unit: 'tbsp' },
        { id: crypto.randomUUID(), name: 'mleka', amount: 1.5, unit: 'glass' },
      ],
      steps: [],
      photoHashes: [],
    });
    await recipes.save({ title: 'Placki', tagIds: [], ingredients: [], steps: [], photoHashes: [] });

    const view = renderAt('/');
    const chips = await screen.findByRole('group', { name: 'Kategoria' });
    expect(within(chips).getByRole('button', { name: 'Zupy' })).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: 'Słodkości' })).toBeInTheDocument();
    expect(screen.getByText('2 przepisy')).toBeInTheDocument();
    view.unmount();

    renderAt(`/recipes/${r.id}`);
    expect(await screen.findByRole('heading', { name: 'Naleśniki' })).toBeInTheDocument();
    expect(screen.getByText('Zupy')).toBeInTheDocument();
    expect(screen.getByText('5 porcji')).toBeInTheDocument();
    expect(screen.getByText('2 szklanki mąki')).toBeInTheDocument();
    expect(screen.getByText('5 łyżek cukru')).toBeInTheDocument();
    expect(screen.getByText('1,5 szklanki mleka')).toBeInTheDocument();
  });
});
