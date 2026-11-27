import type { Sound } from '@dnd/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerProvider } from '../audio/player';
import { I18nProvider } from '../i18n';
import { makeFakeEngine, makeMix, makeMixItem, makeSound } from '../test/fixtures';
import { MixTile, SoundTile } from './tiles';

const drip = makeSound({
  id: 'drip',
  name: 'Drip',
  defaultMode: 'recurring',
  intervalMinSec: 5,
  intervalMaxSec: 30,
});

// jsdom has no matchMedia; the menu reads it once to choose between drop-down and panel.
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }));
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const fake = makeFakeEngine();
  const onEdit = vi.fn();
  render(
    <I18nProvider initial="en">
      <PlayerProvider sounds={[drip]} engine={fake.engine}>
        <ul>
          <SoundTile sound={drip} onEdit={onEdit} />
        </ul>
      </PlayerProvider>
    </I18nProvider>,
  );
  const user = userEvent.setup();
  const choose = async (name: string | RegExp) => {
    await user.click(screen.getByRole('button', { name: 'Play options for Drip' }));
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name }));
  };
  const layers = () => fake.engine.getSnapshot().mix?.layers ?? [];
  return { ...fake, onEdit, user, choose, layers };
}

describe('SoundTile menu', () => {
  it('lists the ways to play the sound, then Edit', async () => {
    const { user } = setup();
    const button = screen.getByRole('button', { name: 'Play options for Drip' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'PlayIts own setting: Random gaps',
      'Play once',
      'Play as a loop',
      'Play with random pauses',
      'Edit',
    ]);
  });

  it('Play uses the sound’s own mode and pauses', async () => {
    const { choose, layers } = setup();
    await choose(/^Play\s*Its own setting/);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(layers()).toMatchObject([
      { soundId: 'drip', mode: { type: 'recurring', minInterval: 5, maxInterval: 30 } },
    ]);
  });

  it('Play once fires a one-shot of a sound that is not a one-shot', async () => {
    const { choose, spies, layers } = setup();
    await choose('Play once');
    expect(spies.playOneshot).toHaveBeenCalledWith('drip');
    expect(layers()).toEqual([]);
  });

  it('Play as a loop replaces the sound’s layer with a loop', async () => {
    const { choose, layers } = setup();
    await choose(/^Play\s*Its own setting/);
    await choose('Play as a loop');
    expect(layers()).toMatchObject([{ soundId: 'drip', mode: { type: 'loop', randomStart: false } }]);
  });

  it('Edit opens the editor', async () => {
    const { choose, onEdit, spies } = setup();
    await choose('Edit');
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(spies.playMix).not.toHaveBeenCalled();
    expect(spies.playOneshot).not.toHaveBeenCalled();
  });
});

describe('PausesDialog', () => {
  async function openPauses() {
    const env = setup();
    await env.choose('Play with random pauses');
    const dialog = within(screen.getByRole('dialog', { name: 'Random pauses Drip' }));
    return { ...env, dialog };
  }

  it('starts from the sound’s own pauses and fills the fields from each preset', async () => {
    const { user, dialog, spies } = await openPauses();
    const min = dialog.getByLabelText('Shortest wait, seconds');
    const max = dialog.getByLabelText('Longest wait, seconds');
    expect(min).toHaveValue(5);
    expect(max).toHaveValue(30);
    expect(spies.playMix).not.toHaveBeenCalled();

    const presets: [RegExp, number, number][] = [
      [/^Short/, 2, 8],
      [/^Medium/, 10, 30],
      [/^Very random/, 5, 120],
    ];
    for (const [name, low, high] of presets) {
      const preset = dialog.getByRole('button', { name });
      await user.click(preset);
      expect(min).toHaveValue(low);
      expect(max).toHaveValue(high);
      expect(preset).toHaveAttribute('aria-pressed', 'true');
    }
  });

  it('plays with random pauses between the chosen bounds and closes', async () => {
    const { user, dialog, layers } = await openPauses();
    await user.click(dialog.getByRole('button', { name: /^Medium/ }));
    await user.click(dialog.getByRole('button', { name: 'Play' }));
    expect(layers()).toMatchObject([
      { soundId: 'drip', mode: { type: 'recurring', minInterval: 10, maxInterval: 30 } },
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clamps bounds out of range before playing', async () => {
    const { user, dialog, layers } = await openPauses();
    const min = dialog.getByLabelText('Shortest wait, seconds');
    const max = dialog.getByLabelText('Longest wait, seconds');
    await user.clear(min);
    await user.type(min, '0');
    await user.clear(max);
    await user.type(max, '99999');
    await user.click(dialog.getByRole('button', { name: 'Play' }));
    expect(layers()[0]?.mode).toMatchObject({ type: 'recurring', minInterval: 1, maxInterval: 3600 });
  });

  it('cancel closes without playing', async () => {
    const { user, dialog, spies } = await openPauses();
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(spies.playMix).not.toHaveBeenCalled();
    expect(spies.addLayer).not.toHaveBeenCalled();
  });
});

describe('Added badge on a sound tile', () => {
  function show(sound: Sound) {
    const fake = makeFakeEngine();
    render(
      <I18nProvider initial="en">
        <PlayerProvider sounds={[sound]} engine={fake.engine}>
          <ul>
            <SoundTile sound={sound} onEdit={vi.fn()} />
          </ul>
        </PlayerProvider>
      </I18nProvider>,
    );
  }

  it('hides the mark for a sound nobody else added', () => {
    show(makeSound({ id: 'quiet', name: 'Quiet', addedCount: 0 }));
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Added by/ })).not.toBeInTheDocument();
  });

  it('shows how many added it, with the note', () => {
    show(makeSound({ id: 'birds', name: 'Birds', addedCount: 2 }));
    const badge = screen.getByRole('button', { name: 'Added by 2 game masters' });
    expect(badge).toHaveTextContent('2');
  });
});

describe('MixTile kind', () => {
  const road = makeMix({
    id: 'p1',
    name: 'Road',
    kind: 'playlist',
    items: [makeMixItem({ id: 'pi1', soundId: 'drip', volume: 1 })],
  });
  const tavern = makeMix({
    id: 'm1',
    name: 'Tavern',
    items: [makeMixItem({ id: 'i1', soundId: 'drip', mode: 'loop', volume: 1 })],
  });

  function show() {
    const fake = makeFakeEngine();
    render(
      <I18nProvider initial="en">
        <PlayerProvider sounds={[drip]} mixes={[road, tavern]} engine={fake.engine}>
          <ul>
            <MixTile mix={road} onEdit={vi.fn()} />
            <MixTile mix={tavern} onEdit={vi.fn()} />
          </ul>
        </PlayerProvider>
      </I18nProvider>,
    );
    const tile = (name: string) =>
      within(screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('li')!);
    return { ...fake, tile, user: userEvent.setup() };
  }

  it('reads Playlist on a playlist and Mix on a mix', () => {
    const { tile } = show();
    expect(tile('Road').getByText('Playlist')).toBeInTheDocument();
    expect(tile('Road').queryByText('Mix')).not.toBeInTheDocument();
    expect(tile('Tavern').getByText('Mix')).toBeInTheDocument();
    expect(tile('Tavern').queryByText('Playlist')).not.toBeInTheDocument();
  });

  it('plays a playlist on top of the mix and lights both tiles', async () => {
    const { user, engine } = show();
    await user.click(screen.getByRole('button', { name: /^Tavern/ }));
    await user.click(screen.getByRole('button', { name: /^Road/ }));
    expect(engine.getSnapshot().mix?.layers.map((l) => l.id)).toEqual(['item:i1', 'playlist:p1']);
    expect(screen.getByRole('button', { name: /^Road/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Tavern/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
