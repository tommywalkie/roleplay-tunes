/**
 * `ContactDialog` reads `window.__CONTACT_FORM__` once at module load. The server writes it
 * in production and in development (`GET /api/settings/contact.js`); nothing sets it under
 * test, so the form is off unless a case stubs the global. Each case resets the module
 * registry and imports the dialog and the provider it needs from that fresh graph, so they
 * share one copy of the i18n context.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

type ContactModule = typeof import('./ContactDialog');
type I18nModule = typeof import('../i18n');

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Loads the dialog with the server's answer stubbed, as the script in `index.html` sets it. */
async function load(
  mode: 'off' | 'local' | 'provider',
  settings: { provider?: string; endpoint?: string } = {},
): Promise<{ contact: ContactModule; i18n: I18nModule }> {
  vi.resetModules();
  vi.stubGlobal('__CONTACT_FORM__', { mode, ...settings });
  const contact = await import('./ContactDialog');
  const i18n = await import('../i18n');
  return { contact, i18n };
}

function renderDialog(
  ContactDialog: ContactModule['ContactDialog'],
  I18nProvider: I18nModule['I18nProvider'],
  me?: { name: string; email: string },
) {
  render(
    <I18nProvider initial="en">
      <ContactDialog me={me} onClose={vi.fn()} />
    </I18nProvider>,
  );
  return userEvent.setup();
}

/** Answers every URL with 204 and records the call. */
function stubLocalFetch() {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (...[url, init]: [url: string, init?: RequestInit]) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      return new Response(null, { status: 204 });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ContactDialog with the form off', () => {
  it('reports the mode as off and does not enable the form', async () => {
    const { contact } = await load('off');
    expect(contact.CONTACT_FORM_MODE).toBe('off');
    expect(contact.CONTACT_FORM_ENABLED).toBe(false);
  });

  it('is off when the server injected nothing at all', async () => {
    vi.resetModules();
    const contact = await import('./ContactDialog');
    expect(contact.CONTACT_FORM_MODE).toBe('off');
    expect(contact.CONTACT_FORM_ENABLED).toBe(false);
  });
});

describe('ContactDialog in local mode', () => {
  it('fills in a signed-in user and posts the message, then says it was sent', async () => {
    const { contact, i18n } = await load('local');
    expect(contact.CONTACT_FORM_ENABLED).toBe(true);
    const calls = stubLocalFetch();
    const user = renderDialog(contact.ContactDialog, i18n.I18nProvider, {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });

    await user.type(screen.getByLabelText('Message'), 'The tavern loop is perfect.');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Message sent')).toBeInTheDocument();
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/contact',
        method: 'POST',
        body: {
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          message: 'The tavern loop is perfect.',
          _honeypot: '',
        },
      }),
    );
  });

  it('refuses to post an incomplete form and explains why', async () => {
    const { contact, i18n } = await load('local');
    const calls = stubLocalFetch();
    const user = renderDialog(contact.ContactDialog, i18n.I18nProvider);

    await user.type(screen.getByLabelText('Message'), 'A message, but no name or email');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Fill in this field')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});

describe('ContactDialog in provider mode', () => {
  it('renders a native form posting to the endpoint with the provider fields', async () => {
    const { contact, i18n } = await load('provider', {
      provider: 'dsforms',
      endpoint: 'https://forms.example/submit',
    });
    expect(contact.CONTACT_FORM_MODE).toBe('provider');
    expect(contact.CONTACT_FORM_ENABLED).toBe(true);
    renderDialog(contact.ContactDialog, i18n.I18nProvider);

    const form = screen.getByRole('dialog', { name: 'Contact' });
    expect(form).toHaveAttribute('method', 'POST');
    expect(form).toHaveAttribute('action', 'https://forms.example/submit');

    const honeypot = form.querySelector('input[name="_honeypot"]');
    expect(honeypot).not.toBeNull();
    expect(honeypot).toHaveAttribute('type', 'text');

    const redirect = form.querySelector<HTMLInputElement>('input[name="_redirect"]');
    expect(redirect).not.toBeNull();
    expect(redirect!.value).toContain('contact=sent');
    expect(within(form).getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('uses the field names of another provider', async () => {
    const { contact, i18n } = await load('provider', {
      provider: 'web3forms',
      endpoint: 'https://api.web3forms.com/submit',
    });
    renderDialog(contact.ContactDialog, i18n.I18nProvider);

    const form = screen.getByRole('dialog', { name: 'Contact' });
    expect(form.querySelector('input[name="botcheck"]')).not.toBeNull();
    expect(form.querySelector<HTMLInputElement>('input[name="redirect"]')!.value).toContain(
      'contact=sent',
    );
  });
});
