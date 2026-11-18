import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerProvider } from '../audio/player';
import { I18nProvider } from '../i18n';
import { makeFakeEngine, makeMix, makeSound } from '../test/fixtures';
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
const outdoors = { id: 'c1', name: 'Outdoors', color: '#5a7d3a', icon: null, createdAt: '2026-11-01T10:00:00.000Z' };
const rain = makeSound({ id: 'mine', name: 'My rain', isPublic: true, access: 'owner', license: 'CC BY 4.0' });
const item = (id: string, soundId: string) => ({
  id,
  soundId,
  mode: 'loop' as const,
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

function renderLibrary() {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
    if (url === '/api/library') return json(200, { sounds: [bells, wind, rain], mixes: [market] });
    if (url === '/api/sounds') return json(200, []);
    if (url === '/api/categories') return json(200, [outdoors]);
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const fake = makeFakeEngine();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
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

    // Read by screen readers as one phrase; seen as an initials badge and the name.
    expect(row.getByText('By Grace Hopper')).toHaveClass('sr-only');
    expect(row.getByText('GH')).toHaveAttribute('aria-hidden', 'true');
    expect(row.getByText('Grace Hopper')).toHaveAttribute('aria-hidden', 'true');

    expect(row.getByText('License: Private use only')).toHaveClass('sr-only');
    const tag = row.getByText('Private use only');
    expect(tag).toHaveAttribute('aria-hidden', 'true');
    expect(tag.parentElement).toHaveAttribute('title', 'License: Private use only');
  });

  it('shows license codes translated and license names as they are', async () => {
    renderLibrary();
    expect((await rowOf('Cold wind')).getByText('License: Unknown')).toBeInTheDocument();
    expect((await rowOf('My rain')).getByText('License: CC BY 4.0')).toBeInTheDocument();
  });

  it('marks own and added items, and offers Add for the others', async () => {
    const { user, fetchMock } = renderLibrary();
    const mine = await rowOf('My rain');
    expect(mine.getByText('Yours')).toBeInTheDocument();
    expect(mine.queryByRole('button', { name: /to my library/ })).not.toBeInTheDocument();
    const added = await rowOf('Cold wind');
    expect(added.getByText('Added')).toBeInTheDocument();
    expect(added.queryByRole('button', { name: /to my library/ })).not.toBeInTheDocument();

    const available = await rowOf('Harbor bells');
    await user.click(available.getByRole('button', { name: 'Add Harbor bells to my library' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/library/sounds/pub1', expect.objectContaining({ method: 'PUT' }));
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
    expect(row.getByRole('button', { name: 'Play Harbor bells' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('lists public mixes with their owner, adds and plays them', async () => {
    const { user, fetchMock, spies } = renderLibrary();
    await user.click(await screen.findByRole('radio', { name: '1 mix' }));
    const row = await rowOf('Market day');
    expect(row.getByText('3 sounds')).toBeInTheDocument();
    expect(row.getByText('By Grace Hopper')).toBeInTheDocument();
    expect(row.getByText('GH')).toBeInTheDocument();

    await user.click(row.getByRole('button', { name: 'Play Market day' }));
    expect(spies.playMix).toHaveBeenCalledWith(expect.objectContaining({ id: 'pm1' }));
    expect(row.getByRole('button', { name: 'Stop Market day' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(row.getByRole('button', { name: 'Add Market day to my library' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/library/mixes/pm1', expect.objectContaining({ method: 'PUT' }));
  });
});
