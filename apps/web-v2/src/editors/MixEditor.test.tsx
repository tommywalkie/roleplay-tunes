import type { Mix, MixKind, Sound } from '@dnd/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  kind?: MixKind;
  mixes?: Mix[];
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
      { soundId: 'crowd', mode: 'loop', volume: 0.3, intervalMinSec: 20, intervalMaxSec: 90, volumeVariation: 0, trackStartSec: null, trackEndSec: null, loopStartSec: null, loopEndSec: null, crossfadeSec: null },
      { soundId: 'drip', mode: 'recurring', volume: 0.5, intervalMinSec: 4, intervalMaxSec: 12, volumeVariation: 0.25, trackStartSec: null, trackEndSec: null, loopStartSec: null, loopEndSec: null, crossfadeSec: null },
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
    // Move the loop start by one step (0.1 s) and set a 3 s crossfade.
    fireEvent.keyDown(loop.getByRole('slider', { name: 'Loop start' }), { key: 'ArrowRight' });
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
      crossfadeSec: 3,
    });
    // The other item keeps its nulls (it follows its sound's own loop settings).
    expect(items[1]).toMatchObject({
      soundId: 'drip',
      trackStartSec: null,
      trackEndSec: null,
      loopStartSec: null,
      loopEndSec: null,
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
      crossfadeSec: null,
    });
  });

  it('opens the loop editor for a Random gaps item and for a Once item', async () => {
    const { user, row } = renderEditor({ mix });
    await user.click(row('Drip').getByRole('button', { name: 'Edit the loop of Drip' }));
    let loopDialog = within(screen.getByRole('dialog', { name: 'Loop editor' }));
    expect(loopDialog.getByRole('textbox', { name: 'Loop start' })).toBeInTheDocument();
    await user.click(loopDialog.getByRole('button', { name: 'Cancel' }));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Play mode: Tavern crowd' }), 'Once');
    await user.click(row('Tavern crowd').getByRole('button', { name: 'Edit the loop of Tavern crowd' }));
    loopDialog = within(screen.getByRole('dialog', { name: 'Loop editor' }));
    expect(loopDialog.getByRole('textbox', { name: 'Loop end' })).toBeInTheDocument();
    await user.click(loopDialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Loop editor' })).not.toBeInTheDocument();
  });
});

describe('MixEditor playlist', () => {
  const draft = (soundId: string, volume: number): ItemDraft => ({
    soundId,
    mode: 'loop',
    volume,
    intervalMinSec: 20,
    intervalMaxSec: 90,
    volumeVariation: 0,
    trackStartSec: null,
    trackEndSec: null,
    loopStartSec: null,
    loopEndSec: null,
    crossfadeSec: null,
  });
  /** A list row, found by the sound's name. */
  const listRow = (name: string) => within(screen.getByText(name, { selector: 'span' }).closest('li')!);
  const order = (saved: ItemDraft[] | undefined) => saved?.map((i) => i.soundId);

  it('creates a playlist: its own title and hint, no play mode or pauses, reordered by moving', async () => {
    const { user, saves, savedItems } = renderEditor({
      mix: null,
      kind: 'playlist',
      initialItems: [draft('crowd', 0.6), draft('drip', 0.4)],
    });
    expect(screen.getByRole('dialog', { name: 'New playlist' })).toBeInTheDocument();
    expect(
      screen.getByText(/^Sounds play one after another in this order/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^Play mode/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(MIN)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose Playlists' })).not.toBeInTheDocument();

    expect(listRow('Tavern crowd').getByRole('button', { name: 'Move Tavern crowd up' })).toBeDisabled();
    expect(listRow('Drip').getByRole('button', { name: 'Move Drip down' })).toBeDisabled();
    await user.click(listRow('Drip').getByRole('button', { name: 'Move Drip up' }));
    expect(listRow('Drip').getByRole('button', { name: 'Move Drip up' })).toBeDisabled();
    expect(
      listRow('Tavern crowd').getByRole('button', { name: 'Move Tavern crowd down' }),
    ).toBeDisabled();

    await user.type(screen.getByLabelText('Name'), 'Road');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [save] = saves();
    expect(save).toMatchObject({ url: '/api/mixes', method: 'POST' });
    expect(save.body.kind).toBe('playlist');
    expect(save.body).not.toHaveProperty('playlists');
    expect(order(savedItems())).toEqual(['drip', 'crowd']);
    expect(savedItems()).toMatchObject([{ volume: 0.4 }, { volume: 0.6 }]);
  });

  it('edits a playlist in place: moving down saves the new order, without kind', async () => {
    const road = makeMix({
      id: 'p1',
      name: 'Road',
      kind: 'playlist',
      items: [
        makeMixItem({ id: 'i1', soundId: 'crowd', volume: 0.6 }),
        makeMixItem({ id: 'i2', soundId: 'drip', volume: 0.4 }),
      ],
    });
    const { user, saves, savedItems } = renderEditor({ mix: road });
    expect(screen.getByRole('dialog', { name: 'Edit playlist' })).toBeInTheDocument();
    await user.click(listRow('Tavern crowd').getByRole('button', { name: 'Move Tavern crowd down' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [save] = saves();
    expect(save).toMatchObject({ url: '/api/mixes/p1', method: 'PATCH' });
    expect(save.body).not.toHaveProperty('kind');
    expect(save.body).not.toHaveProperty('playlists');
    expect(order(savedItems())).toEqual(['drip', 'crowd']);
  });

  const PLAYLIST_CROSSFADE = 'Crossfade between sounds, seconds';

  it('creates a playlist with the crossfade set on its slider', async () => {
    const { user, saves } = renderEditor({
      mix: null,
      kind: 'playlist',
      initialItems: [draft('crowd', 0.6), draft('drip', 0.4)],
    });
    const slider = screen.getByRole('slider', { name: PLAYLIST_CROSSFADE });
    expect(slider).toHaveValue('0');
    fireEvent.change(slider, { target: { value: '2.5' } });
    expect(slider).toHaveValue('2.5');

    await user.type(screen.getByLabelText('Name'), 'Road');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [save] = saves();
    expect(save).toMatchObject({ url: '/api/mixes', method: 'POST' });
    expect(save.body.crossfadeSec).toBe(2.5);
  });

  it('shows an existing playlist’s crossfade and saves the changed value', async () => {
    const road = makeMix({
      id: 'p1',
      name: 'Road',
      kind: 'playlist',
      crossfadeSec: 1.5,
      items: [makeMixItem({ id: 'i1', soundId: 'crowd' })],
    });
    const { user, saves } = renderEditor({ mix: road });
    const slider = screen.getByRole('slider', { name: PLAYLIST_CROSSFADE });
    expect(slider).toHaveValue('1.5');
    fireEvent.change(slider, { target: { value: '4' } });

    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [save] = saves();
    expect(save).toMatchObject({ url: '/api/mixes/p1', method: 'PATCH' });
    expect(save.body.crossfadeSec).toBe(4);
  });

  it('gives a plain mix no crossfade slider and sends no crossfadeSec', async () => {
    const { user, saves } = renderEditor({ mix });
    expect(screen.queryByRole('slider', { name: PLAYLIST_CROSSFADE })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()).toMatchObject([{ url: '/api/mixes/m1', method: 'PATCH' }]);
    expect(saves()[0].body).not.toHaveProperty('crossfadeSec');
  });

  it('edits only the track range of a playlist item, and saves it without loop overrides', async () => {
    const road = makeMix({
      id: 'p1',
      name: 'Road',
      kind: 'playlist',
      items: [
        // Loop overrides left from before: a playlist plays each sound once, so they go.
        makeMixItem({
          id: 'i1',
          soundId: 'crowd',
          loopStartSec: 10,
          loopEndSec: 60,
          crossfadeSec: 2,
        }),
        makeMixItem({ id: 'i2', soundId: 'drip' }),
      ],
    });
    const { user, saves, savedItems } = renderEditor({ mix: road });
    await user.click(
      listRow('Tavern crowd').getByRole('button', { name: 'Edit the loop of Tavern crowd' }),
    );
    expect(screen.queryByRole('dialog', { name: 'Loop editor' })).not.toBeInTheDocument();
    const dialog = within(screen.getByRole('dialog', { name: 'Track range' }));

    expect(dialog.getByRole('slider', { name: 'Track start' })).toBeInTheDocument();
    expect(dialog.getByRole('slider', { name: 'Track end' })).toBeInTheDocument();
    expect(dialog.getByRole('textbox', { name: 'Track start' })).toBeInTheDocument();
    expect(dialog.getByRole('textbox', { name: 'Track end' })).toBeInTheDocument();
    for (const name of ['Loop start', 'Loop end']) {
      expect(dialog.queryByRole('slider', { name })).not.toBeInTheDocument();
      expect(dialog.queryByRole('textbox', { name })).not.toBeInTheDocument();
    }
    expect(dialog.queryByRole('radiogroup', { name: 'Loop mode' })).not.toBeInTheDocument();
    expect(dialog.queryByText('Loop mode')).not.toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Play from the loop start' })).not.toBeInTheDocument();

    fireEvent.keyDown(dialog.getByRole('slider', { name: 'Track start' }), { key: 'ArrowRight' });
    await user.click(dialog.getByRole('button', { name: 'Apply' }));
    expect(screen.queryByRole('dialog', { name: 'Track range' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()).toMatchObject([{ url: '/api/mixes/p1', method: 'PATCH' }]);
    const items = savedItems()!;
    expect(items[0]).toMatchObject({
      soundId: 'crowd',
      trackStartSec: 0.1,
      loopStartSec: null,
      loopEndSec: null,
      crossfadeSec: null,
    });
    expect(items[1]).toMatchObject({ soundId: 'drip', trackStartSec: null });
  });

  it('opens the full loop editor for an item of a plain mix', async () => {
    const { user, row } = renderEditor({ mix });
    await user.click(row('Tavern crowd').getByRole('button', { name: 'Edit the loop of Tavern crowd' }));
    expect(screen.queryByRole('dialog', { name: 'Track range' })).not.toBeInTheDocument();
    const dialog = within(screen.getByRole('dialog', { name: 'Loop editor' }));
    expect(dialog.getByRole('slider', { name: 'Loop start' })).toBeInTheDocument();
    expect(dialog.getByRole('slider', { name: 'Loop end' })).toBeInTheDocument();
    expect(dialog.getByRole('textbox', { name: 'Loop start' })).toBeInTheDocument();
    expect(dialog.getByRole('textbox', { name: 'Loop end' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Play from the loop start' })).toBeInTheDocument();
  });

  it('sends kind mix when a new mix is created', async () => {
    const { user, saves } = renderEditor({ mix: null });
    expect(screen.getByRole('dialog', { name: 'New mix' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Inn');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[0].body).toMatchObject({ kind: 'mix', playlists: [] });
  });
});

describe('MixEditor playlists of a mix', () => {
  const road = makeMix({ id: 'p1', name: 'Road', kind: 'playlist' });
  const songs = makeMix({ id: 'p2', name: 'Songs', kind: 'playlist' });
  const other = makeMix({ id: 'm9', name: 'Harbor' });

  it('offers the user’s playlists only, and sends each with its volume', async () => {
    const { user, saves } = renderEditor({ mix, mixes: [mix, road, songs, other] });
    const field = within(screen.getByText('Playlists').parentElement!);
    await user.click(field.getByRole('button', { name: 'Choose Playlists' }));
    const picker = within(screen.getByRole('dialog', { name: 'Playlists' }));
    expect(picker.getByRole('checkbox', { name: /Road/ })).toBeInTheDocument();
    expect(picker.getByRole('checkbox', { name: /Songs/ })).toBeInTheDocument();
    expect(picker.queryByRole('checkbox', { name: /Harbor/ })).not.toBeInTheDocument();
    expect(picker.queryByRole('checkbox', { name: /Tavern evening/ })).not.toBeInTheDocument();
    await user.click(picker.getByRole('checkbox', { name: /Road/ }));
    await user.click(picker.getByRole('button', { name: 'Done' }));

    fireEvent.change(screen.getByRole('slider', { name: 'Volume of Road' }), {
      target: { value: '0.4' },
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()).toMatchObject([{ url: '/api/mixes/m1', method: 'PATCH' }]);
    expect(saves()[0].body.playlists).toEqual([{ playlistId: 'p1', volume: 0.4 }]);
  });

  describe('publishing a mix that holds private playlists', () => {
    const shown = makeSound({ id: 'crowd', name: 'Tavern crowd', isPublic: true });
    const hidden = makeSound({ id: 'drip', name: 'Drip', defaultMode: 'recurring' });
    const inList = makeSound({ id: 'bell', name: 'Bell' });
    const privateList = makeMix({
      id: 'p1',
      name: 'Road',
      kind: 'playlist',
      items: [
        makeMixItem({ id: 'pi1', soundId: 'drip' }),
        makeMixItem({ id: 'pi2', soundId: 'bell' }),
      ],
    });
    const publicList = makeMix({
      id: 'p2',
      name: 'Songs',
      kind: 'playlist',
      isPublic: true,
      items: [makeMixItem({ id: 'pi3', soundId: 'crowd' })],
    });
    const holding = (playlistId: string, soundIds = ['crowd', 'drip']) =>
      makeMix({
        id: 'm1',
        name: 'Tavern evening',
        items: soundIds.map((soundId, n) => makeMixItem({ id: `i${n}`, soundId, mode: 'loop' })),
        playlists: [{ playlistId, volume: 0.5 }],
      });
    const open = (mixUnderTest: Mix) =>
      renderEditor({
        mix: mixUnderTest,
        mixes: [mixUnderTest, privateList, publicList],
        sounds: [shown, hidden, inList],
      });

    it('lists the private playlist first, then each private sound once, with the count', async () => {
      const { user, saves } = open(holding('p1'));
      await user.click(screen.getByRole('radio', { name: 'Public' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));

      const dialog = within(screen.getByRole('dialog', { name: 'Publish this mix?' }));
      expect(
        dialog.getByText(
          'A public mix can only hold public sounds and playlists. If you publish it, these 3 private ones will be published too:',
        ),
      ).toBeInTheDocument();
      const rows = dialog.getAllByRole('listitem').map((li) => li.textContent);
      expect(rows).toEqual([
        'Roadplaylist, will be public',
        'Dripwill be public',
        'Bellwill be public',
      ]);
      expect(saves()).toEqual([]);
    });

    it('publishes the sounds, then the playlist, then saves the mix as public', async () => {
      const { user, saves } = open(holding('p1'));
      await user.click(screen.getByRole('radio', { name: 'Public' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await user.click(
        within(screen.getByRole('dialog', { name: 'Publish this mix?' })).getByRole('button', {
          name: 'Publish them too',
        }),
      );

      const sent = saves();
      expect(sent.map(({ url, method }) => `${method} ${url}`)).toEqual([
        'PATCH /api/sounds/drip',
        'PATCH /api/sounds/bell',
        'PATCH /api/mixes/p1',
        'PATCH /api/mixes/m1',
      ]);
      expect(sent.slice(0, 3).map((s) => s.body)).toEqual([
        { isPublic: true },
        { isPublic: true },
        { isPublic: true },
      ]);
      expect(sent[3].body).toMatchObject({
        isPublic: true,
        playlists: [{ playlistId: 'p1', volume: 0.5 }],
      });
      expect(screen.queryByRole('dialog', { name: 'Publish this mix?' })).not.toBeInTheDocument();
    });

    it('saves nothing when the question is cancelled', async () => {
      const { user, saves } = open(holding('p1'));
      await user.click(screen.getByRole('radio', { name: 'Public' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await user.click(
        within(screen.getByRole('dialog', { name: 'Publish this mix?' })).getByRole('button', {
          name: 'Cancel',
        }),
      );
      expect(screen.queryByRole('dialog', { name: 'Publish this mix?' })).not.toBeInTheDocument();
      expect(saves()).toEqual([]);
    });

    it('asks nothing for a public playlist when every sound is public', async () => {
      const { user, saves } = open(holding('p2', ['crowd']));
      await user.click(screen.getByRole('radio', { name: 'Public' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(screen.queryByRole('dialog', { name: 'Publish this mix?' })).not.toBeInTheDocument();
      expect(saves().map(({ url, method }) => `${method} ${url}`)).toEqual(['PATCH /api/mixes/m1']);
      expect(saves()[0].body).toMatchObject({
        isPublic: true,
        playlists: [{ playlistId: 'p2', volume: 0.5 }],
      });
    });
  });

  describe('making a public playlist or mix private', () => {
    const road = makeMix({
      id: 'p1',
      name: 'Road',
      kind: 'playlist',
      isPublic: true,
      items: [makeMixItem({ id: 'pi1', soundId: 'crowd' })],
    });
    const holder = (id: string, name: string, over: Partial<Mix> = {}) =>
      makeMix({ id, name, isPublic: true, playlists: [{ playlistId: 'p1', volume: 1 }], ...over });
    const harbor = holder('m1', 'Harbor');
    const forest = holder('m2', 'Forest');
    const hidden = holder('m3', 'Hidden', { isPublic: false });
    const theirs = holder('m4', 'Theirs', { access: 'added' });
    const unrelated = makeMix({ id: 'm5', name: 'Unrelated', isPublic: true });
    // A public playlist holds public sounds only, or saving it public asks to publish them.
    const publicCrowd = { ...crowd, isPublic: true };
    const open = (others: Mix[], playlist: Mix = road) =>
      renderEditor({ mix: playlist, mixes: [playlist, ...others], sounds: [publicCrowd, drip] });
    const question = () => screen.queryByRole('dialog', { name: 'Make it private?' });
    const sentList = (saves: () => { url: string; method?: string }[]) =>
      saves().map(({ url, method }) => `${method} ${url}`);
    const INTRO = (n: number) =>
      `A public mix can only hold public items, so it will be taken out of these ${n} public mixes of yours:`;

    it('lists only the owner’s public mixes that hold it, each staying public, with the count', async () => {
      const { user, saves } = open([harbor, forest, hidden, theirs, unrelated]);
      await user.click(screen.getByRole('radio', { name: 'Private' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));

      const dialog = within(question()!);
      expect(dialog.getByText(INTRO(2))).toBeInTheDocument();
      expect(dialog.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        'Harborstays public',
        'Foreststays public',
      ]);
      expect(dialog.getByRole('button', { name: 'Make it private' })).toBeInTheDocument();
      expect(dialog.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      expect(dialog.queryByText(/other game master/)).not.toBeInTheDocument();
      expect(saves()).toEqual([]);
    });

    it('says how many other game masters lose it, one or several', async () => {
      const first = open([harbor], { ...road, addedCount: 1 });
      await first.user.click(screen.getByRole('radio', { name: 'Private' }));
      await first.user.click(screen.getByRole('button', { name: 'Save' }));
      expect(
        within(question()!).getByText('1 other game master added it and will lose it.'),
      ).toBeInTheDocument();
      cleanup();

      const second = open([harbor], { ...road, addedCount: 3 });
      await second.user.click(screen.getByRole('radio', { name: 'Private' }));
      await second.user.click(screen.getByRole('button', { name: 'Save' }));
      expect(
        within(question()!).getByText('3 other game masters added it and will lose it.'),
      ).toBeInTheDocument();
    });

    it('confirming only saves the playlist as private, never the holding mixes', async () => {
      const { user, saves } = open([harbor, forest, hidden, theirs]);
      await user.click(screen.getByRole('radio', { name: 'Private' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await user.click(within(question()!).getByRole('button', { name: 'Make it private' }));

      expect(sentList(saves)).toEqual(['PATCH /api/mixes/p1']);
      expect(saves()[0].body).toMatchObject({ isPublic: false });
      expect(saves()[0].body).not.toHaveProperty('playlists');
      expect(question()).not.toBeInTheDocument();
    });

    it('saves nothing when the question is cancelled', async () => {
      const { user, saves } = open([harbor]);
      await user.click(screen.getByRole('radio', { name: 'Private' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await user.click(within(question()!).getByRole('button', { name: 'Cancel' }));
      expect(question()).not.toBeInTheDocument();
      expect(saves()).toEqual([]);
    });

    it('asks for a mix added by others, with no list of holders, and saves it alone', async () => {
      const shared = makeMix({ id: 'm7', name: 'Docks', isPublic: true, addedCount: 2 });
      const { user, saves } = renderEditor({ mix: shared, mixes: [shared, harbor] });
      await user.click(screen.getByRole('radio', { name: 'Private' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));

      const dialog = within(question()!);
      expect(dialog.getByText('2 other game masters added it and will lose it.')).toBeInTheDocument();
      expect(dialog.queryByText(/public mixes of yours/)).not.toBeInTheDocument();
      expect(dialog.queryAllByRole('listitem')).toEqual([]);
      expect(saves()).toEqual([]);

      await user.click(dialog.getByRole('button', { name: 'Make it private' }));
      expect(sentList(saves)).toEqual(['PATCH /api/mixes/m7']);
      expect(saves()[0].body).toMatchObject({ isPublic: false });
    });

    it('asks nothing for a mix nobody added, turned private', async () => {
      const lone = makeMix({ id: 'm8', name: 'Alone', isPublic: true });
      const { user, saves } = renderEditor({ mix: lone, mixes: [lone] });
      await user.click(screen.getByRole('radio', { name: 'Private' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(question()).not.toBeInTheDocument();
      expect(sentList(saves)).toEqual(['PATCH /api/mixes/m8']);
      expect(saves()[0].body).toMatchObject({ isPublic: false });
    });

    it('asks nothing when only a private own mix or another user’s mix holds it', async () => {
      const { user, saves } = open([hidden, theirs]);
      await user.click(screen.getByRole('radio', { name: 'Private' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(question()).not.toBeInTheDocument();
      expect(sentList(saves)).toEqual(['PATCH /api/mixes/p1']);
      expect(saves()[0].body).toMatchObject({ isPublic: false });
    });

    it('asks nothing when the playlist stays public, or was private already', async () => {
      const first = open([harbor]);
      await first.user.click(screen.getByRole('button', { name: 'Save' }));
      expect(question()).not.toBeInTheDocument();
      expect(sentList(first.saves)).toEqual(['PATCH /api/mixes/p1']);
      expect(first.saves()[0].body).toMatchObject({ isPublic: true });
      cleanup();

      const second = open([harbor], { ...road, isPublic: false });
      await second.user.click(screen.getByRole('button', { name: 'Save' }));
      expect(question()).not.toBeInTheDocument();
      expect(sentList(second.saves)).toEqual(['PATCH /api/mixes/p1']);
      expect(second.saves()[0].body).toMatchObject({ isPublic: false });
    });
  });

  it('keeps the playlists a mix already holds, at their volume', async () => {
    const holding = { ...mix, playlists: [{ playlistId: 'p2', volume: 0.3 }] };
    const { user, saves } = renderEditor({ mix: holding, mixes: [holding, road, songs] });
    expect(screen.getByRole('slider', { name: 'Volume of Songs' })).toHaveValue('0.3');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[0].body.playlists).toEqual([{ playlistId: 'p2', volume: 0.3 }]);
  });
});
