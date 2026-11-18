import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Shapes } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { IllustrationField } from './IllustrationField';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

/** A 300-icon set, icon-1…icon-300, enough for the grid to virtualise. */
const icons = Object.fromEntries(
  Array.from({ length: 300 }, (_, i) => [
    `icon-${i + 1}`,
    { m: `<svg data-icon="icon-${i + 1}"></svg>`, l: `Icon ${i + 1}` },
  ]),
);

// Grid sizing from the ResizeObserver stub's 600×400 content box: 12 columns of ~46.33px
// cells, ~50.33px rows — 25 rows for 300 icons, ~858px of scroll to reach the last one.
const COLS = Math.floor((600 + 4) / (44 + 4)); // 12
const ROW_HEIGHT = (600 - 4 * (COLS - 1)) / COLS + 4; // ≈ 50.33
const ROWS = Math.ceil(300 / COLS); // 25
const BOTTOM = ROWS * ROW_HEIGHT - 400;

function renderField() {
  const onChange = vi.fn();
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
    if (url === '/icons/index.json')
      return json(200, [{ id: 'set', label: 'Test set', count: 300 }]);
    if (url === '/icons/set.json') return json(200, { icons });
    return json(404, { error: { code: 'notFound' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider initial="en">
        <IllustrationField
          value={{ type: 'none' }}
          onChange={onChange}
          fallback={Shapes}
          maxImageBytes={1048576}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onChange };
}

/** Opens the icon picker and waits for the grid to be measured and laid out. */
async function openPicker() {
  const { user, onChange } = renderField();
  await user.click(screen.getByRole('button', { name: 'Choose icon' }));
  const picker = within(screen.getByRole('dialog', { name: 'Choose icon' }));
  // With the stubbed 600px box the first row holds Icon 1…Icon 12.
  await picker.findByRole('button', { name: 'Icon 12' });
  return { user, onChange, picker };
}

/** The grid's scroller: the .scroll-quiet div nested in the dialog's own body. */
function gridScroller() {
  return screen
    .getByRole('dialog', { name: 'Choose icon' })
    .querySelector('.scroll-quiet .scroll-quiet') as HTMLElement;
}

/** Scrolls the grid to its last row and waits for the throttled update to mount it. */
async function scrollToBottom() {
  const scroller = gridScroller();
  scroller.scrollTop = BOTTOM;
  fireEvent.scroll(scroller); // the component reads scrollTop one animation frame later
  await within(scroller).findByRole('button', { name: 'Icon 300' });
}

describe('IllustrationField', () => {
  it('mounts only the visible rows of the 300-icon set', async () => {
    const { picker } = await openPicker();
    expect(picker.getAllByRole('button', { name: /Icon \d+/ }).length).toBeLessThan(300);
    expect(picker.queryByRole('button', { name: 'Icon 300' })).not.toBeInTheDocument();
    expect(picker.getByText('300 icons')).toBeInTheDocument();
  });

  it('reveals the last icons when the grid scrolls to the bottom', async () => {
    const { picker } = await openPicker();
    await scrollToBottom();
    expect(picker.getByRole('button', { name: 'Icon 300' })).toBeInTheDocument();
    expect(picker.queryByRole('button', { name: 'Icon 1' })).not.toBeInTheDocument();
  });

  it('narrows the grid and the count when searching', async () => {
    const { user, picker } = await openPicker();
    await user.type(picker.getByLabelText('Search'), '200');
    expect(picker.getAllByRole('button', { name: /Icon \d+/ })).toHaveLength(1);
    expect(picker.getByRole('button', { name: 'Icon 200' })).toBeInTheDocument();
    expect(picker.getByText('1 icons')).toBeInTheDocument();
  });

  it('goes back to the top of the list when the search changes', async () => {
    const { user, picker } = await openPicker();
    await scrollToBottom();
    const search = picker.getByLabelText('Search');
    await user.type(search, '200');
    await user.clear(search);
    expect(await picker.findByRole('button', { name: 'Icon 1' })).toBeInTheDocument();
    expect(picker.queryByRole('button', { name: 'Icon 300' })).not.toBeInTheDocument();
  });

  it('picks an icon, closing the picker and reporting its id and markup', async () => {
    const { user, onChange, picker } = await openPicker();
    await user.click(picker.getByRole('button', { name: 'Icon 5' }));
    expect(screen.queryByRole('dialog', { name: 'Choose icon' })).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'icon',
      iconId: 'set:icon-5',
      svg: '<svg data-icon="icon-5"></svg>',
    });
  });
});
