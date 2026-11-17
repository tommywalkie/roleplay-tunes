import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { ResetPasswordPage } from './ResetPasswordPage';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Answers each URL from a table; unknown URLs fail loudly. */
function stubFetch(routes: Record<string, () => Response>) {
  const mock = vi.fn(async (...[url]: [url: string, init?: RequestInit]) => {
    const route = routes[url];
    if (!route) throw new Error(`Unexpected request: ${url}`);
    return route();
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider initial="en">
        <MemoryRouter initialEntries={[path]}>
          <ResetPasswordPage />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

afterEach(() => vi.unstubAllGlobals());

describe('ResetPasswordPage', () => {
  it('enables the submit only from 8 characters, then confirms the change', async () => {
    const fetchMock = stubFetch({
      '/api/auth/reset-password': () => json(200, { status: true }),
    });
    const user = renderAt('/reset-password?token=abc');
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Change password' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('New password'), '1234567');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('New password'), '8');
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toBeInTheDocument();

    const call = fetchMock.mock.calls.find(([url]) => url === '/api/auth/reset-password');
    expect(call?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ token: 'abc', newPassword: '12345678' }),
    });
  });

  it('explains that an invalid or used link must be replaced', async () => {
    stubFetch({
      '/api/auth/reset-password': () => json(400, { code: 'INVALID_TOKEN', message: 'x' }),
    });
    const user = renderAt('/reset-password?token=abc');
    await user.type(screen.getByLabelText('New password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This link is no longer valid, ask for a new one',
    );
  });

  it('shows the invalid link alert at once and keeps submit disabled without a token', async () => {
    const fetchMock = stubFetch({});
    const user = renderAt('/reset-password');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This link is no longer valid, ask for a new one',
    );
    await user.type(screen.getByLabelText('New password'), 'correct horse');
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
