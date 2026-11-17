import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
    await user.type(screen.getByLabelText('License'), 'CC0');
    await user.click(screen.getByRole('radio', { name: 'Public' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sounds/s1');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      description: 'Crowd in a busy inn',
      license: 'CC0',
      isPublic: true,
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
