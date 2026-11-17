import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PlayerProvider, usePlayer } from '../audio/player';
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

function setup() {
  const fake = makeFakeEngine();
  render(
    <I18nProvider initial="en">
      <ToastProvider>
        <PlayerProvider sounds={sounds} engine={fake.engine}>
          <Board />
          <PlayerPanel sounds={sounds} />
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

  it('shows one-shots in flight and clears them on stop all', async () => {
    const { panel, user, spies } = setup();
    await user.click(screen.getByRole('button', { name: /^Door creak/ }));
    expect(spies.playOneshot).toHaveBeenCalledWith('door');
    expect(within(panel.getByRole('list')).getByText('Door creak')).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: 'Stop all' }));
    expect(panel.queryByRole('list')).not.toBeInTheDocument();
  });

  it('moves the master volume', () => {
    const { panel, spies } = setup();
    fireEvent.change(panel.getByRole('slider', { name: 'Master volume' }), { target: { value: '0.5' } });
    expect(spies.setMasterVolume).toHaveBeenCalledWith(0.5);
  });

  it('tells the user when a sound fails to load', () => {
    const { emitError } = setup();
    act(() => emitError({ code: 'LOAD_FAILED', soundId: 'crowd' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load “Tavern crowd”');
  });
});
