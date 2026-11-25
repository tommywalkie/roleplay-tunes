import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlayerProvider, soundLoop } from '../audio/player';
import { I18nProvider } from '../i18n';
import { makeFakeEngine, makeSound } from '../test/fixtures';
import { clock, LoopEditorDialog, parseClock } from './LoopEditorDialog';

describe('clock', () => {
  it('writes minutes, seconds and hundredths, two digits each', () => {
    expect(clock(0)).toBe('00:00:00');
    expect(clock(73.72)).toBe('01:13:72');
    expect(clock(4.5)).toBe('00:04:50');
    expect(clock(59.99)).toBe('00:59:99');
  });

  it('lets minutes go past 99', () => {
    expect(clock(6000.5)).toBe('100:00:50');
  });

  it('rounds to the hundredth, carrying into seconds and minutes', () => {
    expect(clock(1.234)).toBe('00:01:23');
    expect(clock(1.236)).toBe('00:01:24');
    expect(clock(59.999)).toBe('01:00:00');
  });
});

describe('parseClock', () => {
  it('reads mm:ss:cc, mm:ss and bare seconds', () => {
    expect(parseClock('01:13:72')).toBeCloseTo(73.72);
    expect(parseClock('00:04:50')).toBeCloseTo(4.5);
    expect(parseClock('02:05')).toBe(125);
    expect(parseClock('75')).toBe(75);
    expect(parseClock('100:00:50')).toBeCloseTo(6000.5);
    expect(parseClock(' 00:01:00 ')).toBe(1);
  });

  it('reads back what clock writes', () => {
    for (const sec of [0, 4.5, 73.72, 599.99, 6000.5]) {
      expect(parseClock(clock(sec))).toBeCloseTo(sec);
    }
  });

  it('refuses seconds of 60 or more in the colon forms', () => {
    expect(parseClock('00:75:00')).toBeNull();
    expect(parseClock('00:60')).toBeNull();
    expect(parseClock('01:60:00')).toBeNull();
  });

  it('refuses hundredths of more than two digits, more than three parts and non-digits', () => {
    expect(parseClock('00:01:123')).toBeNull();
    expect(parseClock('00:00:01:00')).toBeNull();
    expect(parseClock('1.5')).toBeNull();
    expect(parseClock('ab')).toBeNull();
    expect(parseClock('00:-1:00')).toBeNull();
    expect(parseClock('')).toBeNull();
    expect(parseClock('00::00')).toBeNull();
  });
});

describe('LoopEditorDialog time fields', () => {
  const sound = makeSound({ id: 'rain', name: 'Rain', durationSec: 60 });

  function renderDialog() {
    const fake = makeFakeEngine();
    fake.spies.getWaveformPeaks.mockResolvedValue(new Float32Array(480));
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <I18nProvider initial="en">
        <PlayerProvider sounds={[sound]} engine={fake.engine}>
          <LoopEditorDialog
            sound={sound}
            initial={soundLoop(sound)}
            onSave={onSave}
            onClose={onClose}
          />
        </PlayerProvider>
      </I18nProvider>,
    );
    const dialog = within(screen.getByRole('dialog', { name: 'Loop editor' }));
    const field = (name: string) => dialog.getByRole('textbox', { name }) as HTMLInputElement;
    return { user: userEvent.setup(), dialog, field, onSave, onClose };
  }

  it('shows each marker as mm:ss:cc', () => {
    const { field } = renderDialog();
    expect(field('Track start')).toHaveValue('00:00:00');
    expect(field('Loop start')).toHaveValue('00:00:00');
    expect(field('Loop end')).toHaveValue('01:00:00');
    expect(field('Track end')).toHaveValue('01:00:00');
  });

  it('sets the marker on Enter without submitting or closing the dialog', async () => {
    const { user, dialog, field, onSave, onClose } = renderDialog();
    await user.clear(field('Loop start'));
    await user.type(field('Loop start'), '00:04:50{Enter}');

    expect(field('Loop start')).toHaveValue('00:04:50');
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Loop editor' })).toBeInTheDocument();

    await user.click(dialog.getByRole('button', { name: 'Apply' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ loopStartSec: 4.5 }));
  });

  it('reads bare seconds and formats them once committed', async () => {
    const { user, field } = renderDialog();
    await user.clear(field('Loop end'));
    await user.type(field('Loop end'), '45');
    await user.tab();
    expect(field('Loop end')).toHaveValue('00:45:00');
  });

  it('commits on blur', async () => {
    const { user, dialog, field, onSave } = renderDialog();
    await user.clear(field('Loop start'));
    await user.type(field('Loop start'), '00:10:25');
    await user.tab();
    expect(field('Loop start')).toHaveValue('00:10:25');
    await user.click(dialog.getByRole('button', { name: 'Apply' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ loopStartSec: 10.25 }));
  });

  it('reverts unreadable text on blur and leaves the marker alone', async () => {
    const { user, dialog, field, onSave } = renderDialog();
    await user.clear(field('Loop start'));
    await user.type(field('Loop start'), '00:75:00');
    expect(field('Loop start')).toHaveValue('00:75:00');
    await user.tab();
    expect(field('Loop start')).toHaveValue('00:00:00');
    await user.click(dialog.getByRole('button', { name: 'Apply' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ loopStartSec: 0 }));
  });

  it('strips anything but digits and colons as it is typed', async () => {
    const { user, field } = renderDialog();
    await user.clear(field('Loop start'));
    await user.type(field('Loop start'), '0a0:0x5.:2b0');
    expect(field('Loop start')).toHaveValue('00:05:20');
    await user.keyboard('{Enter}');
    expect(field('Loop start')).toHaveValue('00:05:20');
  });

  it('reverts the typed text on Escape without closing the dialog', async () => {
    const { user, dialog, field, onSave, onClose } = renderDialog();
    await user.clear(field('Loop start'));
    await user.type(field('Loop start'), '00:30:00');
    await user.keyboard('{Escape}');
    expect(field('Loop start')).toHaveValue('00:00:00');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Loop editor' })).toBeInTheDocument();

    // Leaving the field afterwards commits nothing.
    await user.tab();
    await user.click(dialog.getByRole('button', { name: 'Apply' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ loopStartSec: 0 }));
  });
});
