import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerProvider, usePlayer } from '../audio/player';
import { ToastProvider } from '../components/Toasts';
import { I18nProvider } from '../i18n';
import { makeFakeEngine, makeSound } from '../test/fixtures';
import { PlayerPanel } from './PlayerPanel';

const rain = makeSound({ id: 'rain', name: 'Rain', defaultMode: 'loop' });
const MIN = 60_000;

function StartRain() {
  const player = usePlayer();
  return (
    <button type="button" onClick={() => player.toggleSound(rain)}>
      Start rain
    </button>
  );
}

function setup() {
  const fake = makeFakeEngine();
  render(
    <I18nProvider initial="en">
      <ToastProvider>
        <PlayerProvider sounds={[rain]} engine={fake.engine}>
          <StartRain />
          <PlayerPanel sounds={[rain]} />
        </PlayerProvider>
      </ToastProvider>
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Start rain' }));
  const panel = within(screen.getByRole('complementary', { name: 'Now playing' }));
  return { ...fake, panel };
}

/** Opens the timer, picks the stop and fade presets, and starts it. */
function startTimer(panel: ReturnType<typeof setup>['panel'], stop: string, fade: string) {
  fireEvent.click(panel.getByRole('button', { name: /^Sleep timer: Off/ }));
  const dialog = within(screen.getByRole('dialog', { name: 'Sleep timer' }));
  fireEvent.click(dialog.getAllByRole('button', { name: stop })[0]!);
  fireEvent.click(dialog.getAllByRole('button', { name: fade }).at(-1)!);
  fireEvent.click(dialog.getByRole('button', { name: 'Start' }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-19T22:00:00'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('sleep timer', () => {
  it('schedules the fade on the audio clock, stops at the end, then restores the volume', () => {
    const { panel, spies } = setup();
    startTimer(panel, '30 min', '5 min');

    // Handed to the audio clock right away: 5 minutes of fade, starting in 25.
    expect(spies.fadeOutMaster).toHaveBeenLastCalledWith(300, 1500);
    // On the timer row and on the status line, which stays visible with the player folded.
    expect(panel.getByRole('button', { name: /^Sleep timer: Stops at 10:30/ })).toBeInTheDocument();
    expect(panel.getByText(/1 sound · Stops at 10:30/)).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(25 * MIN));
    // Applied again when due, for whatever cancelled it meanwhile.
    expect(spies.fadeOutMaster).toHaveBeenLastCalledWith(300);
    expect(spies.stop).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(5 * MIN));
    expect(spies.stop).toHaveBeenCalled();
    expect(spies.stopAllOneshots).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(spies.restoreMaster).toHaveBeenCalled();
    expect(panel.getByRole('button', { name: /^Sleep timer: Off/ })).toBeInTheDocument();
  });

  it('refuses a fade longer than the time left', () => {
    const { panel } = setup();
    fireEvent.click(panel.getByRole('button', { name: /^Sleep timer: Off/ }));
    const dialog = within(screen.getByRole('dialog', { name: 'Sleep timer' }));
    fireEvent.change(dialog.getByLabelText('Minutes until it stops'), { target: { value: '3' } });
    fireEvent.change(dialog.getByLabelText('Minutes of fading'), { target: { value: '10' } });
    expect(dialog.getByText('The fade has to fit before the stop')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('brings the sound back at once when turned off', () => {
    const { panel, spies } = setup();
    startTimer(panel, '15 min', '1 min');
    fireEvent.click(panel.getByRole('button', { name: /^Sleep timer: Stops at/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Sleep timer' })).getByRole('button', { name: 'Turn off' }));
    expect(spies.restoreMaster).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(20 * MIN));
    expect(spies.stop).not.toHaveBeenCalled();
  });

  it('goes away by itself once nothing plays', () => {
    const { panel } = setup();
    startTimer(panel, '15 min', 'None');
    fireEvent.click(panel.getByRole('button', { name: 'Stop all' }));
    expect(panel.getByRole('button', { name: /^Sleep timer: Off/ })).toBeInTheDocument();
  });
});
