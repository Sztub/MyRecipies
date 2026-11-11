import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routes } from '../../app/routes';
import { initDb, recipes, resetDb } from '../../db';
import { todayIso } from '../../domain/cooked';

async function make(over: Record<string, unknown> = {}) {
  return recipes.save({
    title: 'Rosół',
    tagIds: [],
    photoHashes: [],
    ingredients: [],
    steps: [{ id: 's1', text: 'Boil' }],
    ...over,
  });
}
function open(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

beforeEach(async () => {
  await resetDb();
  await initDb();
});

describe('favourite / rating / last cooked on the detail page', () => {
  it('toggles favourite, sets and clears a rating, marks cooked today', async () => {
    const r = await make();
    open(`/recipes/${r.id}`);
    await userEvent.click(await screen.findByRole('button', { name: /Favourite/ }));
    expect((await recipes.get(r.id))?.favourite).toBe(true);

    await userEvent.click(await screen.findByRole('radio', { name: 'Rate 4 out of 5' }));
    expect((await recipes.get(r.id))?.rating).toBe(4);
    await userEvent.click(await screen.findByRole('radio', { name: 'Rate 4 out of 5' }));
    expect(await recipes.get(r.id)).not.toHaveProperty('rating');

    await userEvent.click(screen.getByRole('button', { name: 'I cooked this today' }));
    expect((await recipes.get(r.id))?.lastCookedAt).toBe(todayIso());
    expect(await screen.findByTestId('last-cooked')).toHaveTextContent('Last cooked: today');

    await userEvent.click(screen.getByRole('button', { name: /Favourite/ }));
    expect(await recipes.get(r.id)).not.toHaveProperty('favourite');
  });

  it('editing a recipe keeps favourite, rating and last cooked', async () => {
    const r = await make({ favourite: true, rating: 3, lastCookedAt: '2026-11-01' });
    open(`/recipes/${r.id}/edit`);
    await userEvent.type(await screen.findByLabelText('Step text 1'), ' well');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'Rosół' });
    expect(await recipes.get(r.id)).toMatchObject({
      favourite: true,
      rating: 3,
      lastCookedAt: '2026-11-01',
      steps: [{ id: 's1', text: 'Boil well' }],
    });
  });
});

describe('recipe list', () => {
  it('filters favourites and sorts by rating', async () => {
    await make({ title: 'Alpha', rating: 2 });
    await make({ title: 'Beta', favourite: true, rating: 5 });
    await make({ title: 'Gamma', favourite: true, rating: 4 });
    open('/');
    await screen.findByText('Alpha');
    await userEvent.click(screen.getByRole('button', { name: /Favourites/ }));
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'rating');
    const items = screen.getAllByRole('link').filter((a) => /Beta|Gamma/.test(a.textContent ?? ''));
    expect(items.map((a) => a.textContent)).toEqual([
      expect.stringContaining('Beta'),
      expect.stringContaining('Gamma'),
    ]);
  });
});
