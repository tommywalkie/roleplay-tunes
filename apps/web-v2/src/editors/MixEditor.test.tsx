import type { Mix } from '@dnd/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { makeMe, makeMix, makeSound } from '../test/fixtures';
import { MixEditor, type ItemDraft } from './MixEditor';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

const crowd = makeSound({ id: 'crowd', name: 'Tavern crowd', defaultMode: 'loop' });
const drip = makeSound({ id: 'drip', name: 'Drip', defaultMode: 'recurring', intervalMinSec: 5, intervalMaxSec: 30 });

const mix = makeMix({
  items: [
    { id: 'i1', soundId: 'crowd', mode: 'loop', volume: 0.6, intervalMinSec: 20, intervalMaxSec: 90, volumeVariation: 0 },
    { id: 'i2', soundId: 'drip', mode: 'recurring', volume: 0.4, intervalMinSec: 5, intervalMaxSec: 30, volumeVariation: 0 },
  ],
});

function renderEditor(props: { mix: Mix | null; initialItems?: ItemDraft[] }) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
    json(200, props.mix ?? makeMix({ id: 'new' })),
  );
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider initial="en">
        <MixEditor sounds={[crowd, drip]} scenes={[]} me={makeMe()} onClose={() => {}} {...props} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  /** The list row of an item, found by its play mode select. */
  const row = (name: string) =>
    within(screen.getByRole('combobox', { name: `Play mode: ${name}` }).closest('li')!);
  const savedItems = () => {
    const [, init] = fetchMock.mock.calls.at(-1)!;
    return (JSON.parse(String(init?.body)) as { items: ItemDraft[] }).items;
  };
  return { user, fetchMock, row, savedItems };
}

const MIN = 'Shortest wait, seconds';
const MAX = 'Longest wait, seconds';

describe('MixEditor pauses', () => {
  it('shows the pause fields under a Random gaps item only', () => {
    const { row } = renderEditor({ mix });
    expect(row('Drip').getByLabelText(MIN)).toHaveValue(5);
    expect(row('Drip').getByLabelText(MAX)).toHaveValue(30);
    expect(row('Tavern crowd').queryByLabelText(MIN)).not.toBeInTheDocument();
    expect(row('Tavern crowd').queryByLabelText(MAX)).not.toBeInTheDocument();
  });

  it('shows the fields once an item is set to Random gaps, and saves the bounds clamped', async () => {
    const { user, row, fetchMock, savedItems } = renderEditor({ mix });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Play mode: Tavern crowd' }), 'Random gaps');
    const min = row('Tavern crowd').getByLabelText(MIN);
    const max = row('Tavern crowd').getByLabelText(MAX);
    expect(min).toHaveValue(20);
    expect(max).toHaveValue(90);
    await user.clear(min);
    await user.type(min, '0');
    await user.clear(max);
    await user.type(max, '99999');
    expect(min).toHaveValue(0);
    expect(max).toHaveValue(99999);

    await user.clear(row('Drip').getByLabelText(MIN));
    await user.type(row('Drip').getByLabelText(MIN), '50');
    await user.clear(row('Drip').getByLabelText(MAX));
    await user.type(row('Drip').getByLabelText(MAX), '10');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/api/mixes/m1');
    expect(init?.method).toBe('PATCH');
    expect(savedItems()).toMatchObject([
      { soundId: 'crowd', mode: 'recurring', intervalMinSec: 1, intervalMaxSec: 3600 },
      { soundId: 'drip', mode: 'recurring', intervalMinSec: 50, intervalMaxSec: 50 },
    ]);
  });

  it('hides the fields when the item is switched to a loop', async () => {
    const { user, row, savedItems } = renderEditor({ mix });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Play mode: Drip' }), 'Loop');
    expect(row('Drip').queryByLabelText(MIN)).not.toBeInTheDocument();
    expect(row('Drip').queryByLabelText(MAX)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(savedItems()[1]).toMatchObject({ soundId: 'drip', mode: 'loop' });
  });
});

describe('MixEditor sounds', () => {
  it('adds a sound picked in the Choose dialog with its own settings', async () => {
    const { user, row } = renderEditor({ mix: null });
    expect(screen.getByText('None yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose' }));
    const picker = within(screen.getByRole('dialog', { name: 'Sounds in this mix' }));
    await user.click(picker.getByRole('checkbox', { name: /Drip/ }));
    await user.click(picker.getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('dialog', { name: 'Sounds in this mix' })).not.toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Play mode: Drip' })).toHaveDisplayValue('Random gaps');
    expect(row('Drip').getByLabelText(MIN)).toHaveValue(5);
    expect(row('Drip').getByLabelText(MAX)).toHaveValue(30);
  });
});

describe('MixEditor initialItems', () => {
  it('starts a new mix with the given items and creates it with them', async () => {
    const initialItems: ItemDraft[] = [
      { soundId: 'crowd', mode: 'loop', volume: 0.3, intervalMinSec: 20, intervalMaxSec: 90, volumeVariation: 0 },
      { soundId: 'drip', mode: 'recurring', volume: 0.5, intervalMinSec: 4, intervalMaxSec: 12, volumeVariation: 0.25 },
    ];
    const { user, row, fetchMock, savedItems } = renderEditor({ mix: null, initialItems });
    expect(screen.getByRole('dialog', { name: 'New mix' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Play mode: Tavern crowd' })).toHaveDisplayValue('Loop');
    expect(row('Drip').getByLabelText(MIN)).toHaveValue(4);
    expect(row('Drip').getByLabelText(MAX)).toHaveValue(12);

    await user.type(screen.getByLabelText('Name'), 'Storm at the inn');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/api/mixes');
    expect(init?.method).toBe('POST');
    expect(savedItems()).toEqual(initialItems);
  });
});
