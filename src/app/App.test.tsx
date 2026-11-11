import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routes } from './routes';
import { backTarget } from './Layout';

function setup(path = '/') {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

const menuLink = (name: string) =>
  within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name });
const menuButton = () => screen.getByRole('button', { name: /menu/i });

describe('header back button', () => {
  it('points sub-pages at their parent and hides on top-level pages', () => {
    expect(backTarget('/recipes/new')).toBe('/');
    expect(backTarget('/recipes/abc')).toBe('/');
    expect(backTarget('/recipes/abc/edit')).toBe('/recipes/abc');
    expect(backTarget('/settings/github')).toBe('/settings');
    expect(backTarget('/settings/backup')).toBe('/settings');
    for (const p of ['/', '/manage', '/sync', '/settings']) expect(backTarget(p)).toBeNull();
  });

  it('is shown on the new-recipe form and goes back to the list', async () => {
    setup('/recipes/new');
    await userEvent.click(await screen.findByRole('link', { name: 'Back' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Recipes' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back' })).not.toBeInTheDocument();
  });
});

describe('settings sub-screens (#71)', () => {
  it('old /backup address opens Settings → Backup, with a back link to Settings', async () => {
    setup('/backup');
    expect(await screen.findByRole('heading', { level: 2, name: 'Backup' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
  });

  it('Settings home opens the Backup sub-screen', async () => {
    setup('/settings');
    await userEvent.click(await screen.findByRole('link', { name: /^Backup/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Backup' })).toBeInTheDocument();
  });
});

describe('app shell', () => {
  it('renders header, side menu and the recipes page', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Recipes' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(nav).toBeInTheDocument();
    for (const name of ['Recipes', 'New recipe', 'Categories & tags', 'Settings']) {
      expect(menuLink(name)).toBeInTheDocument();
    }
    // #71: Backup lives under Settings now, not in the menu.
    expect(within(nav).queryByRole('link', { name: 'Backup' })).not.toBeInTheDocument();
  });

  it('opens the menu, moves focus into it and closes after navigating', async () => {
    setup();
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(menuButton());
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true');
    expect(menuLink('Recipes')).toHaveFocus();
    await userEvent.click(menuLink('Settings'));
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(menuButton());
    await userEvent.click(menuLink('Categories & tags'));
    expect(
      screen.getByRole('heading', { level: 2, name: 'Categories & tags' }),
    ).toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the button', async () => {
    setup();
    await userEvent.click(menuButton());
    await userEvent.keyboard('{Escape}');
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    expect(menuButton()).toHaveFocus();
  });

  it('closes when the backdrop is clicked', async () => {
    setup();
    await userEvent.click(menuButton());
    await userEvent.click(screen.getByTestId('menu-backdrop'));
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps Tab focus inside the open menu', async () => {
    setup();
    await userEvent.click(menuButton());
    await userEvent.tab({ shift: true }); // from first link to the toggle button
    expect(menuButton()).toHaveFocus();
    await userEvent.tab({ shift: true }); // wraps to last link
    expect(menuLink('Settings')).toHaveFocus();
    await userEvent.tab(); // wraps to the button
    expect(menuButton()).toHaveFocus();
  });
});
