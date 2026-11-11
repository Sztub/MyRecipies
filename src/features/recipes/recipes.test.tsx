import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { categories, initDb, recipes, resetDb, tags } from '../../db';
import { routes } from '../../app/routes';

async function setup(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(async () => {
  await resetDb();
  await initDb();
});

describe('recipe form', () => {
  it('shows validation errors and does not save an empty form', async () => {
    await setup('/recipes/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Please enter a title.')).toBeInTheDocument();
    expect(await recipes.list()).toHaveLength(0);
  });

  it('flags a half-filled ingredient', async () => {
    await setup('/recipes/new');
    await userEvent.type(await screen.findByLabelText('Title'), 'Soup');
    await userEvent.type(screen.getByLabelText('Amount 1'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Please enter a name for this ingredient.')).toBeInTheDocument();
    expect(await recipes.list()).toHaveLength(0);
  });

  it('saves a recipe with ingredients, steps, category and a new tag', async () => {
    const router = await setup('/recipes/new');
    await userEvent.type(await screen.findByLabelText('Title'), 'Rosół');
    const cat = (await categories.list()).find((c) => c.name === 'category.soups')!;
    await userEvent.selectOptions(screen.getByLabelText('Category'), cat.id);
    await userEvent.type(screen.getByLabelText('Ingredient 1'), 'Carrot');
    await userEvent.type(screen.getByLabelText('Amount 1'), '2');
    await userEvent.selectOptions(screen.getByLabelText('Unit 1'), 'pcs');
    await userEvent.type(screen.getByLabelText('Step text 1'), 'Boil');
    await userEvent.click(screen.getByRole('button', { name: 'Add step' }));
    await userEvent.type(screen.getByLabelText('Step text 2'), 'Serve');
    await userEvent.click(screen.getByRole('button', { name: 'Move up 2' }));
    await userEvent.type(screen.getByLabelText('New tag'), 'Winter');
    await userEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const saved = (await recipes.list())[0]!;
    expect(saved.title).toBe('Rosół');
    expect(saved.categoryId).toBe(cat.id);
    expect(saved.ingredients[0]).toMatchObject({ name: 'Carrot', amount: 2, unit: 'pcs' });
    expect(saved.steps.map((s) => s.text)).toEqual(['Serve', 'Boil']);
    expect((await tags.list()).map((x) => x.name)).toEqual(['Winter']);
    expect(saved.tagIds).toHaveLength(1);
    await screen.findByRole('heading', { name: 'Rosół' });
    expect(router.state.location.pathname).toBe(`/recipes/${saved.id}`);
  });
});

describe('list and detail', () => {
  it('lists recipes grouped and filtered by category and tag, and deletes with confirm', async () => {
    const cats = await categories.list();
    const mains = cats[0]!;
    const soups = cats[1]!;
    const tag = await tags.save({ name: 'Quick' });
    const base = { ingredients: [], steps: [], photoHashes: [] };
    await recipes.save({ ...base, title: 'Steak', categoryId: mains.id, tagIds: [] });
    const soup = await recipes.save({
      ...base,
      title: 'Tomato',
      categoryId: soups.id,
      tagIds: [tag.id],
    });
    await setup('/');
    expect(await screen.findByRole('link', { name: 'Steak' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tomato' })).toBeInTheDocument();

    const filters = screen.getByRole('group', { name: 'Tags' });
    await userEvent.click(within(filters).getByRole('button', { name: 'Quick' }));
    expect(screen.queryByRole('link', { name: 'Steak' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Tomato' }));
    await screen.findByRole('heading', { name: 'Tomato' });
    // #70: the confirmation is a modal dialog; focus starts on Cancel and Escape closes it.
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this recipe?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await screen.findByRole('heading', { level: 2, name: 'Recipes' });
    expect(await recipes.get(soup.id)).toBeUndefined();
    expect(await recipes.get(soup.id, { includeDeleted: true })).toMatchObject({ deleted: true });
  });
});

describe('manage page', () => {
  it('adds, renames and deletes a tag', async () => {
    await setup('/manage');
    await userEvent.type(await screen.findByLabelText('New tag'), 'Vegan');
    await userEvent.click(
      within(screen.getByRole('region', { name: 'Tags' })).getByRole('button', { name: 'Add' }),
    );
    await screen.findByText('Vegan');
    await userEvent.click(screen.getByRole('button', { name: 'Rename Vegan' }));
    const input = screen.getByLabelText('Rename Vegan');
    await userEvent.clear(input);
    await userEvent.type(input, 'Plant');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Plant');
    await userEvent.click(screen.getByRole('button', { name: 'Delete Plant' }));
    await userEvent.click(screen.getByRole('button', { name: /Yes, delete Plant/ }));
    expect(await tags.list()).toHaveLength(0);
  });
});

describe('ingredient row layout and unit "other"', () => {
  it('puts name, amount and unit on line 1 and the note on line 2', async () => {
    await setup('/recipes/new');
    const row = (await screen.findByTestId('ingredient-row')) as HTMLElement;
    const lines = Array.from(row.children).filter((c) => c.querySelector('input, select'));
    expect(lines).toHaveLength(2);
    const first = within(lines[0] as HTMLElement);
    expect(first.getByLabelText('Ingredient 1')).toBeInTheDocument();
    expect(first.getByLabelText('Amount 1')).toBeInTheDocument();
    expect(first.getByLabelText('Unit 1')).toBeInTheDocument();
    expect(within(lines[1] as HTMLElement).getByLabelText('Note 1')).toBeInTheDocument();
    expect(screen.queryByLabelText(/own text/)).not.toBeInTheDocument();
  });

  it('marks the note as required with a hint when unit is "other"', async () => {
    await setup('/recipes/new');
    const note = await screen.findByLabelText('Note 1');
    expect(note).toHaveAttribute('aria-required', 'false');
    expect(note).toHaveAttribute('placeholder', 'Note');
    await userEvent.selectOptions(screen.getByLabelText('Unit 1'), 'other');
    expect(note).toHaveAttribute('aria-required', 'true');
    expect(note).toHaveAttribute('placeholder', 'e.g. 1 small jar');
  });

  it('shows the note in place of the unit on the detail page', async () => {
    const r = await recipes.save({
      title: 'Jam',
      tagIds: [],
      steps: [],
      photoHashes: [],
      ingredients: [
        { id: 'i1', name: 'sugar', amount: 1, unit: 'other', note: 'small jar' },
        { id: 'i2', name: 'flour', amount: 2, unit: 'kg', note: 'sifted' },
      ],
    });
    await setup(`/recipes/${r.id}`);
    expect(await screen.findByText('1 small jar sugar')).toBeInTheDocument();
    expect(screen.getByText(/2 kg flour/)).toBeInTheDocument();
    expect(screen.getByText('(sifted)')).toBeInTheDocument();
  });
});

describe('servings scaling (view-only)', () => {
  it('scales ingredient amounts with the stepper and does not save', async () => {
    const r = await recipes.save({
      title: 'Cake',
      tagIds: [],
      photoHashes: [],
      servings: 2,
      ingredients: [
        { id: 'i1', name: 'flour', amount: 100, unit: 'g' },
        { id: 'i2', name: 'salt', amount: 1, unit: 'pinch' },
      ],
      steps: [],
    });
    await setup(`/recipes/${r.id}`);
    expect(await screen.findByText('100 g flour')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More servings' }));
    await userEvent.click(screen.getByRole('button', { name: 'More servings' }));
    expect(screen.getByText('200 g flour')).toBeInTheDocument();
    expect(screen.getByText(/1 pinch salt/)).toBeInTheDocument();
    expect(screen.getByTestId('servings-value')).toHaveTextContent('4 servings');
    expect((await recipes.get(r.id))?.servings).toBe(2);
  });
});
