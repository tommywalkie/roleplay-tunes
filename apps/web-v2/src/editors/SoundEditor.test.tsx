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

function renderEditor(sound = makeSound()) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
    json(200, sound),
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
  return { user: userEvent.setup(), fetchMock };
}

describe('SoundEditor', () => {
  it('lets the owner set description, license and visibility', async () => {
    const { user, fetchMock } = renderEditor();
    await user.type(screen.getByLabelText('Description'), 'Crowd in a busy inn');
    await user.selectOptions(screen.getByLabelText('License'), 'CC BY 4.0');
    expect(screen.queryByLabelText('Your license')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Public' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sounds/s1');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      description: 'Crowd in a busy inn',
      license: 'CC BY 4.0',
      isPublic: true,
    });
  });

  it('saves the typed text when the license is Other', async () => {
    const { user, fetchMock } = renderEditor();
    await user.selectOptions(screen.getByLabelText('License'), 'Other');
    await user.type(screen.getByLabelText('Your license'), 'Recorded by Jo, credit required');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      license: 'Recorded by Jo, credit required',
    });
  });

  it('shows a sound without a license as Unknown and saves it unchanged', async () => {
    const { user, fetchMock } = renderEditor();
    expect(screen.getByLabelText('License')).toHaveDisplayValue('Unknown');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({ license: '' });
  });

  it('saves the options worded per language as codes', async () => {
    const { user, fetchMock } = renderEditor(makeSound({ license: 'CC0 1.0' }));
    const license = screen.getByLabelText('License');
    await user.selectOptions(license, 'Private use only');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ license: 'private-use' });

    await user.selectOptions(license, 'Unknown');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ license: 'unknown' });
  });

  it('opens a custom license on Other with its text filled in', () => {
    renderEditor(makeSound({ license: 'Free for streams' }));
    expect(screen.getByLabelText('License')).toHaveDisplayValue('Other');
    expect(screen.getByLabelText('Your license')).toHaveValue('Free for streams');
  });

  it('picks an icon in its own dialog, which closes and updates the preview', async () => {
    const { user } = renderEditor();
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (url === '/icons/index.json') return json(200, [{ id: 'game', label: 'Game icons', count: 2 }]);
      if (url === '/icons/game.json') {
        return json(200, {
          icons: {
            dragon: { m: '<svg data-icon="dragon"></svg>', l: 'Dragon' },
            sword: { m: '<svg data-icon="sword"></svg>', l: 'Sword' },
          },
        });
      }
      return json(200, makeSound());
    });
    vi.stubGlobal('fetch', fetchMock);
    const editor = screen.getByRole('dialog', { name: 'Edit sound' });

    await user.click(within(editor).getByRole('button', { name: 'Choose icon' }));
    const picker = within(screen.getByRole('dialog', { name: 'Choose icon' }));
    await user.click(await picker.findByRole('button', { name: 'Dragon' }));

    expect(screen.queryByRole('dialog', { name: 'Choose icon' })).not.toBeInTheDocument();
    expect(editor.querySelector('[data-icon="dragon"]')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1]?.body))).toMatchObject({
      illustration: { type: 'icon', iconId: 'game:dragon' },
    });
  });

  it('greys out the owner fields of an added sound and saves only the own volume', async () => {
    const sound = makeSound({ access: 'added', ownerName: 'Grace', isPublic: true });
    const { user, fetchMock } = renderEditor(sound);

    expect(screen.getByText('Shared by Grace. Only they can change it')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Description')).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Public' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose image' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove from my library' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({ defaultVolume: 0.8, sceneIds: [] });
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
