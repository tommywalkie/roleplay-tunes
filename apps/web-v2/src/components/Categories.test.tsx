import type { Category } from '@dnd/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { CategoryField, CategoryFilter, inCategories } from './Categories';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

const category = (id: string, name: string, color = '#3b5b8c'): Category => ({
  id,
  name,
  color,
  icon: null,
  createdAt: '2026-11-01T10:00:00.000Z',
});

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** A small /api/categories that keeps what is created, edited and deleted. */
function stubCategories(initial: Category[]) {
  let list = [...initial];
  let next = 0;
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    if (method !== 'GET') calls.push({ url, method, body });
    if (url === '/api/categories' && method === 'GET') return json(200, list);
    if (url === '/api/categories' && method === 'POST') {
      const created = { ...category(`new${++next}`, body.name, body.color) };
      list = [...list, created];
      return json(201, created);
    }
    const id = url.slice('/api/categories/'.length);
    if (method === 'DELETE') {
      list = list.filter((c) => c.id !== id);
      return new Response(null, { status: 204 });
    }
    return json(200, []);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

function renderWith(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider initial="en">{node}</I18nProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

function FieldHarness({ initial }: { initial: string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <CategoryField value={value} onChange={setValue} />
      <output aria-label="value">{JSON.stringify(value)}</output>
    </>
  );
}

const valueOf = () => JSON.parse(screen.getByRole('status').textContent!) as string[];

describe('CategoryField', () => {
  it('suggests the user’s categories as they type and adds the one picked', async () => {
    stubCategories([category('c1', 'Inn'), category('c2', 'Night')]);
    const user = renderWith(<FieldHarness initial={[]} />);
    const input = screen.getByRole('combobox', { name: 'Categories' });

    await user.type(input, 'Inn');
    const list = within(await screen.findByRole('listbox'));
    expect(list.getAllByRole('option').map((o) => o.textContent)).toEqual(['Inn']);
    await user.click(list.getByRole('option', { name: 'Inn' }));

    expect(valueOf()).toEqual(['c1']);
    expect(screen.getByRole('button', { name: 'Take Inn off this item' })).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('creates a category from the typed text in a prefilled dialog and adds it once saved', async () => {
    const { calls } = stubCategories([category('c1', 'Inn')]);
    const user = renderWith(<FieldHarness initial={['c1']} />);
    await screen.findByRole('button', { name: 'Take Inn off this item' });

    await user.type(screen.getByRole('combobox', { name: 'Categories' }), 'Forest');
    await user.click(await screen.findByRole('option', { name: 'Create “Forest”' }));

    const dialog = within(screen.getByRole('dialog', { name: 'New category' }));
    expect(dialog.getByLabelText('Name')).toHaveValue('Forest');
    const swatch = dialog.getByRole('button', { name: '#2f6f62' });
    await user.click(swatch);
    expect(swatch).toHaveAttribute('aria-pressed', 'true');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    expect(calls).toEqual([
      { url: '/api/categories', method: 'POST', body: { name: 'Forest', color: '#2f6f62', iconId: null } },
    ]);
    expect(await screen.findByRole('button', { name: 'Take Forest off this item' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'New category' })).not.toBeInTheDocument();
    expect(valueOf()).toEqual(['c1', 'new1']);
  });

  it('offers no Create for a name the user already has', async () => {
    stubCategories([category('c1', 'Inn')]);
    const user = renderWith(<FieldHarness initial={[]} />);
    const input = screen.getByRole('combobox', { name: 'Categories' });
    await user.type(input, 'Inn');
    expect(await screen.findByRole('option', { name: 'Inn' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Create/ })).not.toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'inn');
    expect(await screen.findByRole('option', { name: 'Create “inn”' })).toBeInTheDocument();
  });

  it('takes a category off the item without deleting it', async () => {
    const { calls } = stubCategories([category('c1', 'Inn'), category('c2', 'Night')]);
    const user = renderWith(<FieldHarness initial={['c1', 'c2']} />);
    await user.click(await screen.findByRole('button', { name: 'Take Inn off this item' }));
    expect(valueOf()).toEqual(['c2']);
    expect(calls).toEqual([]);
  });

  it('drops a category deleted from its dialog off the item', async () => {
    const { calls } = stubCategories([category('c1', 'Inn'), category('c2', 'Night')]);
    const user = renderWith(<FieldHarness initial={['c1', 'c2']} />);
    await user.click(await screen.findByTitle('Edit Inn'));

    const dialog = within(screen.getByRole('dialog', { name: 'Edit category' }));
    expect(dialog.getByLabelText('Name')).toHaveValue('Inn');
    await user.click(dialog.getByRole('button', { name: 'Delete' }));
    const confirm = within(screen.getByRole('dialog', { name: 'Delete' }));
    expect(confirm.getByText('It comes off every item it is on. The items stay.')).toBeInTheDocument();
    await user.click(confirm.getByRole('button', { name: 'Delete' }));

    expect(calls).toEqual([{ url: '/api/categories/c1', method: 'DELETE', body: undefined }]);
    await vi.waitFor(() => expect(valueOf()).toEqual(['c2']));
  });
});

describe('CategoryDialog colors', () => {
  it('takes any other color, shown with readable text', async () => {
    const { calls } = stubCategories([]);
    const user = renderWith(<FieldHarness initial={[]} />);
    await user.type(screen.getByRole('combobox', { name: 'Categories' }), 'Sun');
    await user.click(await screen.findByRole('option', { name: 'Create “Sun”' }));
    const dialogEl = screen.getByRole('dialog', { name: 'New category' });
    const dialog = within(dialogEl);

    // The first palette color is chosen until another is picked.
    expect(dialog.getByRole('button', { name: '#8b3a3a' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(dialog.getByLabelText('Other color'), { target: { value: '#ffeeaa' } });
    expect(dialog.queryAllByRole('button', { pressed: true })).toEqual([]);

    // The preview chip: light background, dark slate text.
    const preview = dialog.getByText('Sun').parentElement!;
    expect(preview).toHaveStyle({ background: '#ffeeaa', color: '#1e293b' });

    await user.click(dialog.getByRole('button', { name: 'Save' }));
    expect(calls[0]?.body).toEqual({ name: 'Sun', color: '#ffeeaa', iconId: null });
  });
});

describe('inCategories', () => {
  it('keeps everything when no category is chosen, otherwise items with any chosen one', () => {
    expect(inCategories({ categoryIds: [] }, [])).toBe(true);
    expect(inCategories({ categoryIds: ['a'] }, ['a', 'b'])).toBe(true);
    expect(inCategories({ categoryIds: ['b', 'c'] }, ['a', 'b'])).toBe(true);
    expect(inCategories({ categoryIds: ['c'] }, ['a', 'b'])).toBe(false);
    expect(inCategories({ categoryIds: [] }, ['a'])).toBe(false);
  });
});

describe('CategoryFilter', () => {
  const items = [
    { name: 'Tavern', categoryIds: ['c1'] },
    { name: 'Forest', categoryIds: ['c2'] },
    { name: 'Harbor', categoryIds: [] },
  ];

  function FilteredList() {
    const [chosen, setChosen] = useState<string[]>([]);
    return (
      <>
        <CategoryFilter value={chosen} onChange={setChosen} />
        <ul aria-label="items">
          {items
            .filter((item) => inCategories(item, chosen))
            .map((item) => (
              <li key={item.name}>{item.name}</li>
            ))}
        </ul>
      </>
    );
  }

  const shown = () =>
    within(screen.getByRole('list', { name: 'items' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent);

  it('keeps the items carrying any chosen category, and All clears the choice', async () => {
    stubCategories([category('c1', 'Inn'), category('c2', 'Woods')]);
    const user = renderWith(<FilteredList />);
    const group = within(await screen.findByRole('group', { name: 'Filter by category' }));
    const all = group.getByRole('button', { name: 'All' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(shown()).toEqual(['Tavern', 'Forest', 'Harbor']);

    await user.click(group.getByRole('button', { name: 'Inn' }));
    expect(shown()).toEqual(['Tavern']);
    expect(all).toHaveAttribute('aria-pressed', 'false');

    await user.click(group.getByRole('button', { name: 'Woods' }));
    expect(shown()).toEqual(['Tavern', 'Forest']);
    expect(group.getByRole('button', { name: 'Inn' })).toHaveAttribute('aria-pressed', 'true');
    expect(group.getByRole('button', { name: 'Woods' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(group.getByRole('button', { name: 'Woods' }));
    expect(shown()).toEqual(['Tavern']);

    await user.click(all);
    expect(shown()).toEqual(['Tavern', 'Forest', 'Harbor']);
    expect(all).toHaveAttribute('aria-pressed', 'true');
  });

  it('is hidden while the user has no category', async () => {
    const { fetchMock } = stubCategories([]);
    renderWith(<FilteredList />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('group', { name: 'Filter by category' })).not.toBeInTheDocument();
    expect(shown()).toEqual(['Tavern', 'Forest', 'Harbor']);
  });
});
