import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { layersToMixItems, PlayerProvider, soundLoop, usePlayer } from '../audio/player';
import { SoundTile, MixTile } from '../board/tiles';
import { ToastProvider } from '../components/Toasts';
import { I18nProvider } from '../i18n';
import { makeFakeEngine, makeMix, makeMixItem, makeSound } from '../test/fixtures';
import { PlayerPanel } from './PlayerPanel';

const crowd = makeSound({ id: 'crowd', name: 'Tavern crowd', defaultMode: 'loop' });
/** The engine-shaped loop markers of the crowd sound (what a layer's mode carries). */
const crowdLoop = (() => {
  const l = soundLoop(crowd);
  return {
    trackStart: l.trackStartSec,
    trackEnd: l.trackEndSec,
    loopStart: l.loopStartSec,
    loopEnd: l.loopEndSec,
    mode: l.crossfadeSec > 0 ? 'crossfade' : 'gapless',
    crossfadeSec: l.crossfadeSec,
  };
})();
const door = makeSound({ id: 'door', name: 'Door creak', defaultMode: 'oneshot', durationSec: 2 });
const sounds = [crowd, door];
const mix = makeMix({
  id: 'm1',
  name: 'Tavern evening',
  items: [makeMixItem({ id: 'i1', soundId: 'crowd', mode: 'loop', volume: 0.6 })],
});

function Board() {
  // Rendered so tests drive the panel the way a user does: by tapping tiles.
  usePlayer();
  return (
    <ul>
      <SoundTile sound={crowd} onEdit={() => {}} />
      <SoundTile sound={door} onEdit={() => {}} />
      <MixTile mix={mix} onEdit={() => {}} />
    </ul>
  );
}

function setup(onSaveAsMix?: (items: ReturnType<typeof layersToMixItems>) => void) {
  const fake = makeFakeEngine();
  render(
    <I18nProvider initial="en">
      <ToastProvider>
        <PlayerProvider sounds={sounds} engine={fake.engine}>
          {/* The app keeps the page in `main` and the player outside it; the docked player
              turns `main`'s scrolling off, so the harness holds the same shape. */}
          <main className="overflow-y-auto">
            <Board />
          </main>
          <PlayerPanel sounds={sounds} onSaveAsMix={onSaveAsMix} />
        </PlayerProvider>
      </ToastProvider>
    </I18nProvider>,
  );
  const panel = within(screen.getByRole('complementary', { name: 'Now playing' }));
  return { ...fake, panel, user: userEvent.setup() };
}

/** The dim layer the docked player puts over the page, as the aside's previous sibling. */
const dimBehindPlayer = () =>
  screen.getByRole('complementary', { name: 'Now playing' }).previousElementSibling;
const isDim = (el: Element | null) => !!el && el.classList.contains('bg-black/60');

/** The controls that must exist, enabled, in every playback state. */
function expectCoreControls(panel: ReturnType<typeof setup>['panel'], pauseName = 'Pause') {
  expect(panel.getByRole('button', { name: 'Stop all' })).toBeEnabled();
  expect(panel.getByRole('button', { name: pauseName })).toBeEnabled();
  expect(panel.getByRole('slider', { name: 'Master volume' })).toBeEnabled();
  expect(panel.getByRole('slider', { name: 'One-shot volume' })).toBeEnabled();
}

describe('PlayerPanel', () => {
  it('shows every core control while nothing plays', () => {
    const { panel } = setup();
    expectCoreControls(panel);
    expect(panel.getByText('Nothing playing')).toBeInTheDocument();
    expect(panel.getByText('Tap a tile to start a sound')).toBeInTheDocument();
  });

  it('keeps the same core controls while playing, paused and after stopping', async () => {
    const { panel, user } = setup();

    await user.click(screen.getByRole('button', { name: /^Tavern evening/ }));
    expectCoreControls(panel);
    expect(panel.getByText('Tavern evening')).toBeInTheDocument();

    await user.click(panel.getByRole('button', { name: 'Pause' }));
    expectCoreControls(panel, 'Resume');
    expect(panel.getByText('Paused')).toBeInTheDocument();

    await user.click(panel.getByRole('button', { name: 'Resume' }));
    await user.click(panel.getByRole('button', { name: 'Stop all' }));
    expectCoreControls(panel);
    expect(panel.getByText('Nothing playing')).toBeInTheDocument();
  });

  it('stop all can be tapped with nothing playing', async () => {
    const { panel, user, spies } = setup();
    await user.click(panel.getByRole('button', { name: 'Stop all' }));
    expect(spies.stop).toHaveBeenCalledTimes(1);
    expectCoreControls(panel);
  });

  it('lists a tapped loop with its own volume, mute and remove controls', async () => {
    const { panel, user, spies } = setup();
    await user.click(screen.getByRole('button', { name: /^Tavern crowd/ }));

    expect(panel.getByText('Loose sounds')).toBeInTheDocument();
    const row = within(panel.getByRole('list'));
    expect(row.getByText('Tavern crowd')).toBeInTheDocument();

    fireEvent.change(row.getByRole('slider', { name: 'Volume of Tavern crowd' }), {
      target: { value: '0.3' },
    });
    expect(spies.updateLayer).toHaveBeenCalledWith('sound:crowd', { volume: 0.3 });

    await user.click(row.getByRole('button', { name: 'Mute Tavern crowd' }));
    expect(spies.updateLayer).toHaveBeenCalledWith('sound:crowd', { muted: true });
    expect(row.getByRole('button', { name: 'Unmute Tavern crowd' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(row.getByRole('button', { name: 'Remove Tavern crowd' }));
    expect(panel.getByText('Nothing playing')).toBeInTheDocument();
  });

  it('lights the tile of what plays and unlights it on stop all', async () => {
    const { panel, user } = setup();
    const tile = screen.getByRole('button', { name: /^Tavern crowd/ });
    expect(tile).toHaveAttribute('aria-pressed', 'false');
    await user.click(tile);
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    await user.click(panel.getByRole('button', { name: 'Stop all' }));
    expect(tile).toHaveAttribute('aria-pressed', 'false');
  });

  it('moves the master volume', () => {
    const { panel, spies } = setup();
    fireEvent.change(panel.getByRole('slider', { name: 'Master volume' }), {
      target: { value: '0.5' },
    });
    expect(spies.setMasterVolume).toHaveBeenCalledWith(0.5);
  });

  it('offers no "Save as a mix" without a handler', () => {
    const { panel } = setup();
    expect(panel.queryByRole('button', { name: 'Save as a mix' })).not.toBeInTheDocument();
  });

  it('disables "Save as a mix" while no layer plays, one-shots included', async () => {
    const { panel, user } = setup(vi.fn());
    expect(panel.getByRole('button', { name: 'Save as a mix' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /^Door creak/ }));
    expect(panel.getByRole('button', { name: 'Save as a mix' })).toBeDisabled();
    expectCoreControls(panel);
  });

  it('saves the layers that play as the items of a new mix', async () => {
    const onSaveAsMix = vi.fn();
    const { panel, user, engine } = setup(onSaveAsMix);
    await user.click(screen.getByRole('button', { name: /^Tavern evening/ }));
    await user.click(screen.getByRole('button', { name: /^Door creak/ }));
    await user.click(panel.getByRole('button', { name: 'Save as a mix' }));

    expect(onSaveAsMix).toHaveBeenCalledTimes(1);
    expect(onSaveAsMix).toHaveBeenCalledWith(layersToMixItems(engine.getSnapshot().mix!.layers));
    expect(onSaveAsMix.mock.calls[0][0]).toEqual([
      {
        soundId: 'crowd',
        mode: 'loop',
        volume: 0.6,
        intervalMinSec: 20,
        intervalMaxSec: 90,
        volumeVariation: 0,
        trackStartSec: 0,
        trackEndSec: 168,
        loopStartSec: 0,
        loopEndSec: 168,
        crossfadeSec: 0,
      },
    ]);
  });

  describe('how a playing sound repeats', () => {
    // jsdom has no matchMedia; the menu reads it once to choose between drop-down and panel.
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
    });
    afterEach(() => vi.unstubAllGlobals());

    const openMenu = async (
      user: ReturnType<typeof userEvent.setup>,
      panel: ReturnType<typeof setup>['panel'],
    ) => {
      await user.click(panel.getByRole('button', { name: 'Options for Tavern crowd' }));
      return within(screen.getByRole('menu'));
    };

    it('opens the menu from a three-dots button, not a play mode icon, for loops and random pauses', async () => {
      const { panel, user } = setup();
      await user.click(screen.getByRole('button', { name: /^Tavern crowd/ }));
      const check = () => {
        const button = panel.getByRole('button', { name: 'Options for Tavern crowd' });
        expect(button).toHaveAttribute('aria-haspopup', 'menu');
        expect(button.querySelector('.lucide-ellipsis')).not.toBeNull();
        expect(button.querySelector('.lucide-repeat, .lucide-shuffle')).toBeNull();
        expect(panel.queryByRole('button', { name: /repeats$/ })).not.toBeInTheDocument();
      };
      check();

      // Switched to random pauses, the row keeps the same trigger.
      const menu = await openMenu(user, panel);
      await user.click(menu.getByRole('menuitem', { name: 'Play with random pauses' }));
      const dialog = within(screen.getByRole('dialog', { name: 'Random pauses Tavern crowd' }));
      await user.click(dialog.getByRole('button', { name: 'Play' }));
      check();
    });

    it('marks the loop as current and sets random pauses in place from the dialog', async () => {
      const { panel, user, spies, engine } = setup();
      await user.click(screen.getByRole('button', { name: /^Tavern crowd/ }));

      const menu = await openMenu(user, panel);
      expect(menu.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
        'Play as a loopNow',
        'Play with random pauses',
        'Loop settings',
      ]);
      await user.click(menu.getByRole('menuitem', { name: 'Play with random pauses' }));

      const dialog = within(screen.getByRole('dialog', { name: 'Random pauses Tavern crowd' }));
      expect(dialog.getByLabelText('Shortest wait, seconds')).toHaveValue(20);
      expect(dialog.getByLabelText('Longest wait, seconds')).toHaveValue(90);
      await user.click(dialog.getByRole('button', { name: /^Short/ }));
      await user.click(dialog.getByRole('button', { name: 'Play' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(spies.updateLayer).toHaveBeenLastCalledWith('sound:crowd', {
        mode: {
          type: 'recurring',
          minInterval: 2,
          maxInterval: 8,
          volumeJitter: [1, 1],
          loop: crowdLoop,
        },
      });
      expect(spies.removeLayer).not.toHaveBeenCalled();
      expect(spies.addLayer).not.toHaveBeenCalled();
      expect(engine.getSnapshot().mix?.layers.map((l) => l.id)).toEqual(['sound:crowd']);
      expectCoreControls(panel);
    });

    it('shows the current pauses, opens the dialog on them, and switches back to a loop', async () => {
      const { panel, user, spies } = setup();
      await user.click(screen.getByRole('button', { name: /^Tavern evening/ }));
      const button = panel.getByRole('button', { name: 'Options for Tavern crowd' });
      expect(button).toHaveAttribute('aria-haspopup', 'menu');

      await user.click(button);
      await user.click(screen.getByRole('menuitem', { name: 'Play with random pauses' }));
      let dialog = within(screen.getByRole('dialog', { name: 'Random pauses Tavern crowd' }));
      const min = dialog.getByLabelText('Shortest wait, seconds');
      const max = dialog.getByLabelText('Longest wait, seconds');
      await user.clear(min);
      await user.type(min, '4');
      await user.clear(max);
      await user.type(max, '12');
      await user.click(dialog.getByRole('button', { name: 'Play' }));
      expect(spies.updateLayer).toHaveBeenLastCalledWith('item:i1', {
        mode: {
          type: 'recurring',
          minInterval: 4,
          maxInterval: 12,
          volumeJitter: [1, 1],
          loop: crowdLoop,
        },
      });

      let menu = await openMenu(user, panel);
      expect(menu.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
        'Play as a loop',
        'Play with random pausesNow 4–12 s',
        'Loop settings',
      ]);
      await user.click(menu.getByRole('menuitem', { name: /^Play with random pauses/ }));
      dialog = within(screen.getByRole('dialog', { name: 'Random pauses Tavern crowd' }));
      expect(dialog.getByLabelText('Shortest wait, seconds')).toHaveValue(4);
      expect(dialog.getByLabelText('Longest wait, seconds')).toHaveValue(12);
      await user.click(dialog.getByRole('button', { name: 'Cancel' }));

      menu = await openMenu(user, panel);
      await user.click(menu.getByRole('menuitem', { name: 'Play as a loop' }));
      expect(spies.updateLayer).toHaveBeenLastCalledWith('item:i1', {
        mode: { type: 'loop', randomStart: false, loop: crowdLoop },
      });
      expect(spies.removeLayer).not.toHaveBeenCalled();
      expectCoreControls(panel);
    });

    it('opens the loop editor live on the playing layer, applying without saving anything', async () => {
      const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      const { panel, user, spies, engine } = setup();
      spies.getWaveformPeaks.mockResolvedValue(new Float32Array(480));
      await user.click(screen.getByRole('button', { name: /^Tavern evening/ }));

      const menu = await openMenu(user, panel);
      await user.click(menu.getByRole('menuitem', { name: 'Loop settings' }));
      const dialog = within(screen.getByRole('dialog', { name: 'Loop editor' }));
      expect(
        dialog.getByText(/^Changes apply to this sound as it plays now\. Nothing is saved/),
      ).toBeInTheDocument();

      // One step on the loop start (0.1 s), and a 2 s crossfade.
      fireEvent.keyDown(dialog.getByRole('slider', { name: 'Loop start' }), { key: 'ArrowRight' });
      fireEvent.change(dialog.getByRole('slider', { name: 'Crossfade length, seconds' }), {
        target: { value: '2' },
      });
      spies.updateLayer.mockClear();
      await user.click(dialog.getByRole('button', { name: 'Apply' }));

      expect(screen.queryByRole('dialog', { name: 'Loop editor' })).not.toBeInTheDocument();
      expect(spies.updateLayer).toHaveBeenCalledTimes(1);
      expect(spies.updateLayer).toHaveBeenLastCalledWith('item:i1', {
        mode: {
          type: 'loop',
          randomStart: false,
          loop: { ...crowdLoop, loopStart: 0.1, mode: 'crossfade', crossfadeSec: 2 },
        },
      });
      expect(engine.getSnapshot().mix?.layers.map((l) => l.id)).toEqual(['item:i1']);
      expect(spies.removeLayer).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expectCoreControls(panel);
    });

    it('leaves the playing layer alone when the loop editor is cancelled', async () => {
      const { panel, user, spies } = setup();
      spies.getWaveformPeaks.mockResolvedValue(new Float32Array(480));
      await user.click(screen.getByRole('button', { name: /^Tavern crowd/ }));

      const menu = await openMenu(user, panel);
      await user.click(menu.getByRole('menuitem', { name: 'Loop settings' }));
      const dialog = within(screen.getByRole('dialog', { name: 'Loop editor' }));
      fireEvent.keyDown(dialog.getByRole('slider', { name: 'Loop start' }), { key: 'ArrowRight' });
      spies.updateLayer.mockClear();
      await user.click(dialog.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('dialog', { name: 'Loop editor' })).not.toBeInTheDocument();
      expect(spies.updateLayer).not.toHaveBeenCalled();
    });
  });

  describe('the docked player stands over the page', () => {
    // Below `lg` the player is docked; jsdom has no matchMedia, so the query is made to match.
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('opens with a dim layer behind it and the page held still', async () => {
      const { user } = setup();
      const main = document.querySelector('main')!;
      expect(main.style.overflow).not.toBe('hidden');

      await user.click(screen.getByRole('button', { name: 'Show player' }));

      expect(isDim(dimBehindPlayer())).toBe(true);
      expect(main.style.overflow).toBe('hidden');
    });

    it('closes on a tap on the dim layer, giving the page back its scrolling', async () => {
      const { user } = setup();
      const main = document.querySelector('main')!;
      const before = main.style.overflow;

      await user.click(screen.getByRole('button', { name: 'Show player' }));
      const dim = dimBehindPlayer();
      expect(isDim(dim)).toBe(true);
      fireEvent.click(dim!);

      expect(isDim(dimBehindPlayer())).toBe(false);
      expect(main.style.overflow).toBe(before);
      expect(screen.getByRole('button', { name: 'Show player' })).toBeInTheDocument();
    });
  });

  it('on a wide screen, opens in place without a dim layer or holding the page still', async () => {
    // No matchMedia stub here: jsdom has none, so the player is not docked.
    const { user } = setup();
    const main = document.querySelector('main')!;

    await user.click(screen.getByRole('button', { name: 'Show player' }));

    expect(isDim(dimBehindPlayer())).toBe(false);
    expect(main.style.overflow).not.toBe('hidden');
  });

  describe('a playlist row', () => {
    const drip = makeSound({ id: 'drip', name: 'Drip', defaultMode: 'recurring' });
    const road = makeMix({
      id: 'p1',
      name: 'Road',
      kind: 'playlist',
      items: [
        makeMixItem({ id: 'pi1', soundId: 'crowd', volume: 1 }),
        makeMixItem({ id: 'pi2', soundId: 'drip', volume: 1 }),
      ],
    });

    /** A mix of two loops (crowd, door as a loop), and the same with the playlist inside. */
    const evening = makeMix({
      id: 'm1',
      name: 'Tavern evening',
      items: [
        makeMixItem({ id: 'i1', soundId: 'crowd', mode: 'loop' }),
        makeMixItem({ id: 'i2', soundId: 'door', mode: 'loop' }),
      ],
    });
    const holding = makeMix({
      id: 'm2',
      name: 'Long road',
      items: [
        makeMixItem({ id: 'j1', soundId: 'crowd', mode: 'loop' }),
        makeMixItem({ id: 'j2', soundId: 'door', mode: 'loop' }),
      ],
      playlists: [{ playlistId: 'p1', volume: 1 }],
    });

    // The menu reads matchMedia once; jsdom has none.
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
    });
    afterEach(() => vi.unstubAllGlobals());

    function setupPlaylist() {
      const fake = makeFakeEngine();
      const all = [crowd, door, drip];
      const mixes = [road, evening, holding];
      render(
        <I18nProvider initial="en">
          <ToastProvider>
            <PlayerProvider sounds={all} mixes={mixes} engine={fake.engine}>
              <main className="overflow-y-auto">
                <ul>
                  <MixTile mix={road} onEdit={() => {}} />
                  <MixTile mix={evening} onEdit={() => {}} />
                  <MixTile mix={holding} onEdit={() => {}} />
                </ul>
              </main>
              <PlayerPanel sounds={all} mixes={mixes} />
            </PlayerProvider>
          </ToastProvider>
        </I18nProvider>,
      );
      const panel = within(screen.getByRole('complementary', { name: 'Now playing' }));
      /** The rows of the player list in display order, by their mute button's name. */
      const rows = () =>
        panel
          .getAllByRole('button', { name: /^Mute / })
          .map((b) => b.getAttribute('aria-label') ?? b.textContent);
      return { ...fake, panel, rows, user: userEvent.setup() };
    }

    it('names the playlist and the sound heard, and skips from its options menu', async () => {
      const { panel, user, spies, engine } = setupPlaylist();
      await user.click(screen.getByRole('button', { name: /^Road/ }));

      const row = within(panel.getByRole('list'));
      expect(row.getByText('Road · Tavern crowd')).toBeInTheDocument();
      expect(row.queryByRole('button', { name: /repeats$/ })).not.toBeInTheDocument();
      expect(row.queryByRole('button', { name: /sound of Road$/ })).not.toBeInTheDocument();

      act(() => engine.updateLayer('playlist:p1', { current: 1 } as never));
      expect(row.getByText('Road · Drip')).toBeInTheDocument();

      const options = row.getByRole('button', { name: 'Options for Road' });
      expect(options).toHaveAttribute('aria-haspopup', 'menu');
      expect(options.querySelector('.lucide-ellipsis')).not.toBeNull();

      await user.click(options);
      // The menu is titled with the playlist's name.
      let menu = within(screen.getByRole('menu', { name: 'Road' }));
      expect(menu.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
        'Previous sound',
        'Next sound',
      ]);
      await user.click(menu.getByRole('menuitem', { name: 'Next sound' }));
      expect(spies.skipLayer).toHaveBeenLastCalledWith('playlist:p1', 1);

      await user.click(row.getByRole('button', { name: 'Options for Road' }));
      menu = within(screen.getByRole('menu'));
      await user.click(menu.getByRole('menuitem', { name: 'Previous sound' }));
      expect(spies.skipLayer).toHaveBeenLastCalledWith('playlist:p1', -1);
      expect(spies.skipLayer).toHaveBeenCalledTimes(2);
      expect(row.getByRole('button', { name: 'Mute Road · Drip' })).toBeInTheDocument();
      expectCoreControls(panel);
    });

    it('lists a playlist on top before the mix’s loops, though the engine lists it after them', async () => {
      const { user, engine, rows } = setupPlaylist();
      await user.click(screen.getByRole('button', { name: /^Tavern evening/ }));
      await user.click(screen.getByRole('button', { name: /^Road/ }));

      // The engine plays the playlist after the mix's layers.
      expect(engine.getSnapshot().mix?.layers.map((l) => l.id)).toEqual([
        'item:i1',
        'item:i2',
        'playlist:p1',
      ]);
      // The list shows it first, then the loops in their order.
      expect(rows()).toEqual(['Mute Road · Tavern crowd', 'Mute Tavern crowd', 'Mute Door creak']);
    });

    it('lists a playlist held inside a mix first too', async () => {
      const { user, engine, rows } = setupPlaylist();
      await user.click(screen.getByRole('button', { name: /^Long road/ }));

      const ids = engine.getSnapshot().mix?.layers.map((l) => l.id) ?? [];
      expect(ids).toContain('in-mix:m2:p1');
      expect(ids.indexOf('in-mix:m2:p1')).toBeGreaterThan(0);
      expect(rows()).toEqual(['Mute Road · Tavern crowd', 'Mute Tavern crowd', 'Mute Door creak']);
    });
  });

  it('tells the user when a sound fails to load', () => {
    const { emitError } = setup();
    act(() => emitError({ code: 'LOAD_FAILED', soundId: 'crowd' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load “Tavern crowd”');
  });
});
