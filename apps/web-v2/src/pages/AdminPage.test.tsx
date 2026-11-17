import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminUser } from '../api/admin';
import { I18nProvider } from '../i18n';
import { makeMe } from '../test/fixtures';
import { AdminPage } from './AdminPage';

const MB = 1024 * 1024;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const empty = () => new Response(null, { status: 204 });

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Answers each URL from a table and records every call; unknown URLs fail loudly. */
function stubFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const mock = vi.fn(async (...[url, init]: [url: string, init?: RequestInit]) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const route = routes[url];
    if (!route) throw new Error(`Unexpected request: ${url}`);
    return route();
  });
  vi.stubGlobal('fetch', mock);
  return calls;
}

const users: AdminUser[] = [
  {
    id: 'u1',
    email: 'gm@example.com',
    name: 'Morgan Vale',
    role: 'admin',
    createdAt: '2026-11-01T10:00:00.000Z',
    banned: null,
    lastActiveAt: '2026-11-15T18:00:00.000Z',
    limitStorageBytes: null,
    limitAudioFileBytes: null,
    limitAudioDurationSec: null,
    limitImageFileBytes: null,
    limitMixItems: null,
    usage: { storageBytes: 125 * MB, sounds: 12, mixes: 3, scenes: 2 },
  },
  {
    id: 'u2',
    email: 'sam@example.com',
    name: 'Sam Reed',
    role: 'user',
    createdAt: '2026-11-02T10:00:00.000Z',
    banned: true,
    lastActiveAt: null,
    limitStorageBytes: 104857600,
    limitAudioFileBytes: null,
    limitAudioDurationSec: null,
    limitImageFileBytes: null,
    limitMixItems: null,
    usage: { storageBytes: 20 * MB, sounds: 3, mixes: 1, scenes: 1 },
  },
];

const routes = (): Record<string, () => Response> => ({
  '/api/admin/settings': () => json(200, { signupsOpen: false, defaults: makeMe().limits }),
  '/api/admin/usage': () =>
    json(200, {
      current: { audioBytes: 104857600, imageBytes: 10485760, databaseBytes: 1048576, freeBytes: 10737418240 },
      history: [],
    }),
  '/api/admin/users': () => json(200, users),
  '/api/admin/settings/signups': empty,
  '/api/admin/settings/defaults': empty,
  '/api/admin/users/u2/role': empty,
  '/api/admin/users/u2/banned': empty,
  '/api/admin/users/u2/limits': empty,
  '/api/admin/users/u2': empty,
  '/api/admin/users/u2/reset-password': () => json(200, { url: 'http://localhost:3000/reset-password?token=abc' }),
});

function renderAdmin() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider initial="en">
        <AdminPage me={makeMe({ id: 'u1', role: 'admin' })} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

/** The list row for a user, found by its name. */
const rowOf = (name: string) => screen.findByRole('button', { name: new RegExp(name) });

const dialogOf = (name: string) => screen.findByRole('dialog', { name });

afterEach(() => vi.unstubAllGlobals());

describe('AdminPage', () => {
  it('lists both users, marks your own account and shows disabled access', async () => {
    stubFetch(routes());
    renderAdmin();
    const morgan = await rowOf('Morgan Vale');
    const sam = await rowOf('Sam Reed');
    expect(within(morgan).getByText('You')).toBeInTheDocument();
    expect(within(sam).queryByText('You')).not.toBeInTheDocument();
    expect(within(sam).getByText(/Disabled/)).toBeInTheDocument();
  });

  it('filters the users by name and by email', async () => {
    stubFetch(routes());
    const user = renderAdmin();
    await rowOf('Morgan Vale');
    const search = screen.getByRole('searchbox', { name: 'Search' });

    await user.type(search, 'reed');
    expect(screen.queryByRole('button', { name: /Morgan Vale/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sam Reed/ })).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'gm@example');
    expect(screen.getByRole('button', { name: /Morgan Vale/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sam Reed/ })).not.toBeInTheDocument();
  });

  it('opens sign-ups with a PUT carrying open true', async () => {
    const calls = stubFetch(routes());
    const user = renderAdmin();
    await user.click(await screen.findByRole('radio', { name: 'Open' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          url: '/api/admin/settings/signups',
          method: 'PUT',
          body: { open: true },
        }),
      ),
    );
  });

  it('saves the default limits with the edited one converted to bytes', async () => {
    const calls = stubFetch(routes());
    const user = renderAdmin();
    const image = await screen.findByLabelText('Largest image, MB');
    await user.clear(image);
    await user.type(image, '10');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          url: '/api/admin/settings/defaults',
          method: 'PUT',
          body: {
            limits: {
              storageBytes: 524288000,
              audioFileBytes: 30 * MB,
              audioDurationSec: 600,
              imageFileBytes: 10 * MB,
              mixItems: 50,
            },
          },
        }),
      ),
    );
  });

  it('saves role and access changes for a user without sending limits', async () => {
    const calls = stubFetch(routes());
    const user = renderAdmin();
    await user.click(await rowOf('Sam Reed'));
    const dialog = await dialogOf('Sam Reed');

    await user.click(within(dialog).getByRole('radio', { name: 'Administrator' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Enabled' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(calls).toContainEqual(
        expect.objectContaining({ url: '/api/admin/users/u2/role', method: 'PATCH', body: { role: 'admin' } }),
      );
      expect(calls).toContainEqual(
        expect.objectContaining({ url: '/api/admin/users/u2/banned', method: 'PATCH', body: { banned: false } }),
      );
    });
    expect(calls.some((c) => c.url === '/api/admin/users/u2/limits')).toBe(false);
  });

  it('clears a user storage override and sends it as null', async () => {
    const calls = stubFetch(routes());
    const user = renderAdmin();
    await user.click(await rowOf('Sam Reed'));
    const dialog = await dialogOf('Sam Reed');

    await user.clear(within(dialog).getByLabelText('Storage, MB'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = calls.find((c) => c.url === '/api/admin/users/u2/limits');
      expect(call?.method).toBe('PATCH');
      expect((call?.body as { overrides: { storageBytes: unknown } }).overrides.storageBytes).toBeNull();
    });
  });

  it('creates a password reset link shown in a read-only field', async () => {
    stubFetch(routes());
    const user = renderAdmin();
    await user.click(await rowOf('Sam Reed'));
    const dialog = await dialogOf('Sam Reed');

    await user.click(within(dialog).getByRole('button', { name: 'Create a password reset link' }));
    const link = await within(dialog).findByRole('textbox', { name: 'Create a password reset link' });
    expect(link).toHaveAttribute('readonly');
    expect(link).toHaveValue('http://localhost:3000/reset-password?token=abc');
  });

  it('hides delete for your own account and needs two taps to delete another user', async () => {
    const calls = stubFetch(routes());
    const user = renderAdmin();

    await user.click(await rowOf('Morgan Vale'));
    const own = await dialogOf('Morgan Vale');
    expect(within(own).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    await user.click(within(own).getByRole('button', { name: 'Close' }));

    await user.click(await rowOf('Sam Reed'));
    const other = await dialogOf('Sam Reed');
    await user.click(within(other).getByRole('button', { name: 'Delete' }));
    const confirm = within(other).getByRole('button', { name: 'Tap again to delete' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    await user.click(confirm);
    await waitFor(() =>
      expect(calls).toContainEqual(expect.objectContaining({ url: '/api/admin/users/u2', method: 'DELETE' })),
    );
  });
});
