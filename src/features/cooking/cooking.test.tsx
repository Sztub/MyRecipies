import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { initDb, recipes, resetDb } from '../../db';
import { routes } from '../../app/routes';

async function setup(steps: string[], photoHash?: string) {
  const r = await recipes.save({
    title: 'Rosół',
    tagIds: [],
    photoHashes: [],
    ingredients: [{ id: 'i1', name: 'Carrot', amount: 2, unit: 'pcs' }],
    steps: steps.map((text, i) => ({
      id: `s${i}`,
      text,
      ...(i === 0 && photoHash ? { photoHash } : {}),
    })),
  });
  const router = createMemoryRouter(routes, { initialEntries: [`/recipes/${r.id}/cook`] });
  render(<RouterProvider router={router} />);
  return { router, id: r.id };
}

const nav = navigator as unknown as { wakeLock?: unknown };

beforeEach(async () => {
  await resetDb();
  await initDb();
});
afterEach(() => {
  delete nav.wakeLock;
});

describe('cooking mode', () => {
  it('shows the photo of the current step', async () => {
    await setup(['Boil', 'Serve'], 'missing-hash');
    // Not in the photo store, so PhotoView renders its labelled placeholder.
    expect(await screen.findByRole('img', { name: 'Boil' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.queryByRole('img', { name: 'Boil' })).not.toBeInTheDocument();
  });

  it('steps with buttons and swipe, shows ingredients, exits', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({ release });
    nav.wakeLock = { request };
    const { router, id } = await setup(['Boil', 'Serve']);

    expect(await screen.findByText('Boil')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(request).toHaveBeenCalledWith('screen');

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Serve')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    const area = screen.getByTestId('cooking-step-area');
    fireEvent.pointerDown(area, { clientX: 50, clientY: 100 });
    fireEvent.pointerUp(area, { clientX: 200, clientY: 105 });
    expect(screen.getByText('Boil')).toBeInTheDocument();
    fireEvent.pointerDown(area, { clientX: 200, clientY: 100 });
    fireEvent.pointerUp(area, { clientX: 50, clientY: 100 });
    expect(screen.getByText('Serve')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Ingredients' }));
    expect(screen.getByText('2 pcs Carrot')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Exit' }));
    expect(router.state.location.pathname).toBe(`/recipes/${id}`);
    expect(release).toHaveBeenCalled();
  });

  it('re-acquires the wake lock when the page becomes visible again', async () => {
    const request = vi.fn().mockResolvedValue({ release: vi.fn().mockResolvedValue(undefined) });
    nav.wakeLock = { request };
    await setup(['Boil']);
    await screen.findByText('Boil');
    expect(request).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it('shows a message when wake lock is unsupported', async () => {
    await setup(['Boil']);
    expect(await screen.findByRole('status')).toHaveTextContent(/cannot keep the screen on/);
  });
});

describe('cooking mode: finish', () => {
  it('offers "I cooked this" on the last step and saves lastCookedAt', async () => {
    const { id } = await setup(['Boil', 'Serve']);
    await screen.findByText('Boil');
    expect(screen.queryByRole('button', { name: 'Done – I cooked this' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Done – I cooked this' }));
    expect(await screen.findByText('Saved: cooked today')).toBeInTheDocument();
    expect((await recipes.get(id))?.lastCookedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
