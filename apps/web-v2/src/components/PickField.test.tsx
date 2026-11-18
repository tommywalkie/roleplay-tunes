import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioLines } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n';
import { makeSound } from '../test/fixtures';
import { Dialog } from './Dialog';
import { PickField } from './PickField';

const items = ['Anvil', 'Bells', 'Crowd', 'Drip', 'Embers'].map((name) =>
  makeSound({ id: name.toLowerCase(), name }),
);

/** Tests run without CSS: a dialog under another one is marked on its overlay. */
const shown = (dialog: HTMLElement) => dialog.parentElement!.dataset.dialogState === 'shown';

/** An editor holding the field, as the mix and scene editors do. */
function Editor({ initial, disabled }: { initial: string[]; disabled?: boolean }) {
  const [selected, setSelected] = useState(initial);
  return (
    <Dialog title="Editor" onClose={() => {}}>
      <PickField
        label="Sounds in this mix"
        items={items}
        selected={selected}
        onChange={setSelected}
        fallback={AudioLines}
        emptyText="No sounds"
        disabled={disabled}
      />
    </Dialog>
  );
}

function setup(initial: string[] = [], disabled?: boolean) {
  render(
    <I18nProvider initial="en">
      <Editor initial={initial} disabled={disabled} />
    </I18nProvider>,
  );
  const editor = screen.getByRole('dialog', { name: 'Editor' });
  return { user: userEvent.setup(), editor, field: within(editor) };
}

describe('PickField', () => {
  it('says None yet while nothing is chosen', () => {
    const { field } = setup();
    expect(field.getByText('None yet')).toBeInTheDocument();
    expect(field.getByText('0 selected')).toBeInTheDocument();
  });

  it('names up to three choices', () => {
    const { field } = setup(['anvil', 'bells', 'crowd']);
    expect(field.getByText('Anvil, Bells, Crowd')).toBeInTheDocument();
    expect(field.getByText('3 selected')).toBeInTheDocument();
  });

  it('counts the choices past the third', () => {
    const { field } = setup(['anvil', 'bells', 'crowd', 'drip', 'embers']);
    expect(field.getByText('Anvil, Bells, Crowd +2')).toBeInTheDocument();
    expect(field.getByText('5 selected')).toBeInTheDocument();
  });

  it('opens the checklist over the editor, applies ticks at once, and Done returns', async () => {
    const { user, editor, field } = setup(['anvil']);
    await user.click(field.getByRole('button', { name: 'Choose' }));

    const picker = screen.getByRole('dialog', { name: 'Sounds in this mix' });
    expect(shown(picker)).toBe(true);
    expect(shown(editor)).toBe(false);
    expect(within(picker).getByRole('checkbox', { name: /Anvil/ })).toHaveAttribute('aria-checked', 'true');

    await user.click(within(picker).getByRole('checkbox', { name: /Drip/ }));
    expect(within(picker).getByRole('checkbox', { name: /Drip/ })).toHaveAttribute('aria-checked', 'true');
    expect(field.getByText('Anvil, Drip')).toBeInTheDocument();
    expect(field.getByText('2 selected')).toBeInTheDocument();

    await user.click(within(picker).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Sounds in this mix' })).not.toBeInTheDocument();
    expect(shown(editor)).toBe(true);
    expect(field.getByText('Anvil, Drip')).toBeInTheDocument();
  });

  it('cannot be opened when disabled', () => {
    const { field } = setup([], true);
    expect(field.getByRole('button', { name: 'Choose' })).toBeDisabled();
  });
});
