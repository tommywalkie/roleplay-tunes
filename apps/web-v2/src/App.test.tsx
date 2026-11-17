import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ToastProvider } from './components/Toasts';
import { I18nProvider } from './i18n';
import { makeFakeEngine, makeMe } from './test/fixtures';

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

/** Answers each URL from a table; unknown URLs fail loudly. */
function stubFetch() {
  const routes: Record<string, (init?: RequestInit) => Response> = {
    '/api/me': () =>
      signedIn
        ? json(200, makeMe())
        : json(401, { error: { code: 'unauthorized', message: 'Sign in required' } }),
    '/api/sounds': () => json(200, []),
    '/api/mixes': () => json(200, []),
    '/api/scenes': () => json(200, []),
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

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider initial="en">
        <ToastProvider>
          <MemoryRouter initialEntries={['/settings']}>
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
});

afterEach(() => vi.unstubAllGlobals());

describe('App', () => {
  it('shows the sign-in page right after signing out', async () => {
    signedIn = true;
    const fetchMock = stubFetch();
    const user = renderApp();

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
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
    const navs = screen.getAllByRole('navigation', { name: 'DnD Ambiance' });
    expect(
      navs.some((nav) => within(nav).queryByRole('link', { name: 'Sounds' }) !== null),
    ).toBe(true);
    expect(screen.getByRole('complementary', { name: 'Now playing' })).toBeInTheDocument();
  });

  it('shows the sign-in page when there is no session', async () => {
    stubFetch();
    renderApp();

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
