import { SYNONYMS_PER_ITEM } from '@dnd/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { SynonymsField } from './SynonymsField';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

/** Synonyms the user already put on other items, as GET /api/synonyms returns them. */
const KNOWN = ['forest', 'Forêt sombre', 'forge', 'rain', 'bells'];

function Harness({ initial, others }: { initial: string[]; others?: string[] }) {
  const [mine, setMine] = useState(initial);
  return (
    <>
      <SynonymsField mine={mine} others={others} othersBy="Grace" onChange={setMine} />
      <output aria-label="saved">{JSON.stringify(mine)}</output>
    </>
  );
}

function setup(initial: string[] = [], others?: string[]) {
  const fetchMock = vi.fn(async (url: string) => (url === '/api/synonyms' ? json(200, KNOWN) : json(404, {})));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider initial="en">
        <Harness initial={initial} others={others} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  const input = screen.getByRole('combobox', { name: 'Synonyms' });
  const saved = () => JSON.parse(screen.getByRole('status', { hidden: true }).textContent!) as string[];
  return { user: userEvent.setup(), input, saved, fetchMock };
}

describe('SynonymsField', () => {
  it('adds the typed word on Enter and clears the field', async () => {
    const { user, input, saved } = setup();
    await user.type(input, '  wolf  {Enter}');
    expect(saved()).toEqual(['wolf']);
    expect(input).toHaveValue('');
    expect(within(screen.getByRole('list', { name: 'Synonyms' })).getByText('wolf')).toBeInTheDocument();
  });

  it('keeps an exact duplicate once, but a different spelling is another synonym', async () => {
    const { user, input, saved } = setup(['wolf'], ['bells']);
    await user.type(input, 'wolf{Enter}');
    await user.type(input, 'bells{Enter}');
    expect(saved()).toEqual(['wolf']);
    await user.type(input, 'Wolf{Enter}');
    expect(saved()).toEqual(['wolf', 'Wolf']);
  });

  it('suggests the user’s synonyms that match, leaving out those already on the item', async () => {
    const { user, input, saved, fetchMock } = setup(['forest']);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/synonyms', expect.anything()));
    await user.type(input, 'for');
    const options = within(await screen.findByRole('listbox')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Forêt sombre', 'forge']);

    await user.click(screen.getByRole('option', { name: 'forge' }));
    expect(saved()).toEqual(['forest', 'forge']);
    expect(input).toHaveValue('');
  });

  it('shows the owner’s synonyms without a remove button, and removes the user’s own', async () => {
    const { user, saved } = setup(['chimes'], ['bells']);
    const chips = within(screen.getByRole('list', { name: 'Synonyms' }));
    expect(chips.getByText('bells')).toHaveAttribute('title', 'Added by Grace');
    expect(chips.queryByRole('button', { name: 'Remove bells' })).not.toBeInTheDocument();
    await user.click(chips.getByRole('button', { name: 'Remove chimes' }));
    expect(saved()).toEqual([]);
    expect(screen.getByText('bells')).toBeInTheDocument();
  });

  it('Backspace in an empty field removes the user’s last synonym, never the owner’s', async () => {
    const { user, input, saved } = setup(['chimes', 'gong'], ['bells']);
    await user.click(input);
    await user.keyboard('{Backspace}');
    expect(saved()).toEqual(['chimes']);
    await user.keyboard('{Backspace}{Backspace}');
    expect(saved()).toEqual([]);
    expect(screen.getByText('bells')).toBeInTheDocument();
  });

  it('Backspace while typing edits the text only', async () => {
    const { user, input, saved } = setup(['chimes']);
    await user.type(input, 'go{Backspace}');
    expect(input).toHaveValue('g');
    expect(saved()).toEqual(['chimes']);
  });

  it(`stops taking new synonyms at ${SYNONYMS_PER_ITEM}`, () => {
    const { input } = setup(Array.from({ length: SYNONYMS_PER_ITEM }, (_, i) => `word ${i}`));
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('placeholder', `Up to ${SYNONYMS_PER_ITEM} synonyms`);
  });
});
