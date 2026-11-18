import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { layersToMixItems, PlayerProvider, usePlayer } from '../audio/player';
import { SoundTile, MixTile } from '../board/tiles';
import { ToastProvider } from '../components/Toasts';
import { I18nProvider } from '../i18n';
import { makeFakeEngine, makeMix, makeSound } from '../test/fixtures';
import { PlayerPanel } from './PlayerPanel';

const crowd = makeSound({ id: 'crowd', name: 'Tavern crowd', defaultMode: 'loop' });
const door = makeSound({ id: 'door', name: 'Door creak', defaultMode: 'oneshot', durationSec: 2 });
const sounds = [crowd, door];
const mix = makeMix({
  id: 'm1',
  name: 'Tavern evening',
  items: [
    { id: 'i1', soundId: 'crowd', mode: 'loop', volume: 0.6, intervalMinSec: 20, intervalMaxSec: 90, volumeVariation: 0 },
  ],
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
          <Board />
          <PlayerPanel sounds={sounds} onSaveAsMix={onSaveAsMix} />
        </PlayerProvider>
      </ToastProvider>
    </I18nProvider>,
  );
  const panel = within(screen.getByRole('complementary', { name: 'Now playing' }));
  return { ...fake, panel, user: userEvent.setup() };
}

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
    expect(row.getByRole('button', { name: 'Unmute Tavern crowd' })).toHaveAttribute('aria-pressed', 'true');

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
    fireEvent.change(panel.getByRole('slider', { name: 'Master volume' }), { target: { value: '0.5' } });
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
      { soundId: 'crowd', mode: 'loop', volume: 0.6, intervalMinSec: 20, intervalMaxSec: 90, volumeVariation: 0 },
    ]);
  });

  describe('how a playing sound repeats', () => {
    // jsdom has no matchMedia; the menu reads it once to choose between drop-down and panel.
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }));
    });
    afterEach(() => vi.unstubAllGlobals());

    const openMenu = async (user: ReturnType<typeof userEvent.setup>, panel: ReturnType<typeof setup>['panel']) => {
      await user.click(panel.getByRole('button', { name: 'How Tavern crowd repeats' }));
      return within(screen.getByRole('menu'));
    };

    it('marks the loop as current and sets random pauses in place from the dialog', async () => {
      const { panel, user, spies, engine } = setup();
      await user.click(screen.getByRole('button', { name: /^Tavern crowd/ }));

      const menu = await openMenu(user, panel);
      expect(menu.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
        'Play as a loopNow',
        'Play with random pauses',
      ]);
      await user.click(menu.getByRole('menuitem', { name: 'Play with random pauses' }));

      const dialog = within(screen.getByRole('dialog', { name: 'Random pauses · Tavern crowd' }));
      expect(dialog.getByLabelText('Shortest wait, seconds')).toHaveValue(20);
      expect(dialog.getByLabelText('Longest wait, seconds')).toHaveValue(90);
      await user.click(dialog.getByRole('button', { name: /^Short/ }));
      await user.click(dialog.getByRole('button', { name: 'Play' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(spies.updateLayer).toHaveBeenLastCalledWith('sound:crowd', {
        mode: { type: 'recurring', minInterval: 2, maxInterval: 8, volumeJitter: [1, 1] },
      });
      expect(spies.removeLayer).not.toHaveBeenCalled();
      expect(spies.addLayer).not.toHaveBeenCalled();
      expect(engine.getSnapshot().mix?.layers.map((l) => l.id)).toEqual(['sound:crowd']);
      expectCoreControls(panel);
    });

    it('shows the current pauses, opens the dialog on them, and switches back to a loop', async () => {
      const { panel, user, spies } = setup();
      await user.click(screen.getByRole('button', { name: /^Tavern evening/ }));
      const button = panel.getByRole('button', { name: 'How Tavern crowd repeats' });
      expect(button).toHaveAttribute('aria-haspopup', 'menu');

      await user.click(button);
      await user.click(screen.getByRole('menuitem', { name: 'Play with random pauses' }));
      let dialog = within(screen.getByRole('dialog', { name: 'Random pauses · Tavern crowd' }));
      const min = dialog.getByLabelText('Shortest wait, seconds');
      const max = dialog.getByLabelText('Longest wait, seconds');
      await user.clear(min);
      await user.type(min, '4');
      await user.clear(max);
      await user.type(max, '12');
      await user.click(dialog.getByRole('button', { name: 'Play' }));
      expect(spies.updateLayer).toHaveBeenLastCalledWith('item:i1', {
        mode: { type: 'recurring', minInterval: 4, maxInterval: 12, volumeJitter: [1, 1] },
      });

      let menu = await openMenu(user, panel);
      expect(menu.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
        'Play as a loop',
        'Play with random pausesNow · 4–12 s',
      ]);
      await user.click(menu.getByRole('menuitem', { name: /^Play with random pauses/ }));
      dialog = within(screen.getByRole('dialog', { name: 'Random pauses · Tavern crowd' }));
      expect(dialog.getByLabelText('Shortest wait, seconds')).toHaveValue(4);
      expect(dialog.getByLabelText('Longest wait, seconds')).toHaveValue(12);
      await user.click(dialog.getByRole('button', { name: 'Cancel' }));

      menu = await openMenu(user, panel);
      await user.click(menu.getByRole('menuitem', { name: 'Play as a loop' }));
      expect(spies.updateLayer).toHaveBeenLastCalledWith('item:i1', {
        mode: { type: 'loop', randomStart: false },
      });
      expect(spies.removeLayer).not.toHaveBeenCalled();
      expectCoreControls(panel);
    });
  });

  it('tells the user when a sound fails to load', () => {
    const { emitError } = setup();
    act(() => emitError({ code: 'LOAD_FAILED', soundId: 'crowd' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load “Tavern crowd”');
  });
});
