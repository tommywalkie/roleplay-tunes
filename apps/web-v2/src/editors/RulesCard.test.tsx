import type { TermsAdmin } from '@dnd/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { RulesCard } from './RulesCard';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Answers the URL the card reads and writes, and records every call; others fail loudly. */
function stubFetch(saved: TermsAdmin) {
  const calls: Call[] = [];
  const mock = vi.fn(async (...[url, init]: [url: string, init?: RequestInit]) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    if (url !== '/api/admin/settings/terms')
      throw new Error(`Unexpected request: ${method} ${url}`);
    if (method === 'GET') return json(200, saved);
    const sent = body as TermsAdmin;
    return json(200, { ...saved, enabled: sent.enabled, rules: sent.rules });
  });
  vi.stubGlobal('fetch', mock);
  return calls;
}

const saved: TermsAdmin = {
  enabled: true,
  updatedAt: '2026-03-01T10:00:00.000Z',
  rules: { en: '<p>Keep the noise down after midnight</p>', fr: '<p>Taisez-vous après minuit</p>' },
};

afterEach(() => vi.unstubAllGlobals());

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider initial="en">
        <RulesCard />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

/** The one text area the card shows, whichever language is on screen. */
const canvas = () => document.querySelector('[contenteditable="true"]') as HTMLElement;
const puts = (calls: Call[]) => calls.filter((c) => c.method === 'PUT');

/**
 * Replaces the whole text of the language on screen.
 *
 * Pasted as one block rather than typed per keystroke: ProseMirror syncs its view after
 * each transaction, and keystrokes fired faster than that sync land out of order and are
 * partly dropped. A paste is a single transaction, so the result is the text given.
 */
async function write(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(canvas());
  await user.keyboard('{Control>}{a}{/Control}');
  await user.paste(text);
}

describe('RulesCard', () => {
  it('carries both languages in the one save, so the version moves once', async () => {
    const calls = stubFetch(saved);
    const user = await renderCard();
    await screen.findByRole('toolbar');

    // English, on screen first.
    await write(user, 'Keep the noise down, and bow to nobody');

    // Then French: switching must not lose what was written in English.
    await user.click(await screen.findByRole('tab', { name: /Français/ }));
    await write(user, 'Taisez-vous, et personne ne se lève');
    expect(canvas()).toHaveTextContent('personne ne se lève');

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    const sent = puts(calls)[0].body as { rules: { en: string; fr: string } };
    expect(sent.rules.en).toContain('and bow to nobody');
    expect(sent.rules.fr).toContain('personne ne se lève');
    // One request for both languages, so the server stamps one version, not two.
    expect(puts(calls)).toHaveLength(1);
  });

  it('discards every language at once on reset, back to what is saved', async () => {
    const calls = stubFetch(saved);
    const user = await renderCard();
    await screen.findByRole('toolbar');

    await write(user, 'Something else entirely');
    await user.click(await screen.findByRole('tab', { name: /Français/ }));
    await write(user, 'Autre chose complètement');

    const reset = screen.getByRole('button', { name: 'Discard changes' });
    expect(reset).toBeEnabled();
    await user.click(reset);

    // Nothing left to save, in either language, and nothing was sent.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(reset).toBeDisabled();
    expect(puts(calls)).toHaveLength(0);

    // Both texts are the saved ones again.
    await user.click(screen.getByRole('tab', { name: /English/ }));
    expect(canvas()).toHaveTextContent('Keep the noise down after midnight');
    expect(canvas()).not.toHaveTextContent('Something else entirely');
    await user.click(screen.getByRole('tab', { name: /Français/ }));
    expect(canvas()).toHaveTextContent('Taisez-vous après minuit');
    expect(canvas()).not.toHaveTextContent('Autre chose complètement');
  });

  it('saves when only one language was touched, leaving the other as it was', async () => {
    const calls = stubFetch(saved);
    const user = await renderCard();
    await screen.findByRole('toolbar');

    await write(user, 'Keep the noise down and lock the door');
    expect(canvas()).toHaveTextContent('lock the door');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    const sent = puts(calls)[0].body as { rules: { en: string; fr: string } };
    expect(sent.rules.en).toContain('lock the door');
    expect(sent.rules.fr).toBe(saved.rules.fr);
  });
});
