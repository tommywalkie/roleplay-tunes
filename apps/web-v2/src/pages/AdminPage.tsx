import type { ContactMessage, Limits, Me } from '@dnd/shared';
import { ChevronRight } from 'lucide-react';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import {
  useAdminMessages,
  useAdminSettings,
  useAdminUsage,
  useAdminUsers,
  useSetDefaultLimits,
  useSetMessageRead,
  useSetSignups,
  type AdminUser,
  type DiskSplit,
} from '../api/admin';
import { fromLimitInputs, LimitFields, toLimitInputs } from '../components/LimitFields';
import { matches, NoMatch, Page, Pagination, QueryGate, usePages } from '../components/Page';
import { Button, cx, ErrorNote, Icon, SearchField, Segmented } from '../components/ui';
import { ContactMessageDialog } from '../editors/ContactMessageDialog';
import { UserDialog } from '../editors/UserDialog';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';

/** The rules editor pulls in a whole rich-text engine: only the Admin page needs it. */
const RulesCard = lazy(() =>
  import('../editors/RulesCard').then((module) => ({ default: module.RulesCard })),
);

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-[16px] border border-line bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-[13px] leading-5 text-ink-2">{title}</h2>
        {hint && <p className="text-[13px] leading-5 text-ink-3">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const DISK_PARTS: { key: keyof DiskSplit; label: MessageKey; tone: string }[] = [
  { key: 'audioBytes', label: 'admin.disk.audio', tone: 'bg-ink' },
  { key: 'imageBytes', label: 'admin.disk.images', tone: 'bg-ink-2' },
  { key: 'databaseBytes', label: 'admin.disk.database', tone: 'bg-ink-3' },
  { key: 'freeBytes', label: 'admin.disk.free', tone: 'bg-line-strong' },
];

/** The server's disk as one stacked bar: what the app stores, and what is left. */
function DiskCard({ disk }: { disk: DiskSplit }) {
  const { t, bytes } = useI18n();
  const used = disk.audioBytes + disk.imageBytes + disk.databaseBytes;
  const total = used + disk.freeBytes;
  return (
    <Card title={t('admin.disk')}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-[28px] leading-8 font-medium tabular-nums">{bytes(used)}</span>
        <span className="text-[13px] leading-5 text-ink-3 tabular-nums">
          {t('storage.left', { left: bytes(disk.freeBytes) })}
        </span>
      </div>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-[4px]" aria-hidden>
        {DISK_PARTS.map(({ key, tone }) =>
          disk[key] > 0 ? (
            <span
              key={key}
              className={cx('h-full min-w-1', tone)}
              style={{ flexGrow: total > 0 ? disk[key] / total : 0, flexBasis: 0 }}
            />
          ) : null,
        )}
      </div>
      <dl className="flex flex-col gap-2">
        {DISK_PARTS.map(({ key, label, tone }) => (
          <div
            key={key}
            className="flex min-h-9 items-center gap-3 border-t border-line pt-2 first:border-t-0 first:pt-0"
          >
            <span className={cx('size-2 shrink-0 rounded-full', tone)} aria-hidden />
            <dt className="flex-1 text-[14px] leading-5 text-ink-2">{t(label)}</dt>
            <dd className="text-[14px] leading-5 tabular-nums">{bytes(disk[key])}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function SignupsCard({ open }: { open: boolean }) {
  const { t, errorText } = useI18n();
  const setSignups = useSetSignups();
  // Show the choice at once; the query catches up after the request.
  const shown = setSignups.isPending ? setSignups.variables : open;
  return (
    <Card title={t('admin.signups')} hint={t('admin.signups.hint')}>
      {setSignups.error && <ErrorNote>{errorText(setSignups.error)}</ErrorNote>}
      <Segmented
        label={t('admin.signups')}
        value={shown ? 'open' : 'closed'}
        onChange={(v) => setSignups.mutate(v === 'open')}
        options={[
          { value: 'open', label: t('admin.signups.open') },
          { value: 'closed', label: t('admin.signups.closed') },
        ]}
      />
    </Card>
  );
}

function DefaultsCard({ defaults }: { defaults: Limits }) {
  const { t, errorText } = useI18n();
  const save = useSetDefaultLimits();
  const [inputs, setInputs] = useState(() => toLimitInputs(defaults));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = fromLimitInputs(inputs);
    // A default cannot be "none": an emptied field keeps its current value.
    const limits = { ...defaults };
    for (const key of Object.keys(limits) as (keyof Limits)[]) limits[key] = parsed[key] ?? defaults[key];
    setInputs(toLimitInputs(limits));
    save.mutate(limits);
  };

  return (
    <Card title={t('admin.defaults')} hint={t('admin.defaults.hint')}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {save.error && <ErrorNote>{errorText(save.error)}</ErrorNote>}
        <LimitFields value={inputs} onChange={setInputs} />
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" busy={save.isPending}>
            {t('common.save')}
          </Button>
          <span className="text-[13px] leading-5 text-ink-3" role="status">
            {save.isSuccess && t('admin.defaults.saved')}
          </span>
        </div>
      </form>
    </Card>
  );
}

function UserRow({
  user,
  defaults,
  isSelf,
  onOpen,
}: {
  user: AdminUser;
  defaults: Limits;
  isSelf: boolean;
  onOpen: () => void;
}) {
  const { t, tn, bytes, locale } = useI18n();
  const limit = user.limitStorageBytes ?? defaults.storageBytes;
  const facts = [
    t(user.role === 'admin' ? 'settings.role.admin' : 'settings.role.user'),
    user.banned ? t('admin.user.disabled') : null,
    user.lastActiveAt
      ? t('admin.user.lastActive', {
          date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
            new Date(user.lastActiveAt),
          ),
        })
      : t('admin.user.noActivity'),
  ].filter(Boolean);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-16 w-full items-center gap-4 rounded-[10px] px-3 py-2 text-left transition-colors duration-150 hover:bg-raised"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-2">
            <span className={cx('truncate text-[15px] leading-5 font-medium', user.banned && 'text-ink-3')}>
              {user.name}
            </span>
            {isSelf && <span className="shrink-0 text-[12px] leading-4 text-ink-3">{t('admin.user.you')}</span>}
          </span>
          <span className="truncate text-[13px] leading-5 text-ink-2">{user.email}</span>
          <span className="truncate text-[12px] leading-4 text-ink-3">{facts.join(' ')}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="text-[14px] leading-5 tabular-nums">
            {bytes(user.usage.storageBytes)} / {bytes(limit)}
          </span>
          <span className="hidden text-[12px] leading-4 text-ink-3 tabular-nums sm:block">
            {tn('count.sounds', user.usage.sounds)} {tn('count.mixes', user.usage.mixes)}{' '}
            {tn('count.scenes', user.usage.scenes)}
          </span>
        </span>
        <Icon icon={ChevronRight} className="text-ink-3" />
      </button>
    </li>
  );
}

/** Rows of the users list per page: each one is tall, and the list sits under four cards. */
const USERS_PER_PAGE = 8;

/** Rows of the messages list per page. */
const MESSAGES_PER_PAGE = 10;

function MessageRow({ message, onOpen }: { message: ContactMessage; onOpen: () => void }) {
  const { locale } = useI18n();
  const unread = message.readAt === null;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
    new Date(message.createdAt),
  );
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-16 w-full items-center gap-4 rounded-[10px] px-3 py-2 text-left transition-colors duration-150 hover:bg-raised"
      >
        <span
          aria-hidden
          className={cx('size-2 shrink-0 rounded-full', unread ? 'bg-ink-2' : 'bg-transparent')}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cx('truncate text-[15px] leading-5', unread ? 'font-medium text-ink' : 'text-ink-2')}>
            {message.name}
          </span>
          <span className="truncate text-[13px] leading-5 text-ink-2">{message.email}</span>
          <span className="truncate text-[12px] leading-4 text-ink-3">
            {message.message.split('\n')[0]}
          </span>
        </span>
        <span className="shrink-0 text-[12px] leading-4 text-ink-3">{when}</span>
        <Icon icon={ChevronRight} className="text-ink-3" />
      </button>
    </li>
  );
}

export function AdminPage({ me }: { me: Me }) {
  const { t } = useI18n();
  const settings = useAdminSettings();
  const users = useAdminUsers();
  const messages = useAdminMessages();
  const usage = useAdminUsage();
  const setRead = useSetMessageRead();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [messageQuery, setMessageQuery] = useState('');
  const [openMessageId, setOpenMessageId] = useState<string | null>(null);

  const all = users.data ?? [];
  const found = all.filter((u) => matches(`${u.name} ${u.email}`, query));
  const pages = usePages(found, query, USERS_PER_PAGE);
  const opened = all.find((u) => u.id === openId);

  const allMessages = messages.data ?? [];
  const foundMessages = allMessages.filter((m) =>
    matches(`${m.name} ${m.email} ${m.message}`, messageQuery),
  );
  const messagePages = usePages(foundMessages, messageQuery, MESSAGES_PER_PAGE);
  const openedMessage = allMessages.find((m) => m.id === openMessageId);
  // Opening a new message reads it; the list shows the rest as unread.
  const openMessage = (message: ContactMessage) => {
    if (message.readAt === null) setRead.mutate({ id: message.id, read: true });
    setOpenMessageId(message.id);
  };

  return (
    <Page title={t('admin.title')}>
      <QueryGate
        loading={settings.isLoading || users.isLoading || messages.isLoading || usage.isLoading}
        error={settings.error ?? users.error ?? messages.error ?? usage.error}
        onRetry={() =>
          void Promise.all([
            settings.refetch(),
            users.refetch(),
            messages.refetch(),
            usage.refetch(),
          ])
        }
      >
        {settings.data && usage.data && (
          <div className="flex max-w-[960px] flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div className="flex flex-col gap-4">
                <DiskCard disk={usage.data.current} />
                <SignupsCard open={settings.data.signupsOpen} />
              </div>
              <DefaultsCard defaults={settings.data.defaults} />
            </div>

            <Suspense fallback={null}>
              <RulesCard />
            </Suspense>

            <section className="flex flex-col gap-3 rounded-[16px] border border-line bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 className="flex items-baseline gap-2 text-[13px] leading-5 text-ink-2">
                    {t('admin.users')}
                    <span className="font-mono text-[12px] text-ink-3 tabular-nums">{all.length}</span>
                  </h2>
                  <p className="text-[13px] leading-5 text-ink-3">{t('admin.users.hint')}</p>
                </div>
                <SearchField
                  value={query}
                  onChange={setQuery}
                  label={t('common.search')}
                  className="w-full sm:w-[280px]"
                />
              </div>
              {found.length === 0 ? (
                <NoMatch query={query.trim()} />
              ) : (
                // As tall as its rows: no box of its own, so the page is the one thing
                // that scrolls.
                <ul aria-label={t('admin.users')} className="-mx-3 flex flex-col gap-0.5">
                  {pages.shown.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      defaults={settings.data.defaults}
                      isSelf={user.id === me.id}
                      onOpen={() => setOpenId(user.id)}
                    />
                  ))}
                </ul>
              )}
              <Pagination pages={pages} className="self-center" />
            </section>

            <section className="flex flex-col gap-3 rounded-[16px] border border-line bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 className="flex items-baseline gap-2 text-[13px] leading-5 text-ink-2">
                    {t('admin.contact')}
                    <span className="font-mono text-[12px] text-ink-3 tabular-nums">
                      {allMessages.length}
                    </span>
                  </h2>
                  <p className="text-[13px] leading-5 text-ink-3">{t('admin.contact.hint')}</p>
                </div>
                <SearchField
                  value={messageQuery}
                  onChange={setMessageQuery}
                  label={t('admin.contact.search')}
                  className="w-full sm:w-[280px]"
                />
              </div>
              {allMessages.length === 0 ? (
                <p className="px-3 py-6 text-center text-[13px] leading-5 text-ink-3">
                  {t('admin.contact.empty')}
                </p>
              ) : foundMessages.length === 0 ? (
                <NoMatch query={messageQuery.trim()} />
              ) : (
                <ul aria-label={t('admin.contact')} className="-mx-3 flex flex-col gap-0.5">
                  {messagePages.shown.map((message) => (
                    <MessageRow
                      key={message.id}
                      message={message}
                      onOpen={() => openMessage(message)}
                    />
                  ))}
                </ul>
              )}
              <Pagination pages={messagePages} className="self-center" />
            </section>
          </div>
        )}
      </QueryGate>

      {opened && settings.data && (
        <UserDialog
          key={opened.id}
          user={opened}
          defaults={settings.data.defaults}
          isSelf={opened.id === me.id}
          onClose={() => setOpenId(null)}
        />
      )}

      {openedMessage && (
        <ContactMessageDialog message={openedMessage} onClose={() => setOpenMessageId(null)} />
      )}
    </Page>
  );
}
