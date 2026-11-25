import type { Mix, Sound } from '@dnd/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerProvider } from '../audio/player';
import { I18nProvider } from '../i18n';
import { makeFakeEngine, makeMe, makeMix, makeMixItem, makeSound } from '../test/fixtures';
import { MixEditor, type ItemDraft } from './MixEditor';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

const crowd = makeSound({ id: 'crowd', name: 'Tavern crowd', defaultMode: 'loop' });
const drip = makeSound({ id: 'drip', name: 'Drip', defaultMode: 'recurring', intervalMinSec: 5, intervalMaxSec: 30 });

const mix = makeMix({
  items: [
    makeMixItem({ id: 'i1', soundId: 'crowd', mode: 'loop', volume: 0.6 }),
    makeMixItem({ id: 'i2', soundId: 'drip', mode: 'recurring', volume: 0.4, intervalMinSec: 5, intervalMaxSec: 30 }),
  ],
});

function renderEditor(props: {
  mix: Mix | null;
  initialItems?: ItemDraft[];
  sounds?: Sound[];
}) {
  const sounds = props.sounds ?? [crowd, drip];
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
    url === '/api/synonyms' || url === '/api/categories'
      ? json(200, [])
      : json(200, props.mix ?? makeMix({ id: 'new' })),
  );
  vi.stubGlobal('fetch', fetchMock);
  // The per-item loop editor reads the waveform through the player, so the editor runs
  // inside a PlayerProvider with a fake engine, as in PlayerPanel.test.tsx.
  const fake = makeFakeEngine();
  fake.spies.getWaveformPeaks.mockResolvedValue(new Float32Array(480));
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider initial="en">
        <PlayerProvider sounds={sounds} engine={fake.engine}>
          <MixEditor {...props} sounds={sounds} scenes={[]} me={makeMe()} onClose={() => {}} />
        </PlayerProvider>
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
    // Two pickers share the editor (sounds, then scenes): work in the sounds one.
    const sounds = within(screen.getByText('Sounds in this mix').parentElement!);
    expect(sounds.getByText('None yet')).toBeInTheDocument();
    await user.click(sounds.getByRole('button', { name: 'Choose Sounds in this mix' }));
    const picker = within(screen.getByRole('dialog', { name: 'Sounds in this mix' }));
    await user.click(picker.getByRole('checkbox', { name: /Drip/ }));
    await user.click(picker.getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('dialog', { name: 'Sounds in this mix' })).not.toBeInTheDocument();
    expect(sounds.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Play mode: Drip' })).toHaveDisplayValue('Random gaps');
    expect(row('Drip').getByLabelText(MIN)).toHaveValue(5);
    expect(row('Drip').getByLabelText(MAX)).toHaveValue(30);
  });
});

describe('MixEditor initialItems', () => {
  it('starts a new mix with the given items and creates it with them', async () => {
    const initialItems: ItemDraft[] = [
      { soundId: 'crowd', mode: 'loop', volume: 0.3, intervalMinSec: 20, intervalMaxSec: 90, volumeVariation: 0, trackStartSec: null, trackEndSec: null, loopStartSec: null, loopEndSec: null, loopMode: null, crossfadeSec: null },
      { soundId: 'drip', mode: 'recurring', volume: 0.5, intervalMinSec: 4, intervalMaxSec: 12, volumeVariation: 0.25, trackStartSec: null, trackEndSec: null, loopStartSec: null, loopEndSec: null, loopMode: null, crossfadeSec: null },
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

describe('MixEditor item loop overrides', () => {
  it('opens the loop editor for an item, stacked over the mix editor, and saves the overrides with the mix', async () => {
    const { user, row, saves, savedItems } = renderEditor({ mix });

    await user.click(row('Tavern crowd').getByRole('button', { name: 'Edit the loop of Tavern crowd' }));
    const loopDialog = screen.getByRole('dialog', { name: 'Loop editor' });
    expect(loopDialog.closest('[data-dialog-state]')).toHaveAttribute('data-dialog-state', 'shown');
    // The mix editor stays mounted underneath, covered.
    const covered = screen.getByRole('dialog', { name: 'Edit mix', hidden: true });
    expect(covered.closest('[data-dialog-state]')).toHaveAttribute('data-dialog-state', 'covered');

    const loop = within(loopDialog);
    // Move the loop start by one step (0.1 s), switch to crossfade and set 3 s.
    fireEvent.keyDown(loop.getByRole('slider', { name: 'Loop start' }), { key: 'ArrowRight' });
    await user.click(loop.getByRole('radio', { name: 'Crossfade' }));
    fireEvent.change(loop.getByRole('slider', { name: 'Crossfade length, seconds' }), {
      target: { value: '3' },
    });
    await user.click(loop.getByRole('button', { name: 'Apply' }));
    expect(screen.queryByRole('dialog', { name: 'Loop editor' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()).toMatchObject([{ url: '/api/mixes/m1', method: 'PATCH' }]);
    const items = savedItems()!;
    expect(items[0]).toMatchObject({
      soundId: 'crowd',
      trackStartSec: null,
      trackEndSec: null,
      loopStartSec: 0.1,
      loopEndSec: null,
      loopMode: 'crossfade',
      crossfadeSec: 3,
    });
    // The other item keeps its nulls (it follows its sound's own loop settings).
    expect(items[1]).toMatchObject({
      soundId: 'drip',
      trackStartSec: null,
      trackEndSec: null,
      loopStartSec: null,
      loopEndSec: null,
      loopMode: null,
      crossfadeSec: null,
    });
  });

  it('sends null for loop fields that still equal the sound’s own resolved values', async () => {
    // The sound itself has a custom loop; the item inherits it as nulls.
    const custom = makeSound({
      id: 'crowd',
      name: 'Tavern crowd',
      defaultMode: 'loop',
      durationSec: 60,
      loopStartSec: 5,
      loopEndSec: 20,
      loopMode: 'crossfade',
      crossfadeSec: 1.5,
    });
    const customMix = makeMix({
      items: [makeMixItem({ id: 'i1', soundId: 'crowd', mode: 'loop', volume: 0.6 })],
    });
    const { user, row, savedItems } = renderEditor({ mix: customMix, sounds: [custom, drip] });

    await user.click(row('Tavern crowd').getByRole('button', { name: 'Edit the loop of Tavern crowd' }));
    // Apply without changing anything: every field equals the sound's own values.
    await user.click(
      within(screen.getByRole('dialog', { name: 'Loop editor' })).getByRole('button', {
        name: 'Apply',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(savedItems()![0]).toMatchObject({
      soundId: 'crowd',
      trackStartSec: null,
      trackEndSec: null,
      loopStartSec: null,
      loopEndSec: null,
      loopMode: null,
      crossfadeSec: null,
    });
  });

  it('puts the loop overrides applied in the dialog into the POST body of a new mix', async () => {
    const initialItems: ItemDraft[] = [
      {
        soundId: 'crowd',
        mode: 'loop',
        volume: 0.3,
        intervalMinSec: 20,
        intervalMaxSec: 90,
        volumeVariation: 0,
        trackStartSec: null,
        trackEndSec: null,
        loopStartSec: null,
        loopEndSec: null,
        loopMode: null,
        crossfadeSec: null,
      },
    ];
    const { user, row, saves, savedItems } = renderEditor({ mix: null, initialItems });
    await user.type(screen.getByLabelText('Name'), 'Storm at the inn');

    await user.click(row('Tavern crowd').getByRole('button', { name: 'Edit the loop of Tavern crowd' }));
    const loop = within(screen.getByRole('dialog', { name: 'Loop editor' }));
    // The new mix is covered by the loop editor.
    expect(
      screen.getByRole('dialog', { name: 'New mix', hidden: true }).closest('[data-dialog-state]'),
    ).toHaveAttribute('data-dialog-state', 'covered');
    fireEvent.keyDown(loop.getByRole('slider', { name: 'Loop start' }), { key: 'ArrowRight' });
    await user.click(loop.getByRole('button', { name: 'Apply' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()).toMatchObject([{ url: '/api/mixes', method: 'POST' }]);
    expect(savedItems()![0]).toMatchObject({
      soundId: 'crowd',
      loopStartSec: 0.1,
      loopEndSec: null,
      trackStartSec: null,
      trackEndSec: null,
      loopMode: null,
      crossfadeSec: null,
    });
  });
});
