import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { recipes, resetDb } from '../db';
import SampleRecipesSection from './SampleRecipesSection';

beforeEach(async () => {
  await resetDb();
});

it('loads sample recipes on click', async () => {
  render(<SampleRecipesSection />);
  await userEvent.click(screen.getByRole('button', { name: 'Load sample recipes' }));
  expect(await screen.findByRole('status')).toHaveTextContent('new: 6');
  expect(await recipes.list()).toHaveLength(6);
});
