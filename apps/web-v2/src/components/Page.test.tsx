import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { Pagination, usePages } from './Page';

type Pages = ReturnType<typeof usePages>;

/** The `usePages` state the row reads, without the list it pages. */
function makePages(over: Partial<Pages> = {}): Pages {
  return { page: 0, pageCount: 3, setPage: vi.fn(), shown: [], ...over };
}

function setup(pages: Partial<Pages> = {}, pinned?: boolean) {
  const state = makePages(pages);
  render(
    <I18nProvider initial="en">
      <Pagination pages={state} pinned={pinned} />
    </I18nProvider>,
  );
  return { pages: state, user: userEvent.setup() };
}

describe('Pagination', () => {
  it('pinned, holds at the foot of the screen and turns the page', async () => {
    const { pages, user } = setup({}, true);
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    expect(nav).toHaveClass('fixed');
    expect(nav).toHaveClass('bg-page');

    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(pages.setPage).toHaveBeenCalledWith(1);
  });

  it('unpinned, stays in the flow with the list it pages', () => {
    setup();
    expect(screen.getByRole('navigation', { name: 'Pages' })).not.toHaveClass('fixed');
  });

  it('renders nothing for a list that fits on one page', () => {
    setup({ pageCount: 1 });
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
  });
});
