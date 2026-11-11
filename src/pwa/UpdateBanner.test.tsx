import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { UpdateBanner } from './UpdateBanner';
import { dismissUpdate, setUpdateAvailable } from './updateStore';

afterEach(() => act(() => dismissUpdate()));

it('renders nothing when no update is waiting', () => {
  const { container } = render(<UpdateBanner />);
  expect(container).toBeEmptyDOMElement();
});

it('shows the banner and applies the update on Reload', async () => {
  const apply = vi.fn().mockResolvedValue(undefined);
  render(<UpdateBanner />);
  act(() => setUpdateAvailable(apply));
  expect(screen.getByRole('status')).toHaveTextContent('A new version is available');
  await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
  expect(apply).toHaveBeenCalledOnce();
});

it('hides the banner on Later', async () => {
  render(<UpdateBanner />);
  act(() => setUpdateAvailable(vi.fn()));
  await userEvent.click(screen.getByRole('button', { name: 'Later' }));
  expect(screen.queryByRole('status')).toBeNull();
});
