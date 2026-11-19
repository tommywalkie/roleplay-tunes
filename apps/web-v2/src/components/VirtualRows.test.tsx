import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VirtualRows } from './VirtualRows';

/**
 * jsdom lays nothing out, so every box is zero and the component falls back to mounting
 * the whole list. These tests give it a layout by hand: a 50px row, a 200px window, and a
 * list that may start below the top of the scroller.
 */
const ROW = 50;
const VIEW = 200;
const COUNT = 100;

const rect = (top: number) =>
  ({ top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;

function board(count: number, listTop: number) {
  render(
    <main>
      <VirtualRows label="Rows" count={count} renderItem={(i) => <li key={i}>row {i}</li>} />
    </main>,
  );
  const ul = screen.getByRole('list');
  const main = ul.closest('main') as HTMLElement;

  Object.defineProperty(HTMLLIElement.prototype, 'offsetHeight', {
    get: () => ROW,
    configurable: true,
  });
  Object.defineProperty(ul, 'clientWidth', { value: 600, configurable: true });
  Object.defineProperty(main, 'clientHeight', { value: VIEW, configurable: true });
  // The list's own position follows the scroll: it rides up as the page scrolls down.
  main.getBoundingClientRect = () => rect(0);
  ul.getBoundingClientRect = () => rect(listTop - main.scrollTop);

  const mounted = () =>
    [...ul.querySelectorAll('li')].map((li) => Number(/row (\d+)/.exec(li.textContent ?? '')![1]));

  // The first measure runs on mount; a scroll event repeats it, throttled to a frame.
  const settle = async () => {
    fireEvent.scroll(main);
    await waitFor(() => expect(mounted().length).toBeLessThan(count));
  };
  return { main, mounted, settle };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (HTMLLIElement.prototype as { offsetHeight?: number }).offsetHeight;
});

describe('VirtualRows', () => {
  it('keeps a measurable window even when the list starts below the fold', async () => {
    const { mounted, settle } = board(COUNT, 1000);
    // Nothing of the list is on screen: it must still mount the fewest rows it can
    // measure, or it would stay empty and never recover.
    await settle();
    expect(mounted()).toEqual([0, 1, 2, 3]);
  });

  it('mounts the rows in view, and their neighbours, once scrolled to', async () => {
    const { main, mounted, settle } = board(COUNT, 0);
    await settle();

    main.scrollTop = 2500;
    fireEvent.scroll(main);
    await waitFor(() => expect(mounted()[0]).toBe(48));
    // The view spans 2500..2700, so rows 50..53 are on screen; two rows of overscan open
    // the window at 48 and close it at 55.
    expect(mounted()).toEqual([48, 49, 50, 51, 52, 53, 54, 55]);
  });

  it('stops at the last row rather than padding past the end', async () => {
    const { main, mounted, settle } = board(COUNT, 0);
    await settle();

    main.scrollTop = 4800;
    fireEvent.scroll(main);
    // The view spans 4800..5000, the whole list: rows 96..99 are on screen, overscan
    // opens the window at 94, and nothing is asked for past the end.
    await waitFor(() => expect(mounted()).toEqual([94, 95, 96, 97, 98, 99]));
  });

  it('tracks its own scroll when the list is the scroller', async () => {
    // The users box: a capped height that scrolls inside the card, not with the page.
    render(
      <main>
        <VirtualRows
          label="Rows"
          count={COUNT}
          className="max-h-[200px] overflow-y-auto"
          renderItem={(i) => <li key={i}>row {i}</li>}
        />
      </main>,
    );
    const ul = screen.getByRole('list');
    // jsdom runs no stylesheet, so the class means nothing: set what the component reads.
    ul.style.overflowY = 'auto';
    Object.defineProperty(HTMLLIElement.prototype, 'offsetHeight', {
      get: () => ROW,
      configurable: true,
    });
    Object.defineProperty(ul, 'clientWidth', { value: 600, configurable: true });
    Object.defineProperty(ul, 'clientHeight', { value: VIEW, configurable: true });
    const mounted = () =>
      [...ul.querySelectorAll('li')].map((li) => Number(/row (\d+)/.exec(li.textContent ?? '')![1]));

    fireEvent.scroll(ul);
    await waitFor(() => expect(mounted()[0]).toBe(0));
    // The box holds 200px of 50px rows: a window of four, plus overscan, and the rest of
    // the 100 rows is padding, not markup.
    expect(mounted()).toEqual([0, 1, 2, 3, 4, 5]);

    ul.scrollTop = 2500;
    fireEvent.scroll(ul);
    await waitFor(() => expect(mounted()[0]).toBe(48));
    expect(mounted()).toEqual([48, 49, 50, 51, 52, 53, 54, 55]);
  });

  it('holds the whole list when nothing can be measured', () => {
    // No layout at all: jsdom's real behaviour, and what tests and prerendering see.
    render(
      <main>
        <VirtualRows label="Rows" count={40} renderItem={(i) => <li key={i}>row {i}</li>} />
      </main>,
    );
    expect(screen.getByRole('list').querySelectorAll('li')).toHaveLength(40);
  });
});
