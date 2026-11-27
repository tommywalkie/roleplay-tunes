import type { Category, Mix, Sound } from '@dnd/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerProvider } from '../audio/player';
import { illustrationChanges } from '../components/IllustrationField';
import { I18nProvider } from '../i18n';
import { makeFakeEngine, makeMe, makeMix, makeMixItem, makeSound } from '../test/fixtures';
import { SoundEditor } from './SoundEditor';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

const category = (id: string, name: string): Category => ({
  id,
  name,
  color: '#3b5b8c',
  icon: null,
  createdAt: '2026-11-01T10:00:00.000Z',
});

const icons = {
  '/icons/index.json': [{ id: 'game', label: 'Game icons', count: 2 }],
  '/icons/game.json': {
    icons: {
      dragon: { m: '<svg data-icon="dragon"></svg>', l: 'Dragon' },
      sword: { m: '<svg data-icon="sword"></svg>', l: 'Sword' },
    },
  },
};

function renderEditor(sound: Sound = makeSound(), categories: Category[] = [], mixes?: Mix[]) {
  const routes: Record<string, unknown> = {
    '/api/synonyms': [],
    '/api/categories': categories,
    ...icons,
  };
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
    json(200, url in routes ? routes[url] : sound),
  );
  vi.stubGlobal('fetch', fetchMock);
  // The loop editor reads the waveform through the player, so the editor runs inside a
  // PlayerProvider with a fake engine, as in PlayerPanel.test.tsx.
  const fake = makeFakeEngine();
  fake.spies.getWaveformPeaks.mockResolvedValue(new Float32Array(480));
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider initial="en">
        <PlayerProvider sounds={[sound]} engine={fake.engine}>
          <SoundEditor sound={sound} scenes={[]} mixes={mixes} me={makeMe()} onClose={() => {}} />
        </PlayerProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  /** Requests that change something, in order; reads that follow a save are left out. */
  const saves = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method && init.method !== 'GET')
      .map(([url, init]) => ({
        url,
        method: init!.method,
        // A DELETE carries no body.
        body: init!.body === undefined ? undefined : JSON.parse(String(init!.body)),
      }));
  return { user: userEvent.setup(), fetchMock, saves, fake };
}

describe('SoundEditor', () => {
  it('lets the owner set description, license and visibility', async () => {
    const { user, saves } = renderEditor();
    await user.type(screen.getByLabelText('Description'), 'Crowd in a busy inn');
    await user.selectOptions(screen.getByLabelText('License'), 'CC BY 4.0');
    expect(screen.queryByLabelText('Your license')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Public' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const [save] = saves();
    expect(save.url).toBe('/api/sounds/s1');
    expect(save.body).toMatchObject({
      description: 'Crowd in a busy inn',
      license: 'CC BY 4.0',
      isPublic: true,
    });
  });

  it('keeps every detail field, description included, folded behind More details', async () => {
    const { user } = renderEditor();
    const header = screen.getByRole('button', { name: 'More details' });
    expect(header).toHaveAttribute('aria-expanded', 'false');

    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    for (const label of ['Artists', 'Year', 'Movie', 'Game', 'TV show / Anime', 'Album', 'Link']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    // The description keeps its place inside the section, after the detail fields.
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
  });

  it('saves the detail fields with the rest of the sound', async () => {
    const { user, saves } = renderEditor();
    await user.click(screen.getByRole('button', { name: 'More details' }));
    await user.type(screen.getByLabelText('Artists'), 'The Chieftains');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[0].body).toMatchObject({ artists: 'The Chieftains' });
  });

  it('opens the details when the More details header is clicked', async () => {
    const { user } = renderEditor();
    const header = screen.getByRole('button', { name: 'More details' });
    // The controlled panel, found through the header, is what opens: its contents stay
    // mounted while folded, so the state shows as the panel gaining its opacity.
    const panel = document.getElementById(header.getAttribute('aria-controls')!)!;
    expect(panel).toContainElement(screen.getByLabelText('Artists'));
    expect(panel).toHaveClass('opacity-0');

    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toHaveClass('opacity-100');
  });

  it('saves the typed text when the license is Other', async () => {
    const { user, saves } = renderEditor();
    await user.selectOptions(screen.getByLabelText('License'), 'Other');
    await user.type(screen.getByLabelText('Your license'), 'Recorded by Jo, credit required');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[0].body).toMatchObject({ license: 'Recorded by Jo, credit required' });
  });

  it('shows a sound without a license as Unknown and saves it unchanged', async () => {
    const { user, saves } = renderEditor();
    expect(screen.getByLabelText('License')).toHaveDisplayValue('Unknown');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[0].body).toMatchObject({ license: '' });
  });

  it('saves the options worded per language as codes', async () => {
    const { user, saves } = renderEditor(makeSound({ license: 'CC0 1.0' }));
    const license = screen.getByLabelText('License');
    await user.selectOptions(license, 'Copyrighted');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[0].body).toMatchObject({ license: 'private-use' });

    await user.selectOptions(license, 'Unknown');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[1].body).toMatchObject({ license: 'unknown' });
  });

  it('opens a custom license on Other with its text filled in', () => {
    renderEditor(makeSound({ license: 'Free for streams' }));
    expect(screen.getByLabelText('License')).toHaveDisplayValue('Other');
    expect(screen.getByLabelText('Your license')).toHaveValue('Free for streams');
  });

  it('picks an icon in its own dialog, which closes and updates the preview', async () => {
    const { user, saves } = renderEditor();
    const editor = screen.getByRole('dialog', { name: 'Edit sound' });

    await user.click(within(editor).getByRole('button', { name: 'Choose icon' }));
    const picker = within(screen.getByRole('dialog', { name: 'Choose icon' }));
    await user.click(await picker.findByRole('button', { name: 'Dragon' }));

    expect(screen.queryByRole('dialog', { name: 'Choose icon' })).not.toBeInTheDocument();
    expect(editor.querySelector('[data-icon="dragon"]')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[0].body).toMatchObject({ illustration: { type: 'icon', iconId: 'game:dragon' } });
  });

  it('sends the owner’s synonyms and categories with the sound', async () => {
    const sound = makeSound({ synonyms: [{ label: 'tavern', mine: true }], categoryIds: [] });
    const { user, saves } = renderEditor(sound, [category('c1', 'Inn'), category('c2', 'Night')]);
    await user.type(screen.getByRole('combobox', { name: 'Synonyms' }), 'pub{Enter}');

    const categories = screen.getByRole('combobox', { name: 'Categories' });
    await user.type(categories, 'Ni');
    await user.click(await screen.findByRole('option', { name: 'Night' }));
    expect(screen.getByRole('button', { name: 'Remove the Night category' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[0].body).toMatchObject({ synonyms: ['tavern', 'pub'], categoryIds: ['c2'] });
  });

  it('greys out the owner fields of an added sound and saves only the user’s own settings', async () => {
    const sound = makeSound({ access: 'added', ownerName: 'Grace', isPublic: true });
    const { user, saves } = renderEditor(sound);

    expect(screen.getByText('Shared by Grace. Only they can change it')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Description')).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Public' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose image' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Synonyms' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove from my library' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[0].body).toEqual({ defaultVolume: 0.8, sceneIds: [], synonyms: [], categoryIds: [] });
  });

  it('lets a user who added a sound tag it, keeping the owner’s synonyms out of the request', async () => {
    const sound = makeSound({
      access: 'added',
      ownerName: 'Grace',
      isPublic: true,
      synonyms: [
        { label: 'bells', mine: false },
        { label: 'chimes', mine: true },
      ],
      categoryIds: ['c1'],
    });
    const { user, saves } = renderEditor(sound, [category('c1', 'Harbor'), category('c2', 'Night')]);

    const chips = within(screen.getByRole('list', { name: 'Synonyms' }));
    expect(chips.getByText('bells')).toHaveAttribute('title', 'Added by Grace');
    expect(chips.queryByRole('button', { name: 'Remove bells' })).not.toBeInTheDocument();
    expect(chips.getByRole('button', { name: 'Remove chimes' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Remove the Harbor category' })).toBeInTheDocument();

    await user.type(screen.getByRole('combobox', { name: 'Synonyms' }), 'gong{Enter}');
    await user.type(screen.getByRole('combobox', { name: 'Categories' }), 'Ni');
    await user.click(await screen.findByRole('option', { name: 'Night' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const [save] = saves();
    expect(save.url).toBe('/api/sounds/s1');
    expect(save.body).toEqual({
      defaultVolume: 0.8,
      sceneIds: [],
      synonyms: ['chimes', 'gong'],
      categoryIds: ['c1', 'c2'],
    });
  });
});

describe('SoundEditor loop editor', () => {
  it('opens the loop editor stacked over the sound editor', async () => {
    const { user } = renderEditor();
    await user.click(screen.getByRole('button', { name: 'Edit loop' }));

    const loop = screen.getByRole('dialog', { name: 'Loop editor' });
    expect(loop.closest('[data-dialog-state]')).toHaveAttribute('data-dialog-state', 'shown');
    // The sound editor stays mounted underneath, covered, and comes back on close.
    const covered = screen.getByRole('dialog', { name: 'Edit sound', hidden: true });
    expect(covered.closest('[data-dialog-state]')).toHaveAttribute('data-dialog-state', 'covered');

    await user.click(within(loop).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Loop editor' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Edit sound' })).toBeInTheDocument();
  });

  it('opens the loop editor for a Once sound and for a Random gaps sound', async () => {
    for (const defaultMode of ['oneshot', 'recurring'] as const) {
      const { user } = renderEditor(makeSound({ defaultMode, durationSec: 60 }));
      await user.click(screen.getByRole('button', { name: 'Edit loop' }));
      const loop = within(screen.getByRole('dialog', { name: 'Loop editor' }));
      expect(loop.getByRole('textbox', { name: 'Track end' })).toHaveValue('01:00:00');
      await user.click(loop.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog', { name: 'Loop editor' })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('always offers the crossfade slider, at 0 (gapless) by default', async () => {
    const { user } = renderEditor();
    await user.click(screen.getByRole('button', { name: 'Edit loop' }));
    const loop = within(screen.getByRole('dialog', { name: 'Loop editor' }));
    expect(loop.getByRole('slider', { name: 'Crossfade length, seconds' })).toHaveValue('0');
  });

  it('hides the crossfade slider when the loop is shorter than 1 s', async () => {
    const { user } = renderEditor(makeSound({ durationSec: 0.5 }));
    await user.click(screen.getByRole('button', { name: 'Edit loop' }));
    const loop = within(screen.getByRole('dialog', { name: 'Loop editor' }));
    expect(loop.queryByRole('slider', { name: 'Crossfade length, seconds' })).not.toBeInTheDocument();
  });

  it('sends null for every loop field when the loop stays at the default edges', async () => {
    const { user, saves } = renderEditor();
    await user.click(screen.getByRole('button', { name: 'Edit loop' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Loop editor' })).getByRole('button', {
        name: 'Apply',
      }),
    );
    // Applying closed the loop editor and brought the sound editor back.
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const [save] = saves();
    expect(save.url).toBe('/api/sounds/s1');
    expect(save.method).toBe('PATCH');
    expect(save.body).toMatchObject({
      trackStartSec: null,
      trackEndSec: null,
      loopStartSec: null,
      loopEndSec: null,
      crossfadeSec: null,
    });
  });

  it('saves the loop fields set in the dialog in the PATCH body', async () => {
    const { user, saves } = renderEditor();
    await user.click(screen.getByRole('button', { name: 'Edit loop' }));
    const loop = within(screen.getByRole('dialog', { name: 'Loop editor' }));

    // Move the loop start by one step (0.1 s) and set a 3 s crossfade.
    fireEvent.keyDown(loop.getByRole('slider', { name: 'Loop start' }), { key: 'ArrowRight' });
    fireEvent.change(loop.getByRole('slider', { name: 'Crossfade length, seconds' }), {
      target: { value: '3' },
    });
    await user.click(loop.getByRole('button', { name: 'Apply' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [save] = saves();
    expect(save.url).toBe('/api/sounds/s1');
    expect(save.method).toBe('PATCH');
    expect(save.body).toMatchObject({
      trackStartSec: null,
      trackEndSec: null,
      loopStartSec: 0.1,
      loopEndSec: null,
      crossfadeSec: 3,
    });
  });

  it('runs the test sequence from its icon buttons and moves a marker to the playhead', async () => {
    const { user, fake } = renderEditor(makeSound({ durationSec: 60 }));
    let at = 0;
    const handle = {
      update: vi.fn(),
      playFromStart: vi.fn(),
      seekTo: vi.fn((sec: number) => {
        at = sec;
      }),
      pause: vi.fn(),
      resume: vi.fn(),
      auditionSeam: vi.fn(),
      getPosition: vi.fn(() => at),
      isPlaying: vi.fn(() => true),
      stop: vi.fn(),
    };
    fake.spies.previewSequence.mockReturnValue(handle);
    await user.click(screen.getByRole('button', { name: 'Edit loop' }));
    const loop = within(screen.getByRole('dialog', { name: 'Loop editor' }));

    expect(loop.getByRole('scrollbar', { name: 'Whole track. Drag the box to scroll' })).toBeInTheDocument();
    expect(loop.getByRole('slider', { name: 'Playhead' })).toBeInTheDocument();
    for (const name of ['Track start', 'Loop start', 'Loop end', 'Track end']) {
      expect(loop.getByRole('slider', { name })).toBeInTheDocument();
      expect(loop.getByRole('textbox', { name })).toBeInTheDocument();
    }
    expect(loop.getByRole('textbox', { name: 'Track end' })).toHaveValue('01:00:00');
    expect(loop.getByRole('button', { name: 'Stop the test' })).toBeDisabled();

    await user.click(loop.getByRole('button', { name: 'Play' }));
    expect(fake.spies.previewSequence).toHaveBeenCalledTimes(1);
    expect(handle.seekTo).toHaveBeenLastCalledWith(0);
    expect(loop.getByRole('button', { name: 'Stop the test' })).toBeEnabled();

    await user.click(loop.getByRole('button', { name: 'Pause the test' }));
    expect(handle.pause).toHaveBeenCalledTimes(1);
    await user.click(loop.getByRole('button', { name: 'Resume the test' }));
    expect(handle.resume).toHaveBeenCalledTimes(1);

    await user.click(loop.getByRole('button', { name: 'Play from the track start' }));
    expect(handle.playFromStart).toHaveBeenCalledTimes(1);

    // Typing an exact time (mm:ss:cc) moves the marker.
    const loopStart = loop.getByRole('textbox', { name: 'Loop start' });
    await user.clear(loopStart);
    await user.type(loopStart, '00:12:50{Enter}');
    expect(loopStart).toHaveValue('00:12:50');

    await user.click(loop.getByRole('button', { name: 'Play from the loop start' }));
    expect(handle.seekTo).toHaveBeenLastCalledWith(12.5);

    // The playhead sits at the loop start now: move the track start there.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    await user.click(loop.getByRole('button', { name: 'Move the track start to the playhead' }));
    expect(loop.getByRole('textbox', { name: 'Track start' })).toHaveValue('00:12:50');

    await user.click(loop.getByRole('button', { name: 'Stop the test' }));
    expect(handle.stop).toHaveBeenCalled();
    expect(loop.getByRole('button', { name: 'Stop the test' })).toBeDisabled();
    expect(loop.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });
});

describe('SoundEditor loop of an added sound', () => {
  const added = (over: Partial<Sound> = {}) =>
    makeSound({ access: 'added', ownerName: 'Grace', isPublic: true, durationSec: 60, ...over });

  it('lets the user open the loop editor, saying the loop is their own', async () => {
    const { user } = renderEditor(added());
    expect(screen.getByText('Your own loop. It does not change it for anyone else')).toBeInTheDocument();
    const edit = screen.getByRole('button', { name: 'Edit loop' });
    expect(edit).toBeEnabled();
    await user.click(edit);
    expect(screen.getByRole('dialog', { name: 'Loop editor' })).toBeInTheDocument();
  });

  it('sends their own loop settings once they changed them', async () => {
    const { user, saves } = renderEditor(added());
    await user.click(screen.getByRole('button', { name: 'Edit loop' }));
    const loop = within(screen.getByRole('dialog', { name: 'Loop editor' }));
    fireEvent.keyDown(loop.getByRole('slider', { name: 'Loop start' }), { key: 'ArrowRight' });
    await user.click(loop.getByRole('button', { name: 'Apply' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const [save] = saves();
    expect(save.url).toBe('/api/sounds/s1');
    expect(save.method).toBe('PATCH');
    expect(save.body).toEqual({
      defaultVolume: 0.8,
      sceneIds: [],
      synonyms: [],
      categoryIds: [],
      trackStartSec: null,
      trackEndSec: null,
      loopStartSec: 0.1,
      loopEndSec: null,
      crossfadeSec: null,
    });
  });

  it('sends no loop field when the loop was applied unchanged', async () => {
    const { user, saves } = renderEditor(
      added({ loopStartSec: 5, loopEndSec: 20, crossfadeSec: 1.5 }),
    );
    await user.click(screen.getByRole('button', { name: 'Edit loop' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Loop editor' })).getByRole('button', {
        name: 'Apply',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[0].body).toEqual({
      defaultVolume: 0.8,
      sceneIds: [],
      synonyms: [],
      categoryIds: [],
    });
  });
});

describe('SoundEditor making a public sound private', () => {
  const sound = (over: Partial<Sound> = {}) => makeSound({ id: 's1', isPublic: true, ...over });
  const holder = (id: string, name: string, over: Partial<Mix> = {}) =>
    makeMix({
      id,
      name,
      isPublic: true,
      items: [makeMixItem({ id: `${id}-i`, soundId: 's1' })],
      ...over,
    });
  const harbor = holder('m1', 'Harbor');
  const road = holder('p1', 'Road', { kind: 'playlist' });
  const hidden = holder('m3', 'Hidden', { isPublic: false });
  const theirs = holder('m4', 'Theirs', { access: 'added' });
  const unrelated = makeMix({ id: 'm5', name: 'Unrelated', isPublic: true });
  const question = () => screen.queryByRole('dialog', { name: 'Make it private?' });
  const sent = (saves: () => { url: string; method?: string }[]) =>
    saves().map(({ url, method }) => `${method} ${url}`);
  const INTRO = (n: number) =>
    `A public mix can only hold public items, so it will be taken out of these ${n} public mixes of yours:`;

  it('lists the owner’s public mixes and playlists that hold it, each staying public', async () => {
    const { user, saves } = renderEditor(sound(), [], [harbor, road, hidden, theirs, unrelated]);
    await user.click(screen.getByRole('radio', { name: 'Private' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const dialog = within(question()!);
    expect(dialog.getByText(INTRO(2))).toBeInTheDocument();
    expect(dialog.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Harborstays public',
      'Roadstays public',
    ]);
    expect(dialog.getByRole('button', { name: 'Make it private' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(dialog.queryByText(/other game master/)).not.toBeInTheDocument();
    expect(saves()).toEqual([]);
  });

  it('says how many other game masters added it, even with no mix holding it', async () => {
    const { user, saves } = renderEditor(sound({ addedCount: 1 }), [], []);
    await user.click(screen.getByRole('radio', { name: 'Private' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = within(question()!);
    expect(dialog.getByText('1 other game master added it and will lose it.')).toBeInTheDocument();
    expect(dialog.queryByText(/public mixes of yours/)).not.toBeInTheDocument();
    expect(saves()).toEqual([]);
    cleanup();

    const second = renderEditor(sound({ addedCount: 4 }), [], [harbor]);
    await second.user.click(screen.getByRole('radio', { name: 'Private' }));
    await second.user.click(screen.getByRole('button', { name: 'Save' }));
    const both = within(question()!);
    expect(both.getByText(INTRO(1))).toBeInTheDocument();
    expect(both.getByText('4 other game masters added it and will lose it.')).toBeInTheDocument();
  });

  it('confirming only saves the sound as private, never the holding mixes', async () => {
    const { user, saves } = renderEditor(sound({ addedCount: 2 }), [], [harbor, road]);
    await user.click(screen.getByRole('radio', { name: 'Private' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(question()!).getByRole('button', { name: 'Make it private' }));

    expect(sent(saves)).toEqual(['PATCH /api/sounds/s1']);
    expect(saves()[0].body).toMatchObject({ isPublic: false });
    expect(question()).not.toBeInTheDocument();
  });

  it('saves nothing when the question is cancelled', async () => {
    const { user, saves } = renderEditor(sound(), [], [harbor]);
    await user.click(screen.getByRole('radio', { name: 'Private' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(question()!).getByRole('button', { name: 'Cancel' }));
    expect(question()).not.toBeInTheDocument();
    expect(saves()).toEqual([]);
  });

  it('asks nothing when only a private own mix or another user’s mix holds it, and nobody added it', async () => {
    const { user, saves } = renderEditor(sound(), [], [hidden, theirs, unrelated]);
    await user.click(screen.getByRole('radio', { name: 'Private' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(question()).not.toBeInTheDocument();
    expect(sent(saves)).toEqual(['PATCH /api/sounds/s1']);
    expect(saves()[0].body).toMatchObject({ isPublic: false });
  });

  it('asks nothing when the sound stays public, or was private already', async () => {
    const first = renderEditor(sound({ addedCount: 3 }), [], [harbor]);
    await first.user.click(screen.getByRole('button', { name: 'Save' }));
    expect(question()).not.toBeInTheDocument();
    expect(sent(first.saves)).toEqual(['PATCH /api/sounds/s1']);
    expect(first.saves()[0].body).toMatchObject({ isPublic: true });
    cleanup();

    const second = renderEditor(sound({ isPublic: false }), [], [harbor]);
    await second.user.click(screen.getByRole('button', { name: 'Save' }));
    expect(question()).not.toBeInTheDocument();
    expect(sent(second.saves)).toEqual(['PATCH /api/sounds/s1']);
    expect(second.saves()[0].body).toMatchObject({ isPublic: false });
  });
});

describe('SoundEditor removing an added sound from the library', () => {
  const added = makeSound({ id: 's1', access: 'added', ownerName: 'Grace', isPublic: true });
  const REMOVE = 'Remove from my library';
  const BLOCKED =
    'Mixes you added from the Library use this sound. They are not yours and need it, so it stays until you remove them:';
  const addedMix = (id: string, name: string, over: Partial<Mix> = {}) =>
    makeMix({
      id,
      name,
      isPublic: true,
      access: 'added',
      ownerName: 'Grace',
      items: [makeMixItem({ id: `${id}-i`, soundId: 's1' })],
      ...over,
    });

  it('explains which added mixes keep it, with only a Back button, and sends nothing', async () => {
    const docks = addedMix('m1', 'Docks');
    const ballads = addedMix('p1', 'Ballads', { kind: 'playlist' });
    // The user's own mix holding the sound does not block anything.
    const mine = makeMix({
      id: 'm2',
      name: 'Mine',
      items: [makeMixItem({ id: 'm2-i', soundId: 's1' })],
    });
    const { user, saves } = renderEditor(added, [], [docks, ballads, mine]);
    await user.click(screen.getByRole('button', { name: REMOVE }));

    const dialog = within(screen.getByRole('dialog', { name: REMOVE }));
    expect(dialog.getByText(BLOCKED)).toBeInTheDocument();
    expect(dialog.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Docks',
      'Ballads',
    ]);
    expect(dialog.getAllByRole('button').map((b) => b.textContent)).not.toContain(REMOVE);
    expect(dialog.queryByRole('button', { name: REMOVE })).not.toBeInTheDocument();

    await user.click(dialog.getByRole('button', { name: 'Back' }));
    expect(screen.queryByText(BLOCKED)).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Edit sound' })).toBeInTheDocument();
    expect(saves()).toEqual([]);
  });

  it('confirms and removes it when no added mix holds it', async () => {
    const mine = makeMix({
      id: 'm2',
      name: 'Mine',
      items: [makeMixItem({ id: 'm2-i', soundId: 's1' })],
    });
    const elsewhere = addedMix('m3', 'Elsewhere', { items: [] });
    const { user, saves } = renderEditor(added, [], [mine, elsewhere]);
    await user.click(screen.getByRole('button', { name: REMOVE }));

    const dialog = within(screen.getByRole('dialog', { name: REMOVE }));
    expect(dialog.queryByText(BLOCKED)).not.toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: REMOVE }));
    expect(saves().map(({ url, method }) => `${method} ${url}`)).toEqual([
      'DELETE /api/library/sounds/s1',
    ]);
  });
});

describe('illustrationChanges', () => {
  it('sends the key of a reused image, nothing when it is unchanged', () => {
    const image = { type: 'image' as const, url: '/api/images/0b6f3c3e-8c1d-4c2a-9a37-3d1f2e4b5c6d' };
    expect(illustrationChanges(image, { type: 'none' })).toEqual({
      illustration: { type: 'image', imageKey: '0b6f3c3e-8c1d-4c2a-9a37-3d1f2e4b5c6d' },
    });
    expect(illustrationChanges(image, image)).toEqual({});
  });
});
