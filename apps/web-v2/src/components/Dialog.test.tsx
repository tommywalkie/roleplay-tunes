import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { Dialog } from './Dialog';

/** Tests run without CSS: a dialog under another one is marked on its overlay. */
const shown = (dialog: HTMLElement) => dialog.parentElement!.dataset.dialogState === 'shown';

/** The dim layer behind a dialog's panel. */
const dims = (dialog: HTMLElement) => dialog.previousElementSibling!.classList.contains('bg-black/60');

function Stacked({ onCloseOuter }: { onCloseOuter: () => void }) {
  const [inner, setInner] = useState(false);
  return (
    <Dialog title="Outer" onClose={onCloseOuter}>
      <label>
        Name
        <input />
      </label>
      <button type="button" onClick={() => setInner(true)}>
        Open inner
      </button>
      {inner && (
        <Dialog title="Inner" onClose={() => setInner(false)}>
          <p>Inner body</p>
        </Dialog>
      )}
    </Dialog>
  );
}

function setup() {
  const onCloseOuter = vi.fn();
  render(
    <I18nProvider initial="en">
      <Stacked onCloseOuter={onCloseOuter} />
    </I18nProvider>,
  );
  const user = userEvent.setup();
  const outer = screen.getByRole('dialog', { name: 'Outer' });
  return { onCloseOuter, user, outer };
}

describe('Dialog stack', () => {
  it('hides the first dialog under the second, keeping its form state, and shows it again on close', async () => {
    const { user, outer, onCloseOuter } = setup();
    await user.type(within(outer).getByLabelText('Name'), 'Mira');
    await user.click(within(outer).getByRole('button', { name: 'Open inner' }));

    const inner = screen.getByRole('dialog', { name: 'Inner' });
    expect(shown(inner)).toBe(true);
    expect(shown(outer)).toBe(false);
    expect(within(outer).getByLabelText('Name')).toHaveValue('Mira');
    // One dim layer for the stack: the first dialog's.
    expect(dims(outer)).toBe(true);
    expect(dims(inner)).toBe(false);

    await user.click(within(inner).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Inner' })).not.toBeInTheDocument();
    expect(shown(outer)).toBe(true);
    expect(within(outer).getByLabelText('Name')).toHaveValue('Mira');
    expect(onCloseOuter).not.toHaveBeenCalled();
  });

  it('Escape closes only the dialog on top', async () => {
    const { user, outer, onCloseOuter } = setup();
    await user.click(within(outer).getByRole('button', { name: 'Open inner' }));

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Inner' })).not.toBeInTheDocument();
    expect(shown(outer)).toBe(true);
    expect(onCloseOuter).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onCloseOuter).toHaveBeenCalledTimes(1);
  });
});
