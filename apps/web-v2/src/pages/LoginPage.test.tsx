import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matches } from '../components/Page';
import { PickList } from '../components/PickList';
import { FALLBACK_ICONS } from '../components/kinds';
import { I18nProvider, type Locale } from '../i18n';
import { LoginPage } from './LoginPage';

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

function renderLogin(locale: Locale = 'en') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider initial={locale}>
        <LoginPage />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

afterEach(() => vi.unstubAllGlobals());

describe('LoginPage', () => {
  it('enables sign in only once email and password are filled, then posts them', async () => {
    const fetchMock = stubFetch({
      '/api/settings/public': () => json(200, { signupsOpen: false }),
      '/api/auth/sign-in/email': () => json(200, { user: { id: 'u1' } }),
      '/api/me': () => json(401, { error: { code: 'unauthorized', message: '' } }),
    });
    const user = renderLogin();
    const submit = screen.getByRole('button', { name: 'Sign in' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('Email'), 'gm@example.com');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    expect(submit).toBeEnabled();

    await user.click(submit);
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/auth/sign-in/email');
    expect(call?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ email: 'gm@example.com', password: 'correct horse' }),
    });
  });

  it('explains a refused sign in', async () => {
    stubFetch({
      '/api/settings/public': () => json(200, { signupsOpen: false }),
      '/api/auth/sign-in/email': () =>
        json(401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }),
    });
    const user = renderLogin();
    await user.type(screen.getByLabelText('Email'), 'gm@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password');
  });

  it('offers account creation only while sign-ups are open', async () => {
    stubFetch({ '/api/settings/public': () => json(200, { signupsOpen: true }) });
    const user = renderLogin();
    await user.click(await screen.findByRole('button', { name: 'Create an account' }));
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  it('hides account creation when sign-ups are closed', async () => {
    const fetchMock = stubFetch({ '/api/settings/public': () => json(200, { signupsOpen: false }) });
    renderLogin();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Create an account' })).not.toBeInTheDocument();
  });

  it('reads in French', () => {
    stubFetch({ '/api/settings/public': () => json(200, { signupsOpen: false }) });
    renderLogin('fr');
    expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
  });
});

describe('matches', () => {
  it('ignores case and accents, and accepts an empty query', () => {
    expect(matches('Forêt de nuit', 'foret')).toBe(true);
    expect(matches('Tavern crowd', 'CROWD')).toBe(true);
    expect(matches('Tavern crowd', '  ')).toBe(true);
    expect(matches('Tavern crowd', 'forest')).toBe(false);
  });
});

describe('PickList', () => {
  const items = ['Crowd', 'Fireplace', 'Rain'].map((name) => ({
    id: name.toLowerCase(),
    name,
    illustration: { type: 'none' as const },
  }));

  function renderList(selected: string[], max?: number) {
    const onChange = vi.fn();
    render(
      <I18nProvider initial="en">
        <PickList
          label="Sounds"
          items={items}
          selected={selected}
          onChange={onChange}
          fallback={FALLBACK_ICONS.sound}
          emptyText="Nothing"
          max={max}
        />
      </I18nProvider>,
    );
    return { onChange, user: userEvent.setup() };
  }

  it('adds and removes ids, keeping the order of selection', async () => {
    const { onChange, user } = renderList(['rain']);
    expect(screen.getByRole('checkbox', { name: 'Rain' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Crowd' }));
    expect(onChange).toHaveBeenLastCalledWith(['rain', 'crowd']);
    await user.click(screen.getByRole('checkbox', { name: 'Rain' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('blocks new picks at the limit but still lets the user unpick', () => {
    renderList(['rain', 'crowd'], 2);
    expect(screen.getByRole('checkbox', { name: 'Fireplace' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Rain' })).toBeEnabled();
  });
});
