import type { Mix, Scene, Sound } from '@dnd/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { PlayerProvider } from '../audio/player';
import { I18nProvider } from '../i18n';
import { makeFakeEngine, makeMix, makeMixItem, makeSound } from '../test/fixtures';
import { LibraryPage } from './LibraryPage';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

const bells = makeSound({
  id: 'pub1',
  name: 'Harbor bells',
  isPublic: true,
  access: 'available',
  ownerName: 'Grace Hopper',
  description: 'Bells across the water',
  license: 'private-use',
  defaultMode: 'loop',
  durationSec: 168,
  synonyms: [{ label: 'chimes', mine: false }],
});
const wind = makeSound({
  id: 'pub2',
  name: 'Cold wind',
  isPublic: true,
  access: 'added',
  license: 'unknown',
  synonyms: [{ label: 'gale', mine: true }],
  categoryIds: ['c1'],
});
// Added outright and used by no other mix of theirs: the one sound that can really come
// out with the mix being removed.
const gong = makeSound({ id: 'pub3', name: 'Temple gong', isPublic: true, access: 'added' });
const outdoors = {
  id: 'c1',
  name: 'Outdoors',
  color: '#5a7d3a',
  icon: null,
  createdAt: '2026-11-01T10:00:00.000Z',
};
const rain = makeSound({
  id: 'mine',
  name: 'My rain',
  isPublic: true,
  access: 'owner',
  license: 'CC BY 4.0',
});
// A public sound carrying where it comes from: every detail field filled, the url a link.
const lute = makeSound({
  id: 'pub4',
  name: 'Bard lute',
  isPublic: true,
  access: 'available',
  ownerName: 'Grace Hopper',
  artists: 'The Chieftains',
  year: '1975',
  movie: 'Braveheart',
  game: 'The Witcher 3',
  tv: 'Outlander',
  album: 'Celtic Dawn',
  url: 'https://example.com/bard',
});
// A public sound other users have already taken: the count reads as words behind the mark.
const crowd = makeSound({
  id: 'pub5',
  name: 'Tavern crowd',
  isPublic: true,
  access: 'available',
  ownerName: 'Grace Hopper',
  addedCount: 3,
});
const item = (id: string, soundId: string) =>
  makeMixItem({
    id,
    soundId,
    mode: 'loop',
    volume: 1,
    intervalMinSec: 20,
    intervalMaxSec: 90,
    volumeVariation: 0,
  });
const market = makeMix({
  id: 'pm1',
  name: 'Market day',
  isPublic: true,
  access: 'available',
  ownerName: 'Grace Hopper',
  items: [item('i1', 'pub1'), item('i2', 'pub2'), item('i3', 'mine')],
});
// A second mix the user already added, and one of their own: a sound either of them still
// uses cannot come out with the mix being removed.
const watch = makeMix({
  id: 'pm2',
  name: 'Night watch',
  isPublic: true,
  access: 'added',
  ownerName: 'Grace Hopper',
  items: [item('w1', 'pub3'), item('w2', 'pub2'), item('w3', 'mine')],
});
const study = makeMix({ id: 'own1', name: 'My study', items: [item('s1', 'pub2')] });
const scene = (id: string, name: string, over: Partial<Scene> = {}): Scene => ({
  id,
  name,
  position: 0,
  illustration: { type: 'none' },
  soundIds: [],
  mixIds: [],
  synonyms: [],
  categoryIds: [],
  createdAt: '2026-11-01T10:00:00.000Z',
  ...over,
});

function renderLibrary(board: { sounds?: Sound[]; mixes?: Mix[]; scenes?: Scene[] } = {}) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
    if (url === '/api/library')
      return json(200, {
        sounds: board.sounds ?? [bells, wind, rain, gong],
        mixes: [market, watch],
      });
    if (url === '/api/sounds') return json(200, []);
    if (url === '/api/mixes') return json(200, board.mixes ?? [study]);
    if (url === '/api/scenes') return json(200, board.scenes ?? []);
    if (url === '/api/categories') return json(200, [outdoors]);
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const fake = makeFakeEngine();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider initial="en">
        <PlayerProvider sounds={[]} engine={fake.engine}>
          <LibraryPage />
        </PlayerProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...fake, fetchMock, user: userEvent.setup() };
}

/** The list row of an item, found by its name. */
const rowOf = async (name: string) => within((await screen.findByText(name)).closest('li')!);

describe('LibraryPage', () => {
  it('finds items by the synonyms the user sees on them, the owner’s or their own', async () => {
    const { user } = renderLibrary();
    await rowOf('Harbor bells');
    const search = screen.getByRole('searchbox', { name: 'Search' });

    await user.type(search, 'chimes');
    expect(screen.getByText('Harbor bells')).toBeInTheDocument();
    expect(screen.queryByText('Cold wind')).not.toBeInTheDocument();
    expect(screen.queryByText('My rain')).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'gale');
    expect(screen.getByText('Cold wind')).toBeInTheDocument();
    expect(screen.queryByText('Harbor bells')).not.toBeInTheDocument();
  });

  it('filters by the user’s categories', async () => {
    const { user } = renderLibrary();
    await rowOf('Harbor bells');
    const filter = within(await screen.findByRole('group', { name: 'Filter by category' }));
    await user.click(filter.getByRole('button', { name: 'Outdoors' }));
    expect(screen.getByText('Cold wind')).toBeInTheDocument();
    expect(screen.queryByText('Harbor bells')).not.toBeInTheDocument();
    expect(screen.queryByText('My rain')).not.toBeInTheDocument();

    await user.click(filter.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Harbor bells')).toBeInTheDocument();
    expect(screen.getByText('My rain')).toBeInTheDocument();
  });

  it('shows name, what it is, owner, description and license of a public sound', async () => {
    renderLibrary();
    const row = await rowOf('Harbor bells');
    expect(row.getByText('Loop')).toBeInTheDocument();
    expect(row.getByText('2:48')).toBeInTheDocument();
    expect(row.getByText('Bells across the water')).toBeInTheDocument();

    // The badge is a Popover trigger: its name is the whole phrase, its content the
    // initials and, when there is room, the name beside them.
    const owner = row.getByRole('button', { name: 'By Grace Hopper' });
    expect(owner).toHaveTextContent('GH');
    expect(owner).toHaveTextContent('Grace Hopper');

    expect(row.getByRole('button', { name: 'License: Copyrighted' })).toBeInTheDocument();
  });

  it('tells how many others added a sound, 0 included, between the owner and Play', async () => {
    renderLibrary({ sounds: [bells, wind, rain, gong, crowd] });
    // Every row carries the badge whatever the count, so 0 says nobody else has it yet.
    expect((await rowOf('Harbor bells')).getByLabelText('Added by 0 game masters')).toBeInTheDocument();

    const row = await rowOf('Tavern crowd');
    const owner = row.getByRole('button', { name: 'By Grace Hopper' });
    const added = row.getByLabelText('Added by 3 game masters');
    const play = row.getByRole('button', { name: 'Play Tavern crowd' });
    expect(added).toHaveTextContent('3');
    // It sits between the owner badge and the play button.
    expect(owner.compareDocumentPosition(added)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(added.compareDocumentPosition(play)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('shows where a library sound comes from, the field names for screen readers alone', async () => {
    renderLibrary({ sounds: [bells, wind, rain, gong, lute] });
    const row = await rowOf('Bard lute');

    for (const value of [
      'The Chieftains',
      '1975',
      'Braveheart',
      'The Witcher 3',
      'Outlander',
      'Celtic Dawn',
    ]) {
      expect(row.getByText(value)).toBeInTheDocument();
    }
    // Each value sits behind its field's name, which stays out of sight but not of reach.
    expect(row.getByText('Artists')).toHaveClass('sr-only');
    expect(row.getByText('TV show / Anime')).toHaveClass('sr-only');

    // The link reads as the site it points at, opening in a new tab.
    const link = row.getByRole('link', { name: 'example.com' });
    expect(link).toHaveAttribute('href', 'https://example.com/bard');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows no detail lines for a sound that has none', async () => {
    renderLibrary();
    const row = await rowOf('Temple gong');
    expect(row.queryByText('Artists')).not.toBeInTheDocument();
    expect(row.queryByRole('link')).not.toBeInTheDocument();
  });

  it('marks a named license and leaves an unrecorded one unmarked', async () => {
    renderLibrary();
    expect(
      (await rowOf('My rain')).getByRole('button', { name: 'License: CC BY 4.0' }),
    ).toBeInTheDocument();
    // A license nobody recorded shows no mark at all.
    expect(
      (await rowOf('Cold wind')).queryByRole('button', { name: /^License:/ }),
    ).not.toBeInTheDocument();
  });

  it('offers Add for what the user lacks, Remove for what they added, and nothing for their own', async () => {
    const { user, fetchMock } = renderLibrary();
    // One 44px slot per row whatever its state, so Play holds one line down the list.
    const mine = await rowOf('My rain');
    expect(mine.getByRole('button', { name: 'My rain is one of yours' })).toBeDisabled();
    // Cold wind is in the user's own study mix, so removing it warns first rather than
    // deleting at once; the dialog is covered by its own cases below.
    const added = await rowOf('Cold wind');
    expect(added.getByRole('button', { name: 'Remove Cold wind from my library' })).toBeEnabled();

    const available = await rowOf('Harbor bells');
    const add = available.getByRole('button', { name: 'Add Harbor bells to my library' });
    expect(add).toBeEnabled();
    await user.click(add);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/library/sounds/pub1',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('plays and stops a sound from its row', async () => {
    const { user, spies } = renderLibrary();
    const row = await rowOf('Harbor bells');
    const play = row.getByRole('button', { name: 'Play Harbor bells' });
    expect(play).toHaveAttribute('aria-pressed', 'false');

    await user.click(play);
    expect(spies.playMix).toHaveBeenCalledTimes(1);
    const stop = row.getByRole('button', { name: 'Stop Harbor bells' });
    expect(stop).toHaveAttribute('aria-pressed', 'true');

    await user.click(stop);
    expect(spies.removeLayer).toHaveBeenCalledWith('sound:pub1');
    expect(row.getByRole('button', { name: 'Play Harbor bells' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('lists public mixes with their owner, adds and plays them', async () => {
    const { user, fetchMock, spies } = renderLibrary();
    await user.click(await screen.findByRole('radio', { name: '2 mixes' }));
    const row = await rowOf('Market day');
    expect(row.getByText('3 sounds')).toBeInTheDocument();
    const owner = row.getByRole('button', { name: 'By Grace Hopper' });
    expect(owner).toHaveTextContent('GH');
    expect(owner).toHaveTextContent('Grace Hopper');

    await user.click(row.getByRole('button', { name: 'Play Market day' }));
    expect(spies.playMix).toHaveBeenCalledWith(expect.objectContaining({ id: 'pm1' }));
    expect(row.getByRole('button', { name: 'Stop Market day' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Adding a mix opens a dialog: it says what the mix holds and what that costs.
    await user.click(row.getByRole('button', { name: 'Add Market day to my library' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Add this mix' }));
    expect(dialog.getByText('Harbor bells')).toBeInTheDocument();
    expect(dialog.getByText(/new to you and joins? your library/)).toHaveTextContent(
      '1 of its sounds is new to you and joins your library with it. You already have the other 2.',
    );
    await user.click(dialog.getByRole('button', { name: 'Add the mix and its sounds' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/library/mixes/pm1',
      expect.objectContaining({ method: 'PUT' }),
    );
    // The one sound the user lacked is added on its own, so it survives the mix.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/library/sounds/pub1',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('removes an added mix through a dialog that says which sounds come out with it', async () => {
    const { user, fetchMock } = renderLibrary();
    await user.click(await screen.findByRole('radio', { name: '2 mixes' }));
    const row = await rowOf('Night watch');
    await user.click(row.getByRole('button', { name: 'Remove Night watch from my library' }));

    const dialog = within(await screen.findByRole('dialog', { name: 'Remove this mix' }));
    expect(dialog.getByText(/with the mix \(1 of 1\)/)).toBeInTheDocument();
    // The gong was added outright and nothing else uses it: it can come out, and starts ticked.
    const gong = dialog.getByText('Temple gong').closest('li')!;
    expect(within(gong).getByRole('checkbox')).toBeChecked();
    // Cold wind is in another mix of theirs, and the rain is their own: neither can come out.
    expect(within(dialog.getByText('Cold wind').closest('li')!).queryByRole('checkbox')).toBeNull();
    expect(within(dialog.getByText('My rain').closest('li')!).queryByRole('checkbox')).toBeNull();
    // The dialog says why Cold wind stays.
    expect(
      dialog.getByText(
        '1 of its sounds is used in your other mixes or scenes. It stays in your library.',
      ),
    ).toBeInTheDocument();

    // Unticking keeps it: the mix still goes, the sound stays in the library, added on its
    // own first so it does not leave with the mix.
    await user.click(within(gong).getByRole('checkbox'));
    expect(dialog.getByText(/with the mix \(0 of 1\)/)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Remove the mix' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/library/mixes/pm2',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/library/sounds/pub3',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/library/sounds/pub3',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('removes an unused added sound at once, with no dialog', async () => {
    const { user, fetchMock } = renderLibrary();
    const row = await rowOf('Temple gong');
    await user.click(row.getByRole('button', { name: 'Remove Temple gong from my library' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/library/sounds/pub3',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('warns that an added sound leaves the mixes and scenes that hold it', async () => {
    const { user, fetchMock } = renderLibrary({
      mixes: [makeMix({ id: 'own2', name: 'Cold cellar', items: [item('c1', 'pub2')] })],
      scenes: [scene('sc1', 'Chapter four', { soundIds: ['pub2'] })],
    });
    const row = await rowOf('Cold wind');
    await user.click(row.getByRole('button', { name: 'Remove Cold wind from my library' }));

    const dialog = within(await screen.findByRole('dialog', { name: 'Remove this sound' }));
    expect(dialog.getByText('In 1 of your mixes')).toBeInTheDocument();
    expect(dialog.getByText('Cold cellar')).toBeInTheDocument();
    expect(dialog.getByText('In 1 of your scenes')).toBeInTheDocument();
    expect(dialog.getByText('Chapter four')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Remove' })).toBeEnabled();

    await user.click(dialog.getByRole('button', { name: 'Remove' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/library/sounds/pub2',
      expect.objectContaining({ method: 'DELETE' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Remove this sound' })).not.toBeInTheDocument(),
    );
  });

  it('names a scene that holds the sound only through one of its mixes', async () => {
    const { user } = renderLibrary({
      mixes: [makeMix({ id: 'own2', name: 'Cold cellar', items: [item('c1', 'pub2')] })],
      scenes: [scene('sc1', 'Chapter four', { mixIds: ['own2'] })],
    });
    await user.click(
      (await rowOf('Cold wind')).getByRole('button', { name: 'Remove Cold wind from my library' }),
    );
    const dialog = within(await screen.findByRole('dialog', { name: 'Remove this sound' }));
    expect(dialog.getByText('Chapter four')).toBeInTheDocument();
    expect(dialog.getByText('Through one of its mixes')).toBeInTheDocument();
  });

  it('refuses to confirm when the sound sits inside a mix the user only borrowed', async () => {
    const { user, fetchMock } = renderLibrary({
      // `watch` is a mix the user added from the library, holding the wind. Its contents
      // belong to its owner, so the server would refuse: the dialog says so up front and
      // leaves the button disabled.
      mixes: [study, watch],
    });
    await user.click(
      (await rowOf('Cold wind')).getByRole('button', { name: 'Remove Cold wind from my library' }),
    );
    const dialog = within(await screen.findByRole('dialog', { name: 'Remove this sound' }));
    expect(dialog.getByText('Night watch')).toBeInTheDocument();
    expect(
      dialog.getByText(/A mix you added from the Library also uses this sound/),
    ).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Remove' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/library/sounds/pub2',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
