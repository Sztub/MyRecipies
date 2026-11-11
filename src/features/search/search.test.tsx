import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routes } from '../../app/routes';
import { initDb, recipes, resetDb, tags } from '../../db';

function draft(title: string, ingredient: string, tagIds: string[] = []) {
  return {
    title,
    tagIds,
    ingredients: [{ id: crypto.randomUUID(), name: ingredient }],
    steps: [{ id: crypto.randomUUID(), text: 'Cook.' }],
    photoHashes: [],
  };
}

beforeEach(async () => {
  await resetDb();
  await initDb();
});

describe('recipe search', () => {
  it('filters by title, ingredient and tag, ignoring Polish diacritics', async () => {
    const tag = await tags.save({ name: 'Świąteczne' });
    await recipes.save(draft('Żurek', 'Kiełbasa'));
    await recipes.save(draft('Pierogi', 'Mąka', [tag.id]));
    await recipes.save(draft('Barszcz', 'Burak'));

    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />);
    const box = await screen.findByRole('searchbox', { name: 'Search recipes' });
    await screen.findByRole('link', { name: 'Żurek' });

    await userEvent.type(box, 'zur');
    expect(screen.getByRole('link', { name: 'Żurek' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Pierogi' })).not.toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, 'maka');
    expect(screen.getByRole('link', { name: 'Pierogi' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Żurek' })).not.toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, 'swiateczne');
    expect(screen.getByRole('link', { name: 'Pierogi' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Barszcz' })).not.toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, 'nic');
    expect(screen.getByText(/No recipes match/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getAllByRole('link', { name: /Żurek|Pierogi|Barszcz/ })).toHaveLength(3);
  });

  it('combines with the tag filter', async () => {
    const tag = await tags.save({ name: 'Winter' });
    await recipes.save(draft('Rosół', 'Marchew', [tag.id]));
    await recipes.save(draft('Kompot', 'Marchew'));
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />);
    await userEvent.type(await screen.findByRole('searchbox'), 'marchew');
    await userEvent.click(await screen.findByRole('button', { name: 'Winter' }));
    expect(screen.getByRole('link', { name: 'Rosół' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Kompot' })).not.toBeInTheDocument();
  });
});
