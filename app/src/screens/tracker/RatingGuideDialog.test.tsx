import * as axe from 'axe-core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { RatingGuideDialog } from './RatingGuideDialog';
import { ratingGuide } from './rating-guide-content';

it('opens the rating guide in a titled pop-up and closes it with Escape, returning focus', async () => {
  const user = userEvent.setup();
  render(<RatingGuideDialog />);
  expect(screen.queryByRole('dialog')).toBeNull();
  const trigger = screen.getByRole('button', { name: 'Ghid de evaluare' });

  await user.click(trigger);
  const dialog = await screen.findByRole('dialog', {
    name: 'Ghid de evaluare',
  });
  expect(dialog).toHaveAccessibleDescription(ratingGuide.placeholderNotice);
  for (const section of ratingGuide.sections)
    expect(
      screen.getByRole('heading', { name: section.heading }),
    ).toBeVisible();

  const results = await axe.run(dialog, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);

  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(trigger).toHaveFocus();
});

it('can be opened from the keyboard', async () => {
  const user = userEvent.setup();
  render(<RatingGuideDialog />);
  await user.tab();
  expect(
    screen.getByRole('button', { name: 'Ghid de evaluare' }),
  ).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(
    await screen.findByRole('dialog', { name: 'Ghid de evaluare' }),
  ).toBeVisible();
});
