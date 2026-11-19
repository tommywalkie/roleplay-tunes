import type { Category, Sound } from '@dnd/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { illustrationChanges } from '../components/IllustrationField';
import { I18nProvider } from '../i18n';
import { makeMe, makeSound } from '../test/fixtures';
import { SoundEditor } from './SoundEditor';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

const category = (id: string, name: string): Category => ({
  id,
  name,
  color: '#3b5b8c',
  icon: null,
  createdAt: '2026-11-01T10:00:00.000Z',
});

const icons = {
  '/icons/index.json': [{ id: 'game', label: 'Game icons', count: 2 }],
  '/icons/game.json': {
    icons: {
      dragon: { m: '<svg data-icon="dragon"></svg>', l: 'Dragon' },
      sword: { m: '<svg data-icon="sword"></svg>', l: 'Sword' },
    },
  },
};

function renderEditor(sound: Sound = makeSound(), categories: Category[] = []) {
  const routes: Record<string, unknown> = {
    '/api/synonyms': [],
    '/api/categories': categories,
    ...icons,
  };
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
    json(200, url in routes ? routes[url] : sound),
  );
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider initial="en">
        <SoundEditor sound={sound} scenes={[]} me={makeMe()} onClose={() => {}} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  /** Requests that change something, in order; reads that follow a save are left out. */
  const saves = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method && init.method !== 'GET')
      .map(([url, init]) => ({ url, method: init!.method, body: JSON.parse(String(init!.body)) }));
  return { user: userEvent.setup(), fetchMock, saves };
}

describe('SoundEditor', () => {
  it('lets the owner set description, license and visibility', async () => {
    const { user, saves } = renderEditor();
    await user.type(screen.getByLabelText('Description'), 'Crowd in a busy inn');
    await user.selectOptions(screen.getByLabelText('License'), 'CC BY 4.0');
    expect(screen.queryByLabelText('Your license')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Public' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const [save] = saves();
    expect(save.url).toBe('/api/sounds/s1');
    expect(save.body).toMatchObject({
      description: 'Crowd in a busy inn',
      license: 'CC BY 4.0',
      isPublic: true,
    });
  });

  it('saves the typed text when the license is Other', async () => {
    const { user, saves } = renderEditor();
    await user.selectOptions(screen.getByLabelText('License'), 'Other');
    await user.type(screen.getByLabelText('Your license'), 'Recorded by Jo, credit required');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[0].body).toMatchObject({ license: 'Recorded by Jo, credit required' });
  });

  it('shows a sound without a license as Unknown and saves it unchanged', async () => {
    const { user, saves } = renderEditor();
    expect(screen.getByLabelText('License')).toHaveDisplayValue('Unknown');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[0].body).toMatchObject({ license: '' });
  });

  it('saves the options worded per language as codes', async () => {
    const { user, saves } = renderEditor(makeSound({ license: 'CC0 1.0' }));
    const license = screen.getByLabelText('License');
    await user.selectOptions(license, 'Private use only');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[0].body).toMatchObject({ license: 'private-use' });

    await user.selectOptions(license, 'Unknown');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[1].body).toMatchObject({ license: 'unknown' });
  });

  it('opens a custom license on Other with its text filled in', () => {
    renderEditor(makeSound({ license: 'Free for streams' }));
    expect(screen.getByLabelText('License')).toHaveDisplayValue('Other');
    expect(screen.getByLabelText('Your license')).toHaveValue('Free for streams');
  });

  it('picks an icon in its own dialog, which closes and updates the preview', async () => {
    const { user, saves } = renderEditor();
    const editor = screen.getByRole('dialog', { name: 'Edit sound' });

    await user.click(within(editor).getByRole('button', { name: 'Choose icon' }));
    const picker = within(screen.getByRole('dialog', { name: 'Choose icon' }));
    await user.click(await picker.findByRole('button', { name: 'Dragon' }));

    expect(screen.queryByRole('dialog', { name: 'Choose icon' })).not.toBeInTheDocument();
    expect(editor.querySelector('[data-icon="dragon"]')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[0].body).toMatchObject({ illustration: { type: 'icon', iconId: 'game:dragon' } });
  });

  it('sends the owner’s synonyms and categories with the sound', async () => {
    const sound = makeSound({ synonyms: [{ label: 'tavern', mine: true }], categoryIds: [] });
    const { user, saves } = renderEditor(sound, [category('c1', 'Inn'), category('c2', 'Night')]);
    await user.type(screen.getByRole('combobox', { name: 'Synonyms' }), 'pub{Enter}');

    const categories = screen.getByRole('combobox', { name: 'Categories' });
    await user.type(categories, 'Ni');
    await user.click(await screen.findByRole('option', { name: 'Night' }));
    expect(screen.getByRole('button', { name: 'Remove the Night category' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[0].body).toMatchObject({ synonyms: ['tavern', 'pub'], categoryIds: ['c2'] });
  });

  it('greys out the owner fields of an added sound and saves only the user’s own settings', async () => {
    const sound = makeSound({ access: 'added', ownerName: 'Grace', isPublic: true });
    const { user, saves } = renderEditor(sound);

    expect(screen.getByText('Shared by Grace. Only they can change it')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Description')).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Public' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose image' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Synonyms' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove from my library' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves()[0].body).toEqual({ defaultVolume: 0.8, sceneIds: [], synonyms: [], categoryIds: [] });
  });

  it('lets a user who added a sound tag it, keeping the owner’s synonyms out of the request', async () => {
    const sound = makeSound({
      access: 'added',
      ownerName: 'Grace',
      isPublic: true,
      synonyms: [
        { label: 'bells', mine: false },
        { label: 'chimes', mine: true },
      ],
      categoryIds: ['c1'],
    });
    const { user, saves } = renderEditor(sound, [category('c1', 'Harbor'), category('c2', 'Night')]);

    const chips = within(screen.getByRole('list', { name: 'Synonyms' }));
    expect(chips.getByText('bells')).toHaveAttribute('title', 'Added by Grace');
    expect(chips.queryByRole('button', { name: 'Remove bells' })).not.toBeInTheDocument();
    expect(chips.getByRole('button', { name: 'Remove chimes' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Remove the Harbor category' })).toBeInTheDocument();

    await user.type(screen.getByRole('combobox', { name: 'Synonyms' }), 'gong{Enter}');
    await user.type(screen.getByRole('combobox', { name: 'Categories' }), 'Ni');
    await user.click(await screen.findByRole('option', { name: 'Night' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const [save] = saves();
    expect(save.url).toBe('/api/sounds/s1');
    expect(save.body).toEqual({
      defaultVolume: 0.8,
      sceneIds: [],
      synonyms: ['chimes', 'gong'],
      categoryIds: ['c1', 'c2'],
    });
  });
});

describe('illustrationChanges', () => {
  it('sends the key of a reused image, nothing when it is unchanged', () => {
    const image = { type: 'image' as const, url: '/api/images/0b6f3c3e-8c1d-4c2a-9a37-3d1f2e4b5c6d' };
    expect(illustrationChanges(image, { type: 'none' })).toEqual({
      illustration: { type: 'image', imageKey: '0b6f3c3e-8c1d-4c2a-9a37-3d1f2e4b5c6d' },
    });
    expect(illustrationChanges(image, image)).toEqual({});
  });
});
