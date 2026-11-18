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
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
    url === '/api/synonyms' || url === '/api/categories'
      ? json(200, [])
      : json(200, props.mix ?? makeMix({ id: 'new' })),
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
  /** Requests that change something, in order; reads that follow a save are left out. */
  const saves = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method && init.method !== 'GET')
      .map(([url, init]) => ({
        url,
        method: init!.method,
        body: JSON.parse(String(init!.body)) as { items?: ItemDraft[] } & Record<string, unknown>,
      }));
  const savedItems = () => saves().at(-1)!.body.items;
  return { user, fetchMock, row, saves, savedItems };
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
    const { user, row, saves, savedItems } = renderEditor({ mix });
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
    expect(saves()).toMatchObject([{ url: '/api/mixes/m1', method: 'PATCH' }]);
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
    expect(savedItems()?.[1]).toMatchObject({ soundId: 'drip', mode: 'loop' });
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
    const { user, row, saves, savedItems } = renderEditor({ mix: null, initialItems });
    expect(screen.getByRole('dialog', { name: 'New mix' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Play mode: Tavern crowd' })).toHaveDisplayValue('Loop');
    expect(row('Drip').getByLabelText(MIN)).toHaveValue(4);
    expect(row('Drip').getByLabelText(MAX)).toHaveValue(12);

    await user.type(screen.getByLabelText('Name'), 'Storm at the inn');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()).toMatchObject([{ url: '/api/mixes', method: 'POST' }]);
    expect(savedItems()).toEqual(initialItems);
  });
});

describe('MixEditor synonyms and categories', () => {
  it('sends the owner’s synonyms and categories with the mix', async () => {
    const { user, saves } = renderEditor({ mix: { ...mix, synonyms: [{ label: 'inn', mine: true }] } });
    await user.type(screen.getByRole('combobox', { name: 'Synonyms' }), 'pub{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[0].body).toMatchObject({ synonyms: ['inn', 'pub'], categoryIds: [] });
  });

  it('saves only the user’s own synonyms on a mix they added', async () => {
    const added = makeMix({
      ...mix,
      access: 'added',
      ownerName: 'Grace',
      synonyms: [
        { label: 'market', mine: false },
        { label: 'bazaar', mine: true },
      ],
    });
    const { user, saves } = renderEditor({ mix: added });
    expect(screen.queryByRole('button', { name: 'Remove market' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove bazaar' }));
    await user.type(screen.getByRole('combobox', { name: 'Synonyms' }), 'souk{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(saves()).toHaveLength(2));
    const [volumes, tags] = saves();
    expect(volumes).toMatchObject({ url: '/api/mixes/m1/volumes', method: 'PUT' });
    expect(tags).toMatchObject({ url: '/api/mixes/m1', method: 'PATCH' });
    expect(tags.body).toEqual({ sceneIds: [], synonyms: ['souk'], categoryIds: [] });
  });
});
