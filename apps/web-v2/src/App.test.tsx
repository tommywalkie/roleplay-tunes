import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ToastProvider } from './components/Toasts';
import { I18nProvider } from './i18n';
import type { Library } from '@dnd/shared';
import { makeFakeEngine, makeMe, makeSound } from './test/fixtures';

// One fake engine for the whole file: the player keeps a single shared engine at module level.
let fakeEngine: ReturnType<typeof makeFakeEngine> | undefined;
function getFake() {
  fakeEngine ??= makeFakeEngine();
  return fakeEngine;
}

vi.mock('@dnd/audio-engine', async (orig) => ({
  ...(await orig<typeof import('@dnd/audio-engine')>()),
  createAudioEngine: () => getFake().engine,
}));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let signedIn = false;
let role: 'user' | 'admin' = 'user';
let library: Library = { sounds: [], mixes: [] };

/** Answers each URL from a table; unknown URLs fail loudly. */
function stubFetch() {
  const routes: Record<string, (init?: RequestInit) => Response> = {
    '/api/me': () =>
      signedIn
        ? json(200, makeMe({ role, name: 'Ada Lovelace', email: 'ada@example.com' }))
        : json(401, { error: { code: 'unauthorized', message: 'Sign in required' } }),
    '/api/sounds': () => json(200, []),
    '/api/mixes': () => json(200, []),
    '/api/scenes': () => json(200, []),
    '/api/library': () => json(200, library),
    '/api/library/sounds/pub1': () => new Response(null, { status: 204 }),
    '/api/settings/public': () => json(200, { signupsOpen: false }),
    '/api/auth/sign-out': () => {
      signedIn = false;
      return json(200, { success: true });
    },
  };
  const mock = vi.fn(async (...[url, init]: [url: string, init?: RequestInit]) => {
    const route = routes[url];
    if (!route) throw new Error(`Unexpected request: ${url}`);
    return route(init);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function renderApp(path = '/settings') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider initial="en">
        <ToastProvider>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  signedIn = false;
  role = 'user';
  library = { sounds: [], mixes: [] };
});

/** Link names of the phone tab bar (the last navigation) and of the rail (the first). */
function navLinks() {
  const [rail, tabs] = screen.getAllByRole('navigation', { name: 'Roleplay Tunes' });
  const names = (nav: HTMLElement) =>
    within(within(nav).getByRole('list'))
      .getAllByRole('link')
      .map((link) => link.getAttribute('title') ?? link.textContent);
  return { rail: names(rail), tabs: names(tabs) };
}

afterEach(() => vi.unstubAllGlobals());

describe('App', () => {
  it('shows the sign-in page right after signing out', async () => {
    signedIn = true;
    const fetchMock = stubFetch();
    const user = renderApp('/profile');

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/sign-out',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows the board when a session exists', async () => {
    signedIn = true;
    stubFetch();
    renderApp();

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    const navs = screen.getAllByRole('navigation', { name: 'Roleplay Tunes' });
    expect(
      navs.some((nav) => within(nav).queryByRole('link', { name: 'Sounds' }) !== null),
    ).toBe(true);
    expect(screen.getByRole('complementary', { name: 'Now playing' })).toBeInTheDocument();
  });

  it('keeps five tabs on phones, with Settings and Admin on the rail and the profile', async () => {
    signedIn = true;
    role = 'admin';
    stubFetch();
    const user = renderApp('/profile');

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    const { rail, tabs } = navLinks();
    expect(tabs).toEqual(['Scenes', 'Mixes', 'Sounds', 'Library', 'Profile']);
    expect(rail).toEqual(['Scenes', 'Mixes', 'Sounds', 'Library', 'Profile', 'Settings', 'Admin']);

    expect(screen.getByText('AL')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /Administration/ }));
    expect(await screen.findByRole('heading', { name: 'Administration' })).toBeInTheDocument();
  });

  it('shows no admin link to members, and signs out from the profile', async () => {
    signedIn = true;
    stubFetch();
    const user = renderApp('/profile');

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Administration/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Storage, limits and language/ })).toBeInTheDocument();

    // TODO: Make a better/isolated test for it and sync with the current version
    // expect(screen.getAllByText('v1.0.0').length).toBeGreaterThan(0);

    // The name is joined by a non-breaking space so it never wraps.
    for (const credit of screen.getAllByRole('link', { name: /^Tom\s+Bazarnik$/ })) {
      expect(credit).toHaveAttribute('href', 'https://tommywalkie.com/');
    }

    await user.click(screen.getByRole('button', { name: /Install the app/ }));
    expect(screen.getByRole('dialog', { name: 'Install the app' })).toBeInTheDocument();
    expect(screen.getByText('Android, in Chrome')).toBeInTheDocument();
    expect(screen.getByText('iPhone and iPad, in Safari or Chrome')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('lists public items in the library and adds one', async () => {
    signedIn = true;
    library = {
      sounds: [
        makeSound({
          id: 'pub1',
          name: 'Harbor bells',
          isPublic: true,
          access: 'available',
          ownerName: 'Grace',
          description: 'Bells across the water',
          license: 'CC BY 4.0',
        }),
        makeSound({ id: 'mine', name: 'My rain', isPublic: true, access: 'owner' }),
      ],
      mixes: [],
    };
    const fetchMock = stubFetch();
    const user = renderApp('/library');

    expect(await screen.findByText('Harbor bells')).toBeInTheDocument();
    expect(screen.getByText('Bells across the water')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'License: CC BY 4.0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My rain is yours: nothing to add' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Add Harbor bells to my library' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/library/sounds/pub1',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('explains an empty tab of the library instead of reporting no match', async () => {
    signedIn = true;
    library = { sounds: [makeSound({ id: 'pub1', isPublic: true, access: 'available' })], mixes: [] };
    stubFetch();
    const user = renderApp('/library');

    await user.click(await screen.findByRole('radio', { name: '0 mixes' }));
    expect(screen.getByRole('heading', { name: 'No public mixes yet' })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument();
  });

  it('shows the sign-in page when there is no session', async () => {
    stubFetch();
    renderApp();

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
