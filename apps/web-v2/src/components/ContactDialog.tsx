import { CONTACT_MESSAGE_MAX } from '@dnd/shared';
import { CircleCheck, Send } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../api/client';
import { TextArea } from '../editors/Sharing';
import { useI18n } from '../i18n';
import { Dialog } from './Dialog';
import { Button, ErrorNote, Field, TextInput } from './ui';

/** How the contact form runs, from the server (`GET /api/settings/contact.js`). */
export type ContactMode = 'off' | 'local' | 'provider';

/** What that script sets, before the app starts. */
interface InjectedSettings {
  mode?: string;
  provider?: string;
  endpoint?: string | null;
}

declare global {
  interface Window {
    __CONTACT_FORM__?: InjectedSettings;
  }
}

const injected: InjectedSettings =
  typeof window === 'undefined' ? {} : (window.__CONTACT_FORM__ ?? {});

export const CONTACT_FORM_MODE: ContactMode =
  injected.mode === 'local' || injected.mode === 'provider' ? injected.mode : 'off';

/** False when no contact form is configured: the screens that offer it hide the entry. */
export const CONTACT_FORM_ENABLED = CONTACT_FORM_MODE !== 'off';

/** The form service's endpoint, `provider` mode only. */
const CONTACT_FORM_ENDPOINT: string = injected.endpoint?.trim() ?? '';

const CONTACT_FORM_PROVIDER: string = injected.provider?.trim() || 'dsforms';

/**
 * The honeypot and redirect field names each provider's form reads. Only `dsforms` has been
 * tried; the other two are best-effort and may need fields of their own.
 */
const PROVIDER_FIELDS: Record<string, { honeypot: string; redirect: string }> = {
  dsforms: { honeypot: '_honeypot', redirect: '_redirect' },
  formspree: { honeypot: '_gotcha', redirect: '_next' },
  web3forms: { honeypot: 'botcheck', redirect: 'redirect' },
};

/** Where the form service sends the browser back: the page it left, marked as sent. */
const SENT_PARAM = 'contact';
const SENT_VALUE = 'sent';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The current page with the "sent" mark, so a provider form returns to where it started. */
function redirectBack(): string {
  const url = new URL(window.location.href);
  url.searchParams.set(SENT_PARAM, SENT_VALUE);
  return url.href;
}

/**
 * True once, right after the form service brought the browser back: the mark is taken off
 * the address at once, so a reload does not say "sent" again.
 */
function takeSentMark(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get(SENT_PARAM) !== SENT_VALUE) return false;
  url.searchParams.delete(SENT_PARAM);
  window.history.replaceState(window.history.state, '', url);
  return true;
}
const sentOnLoad = typeof window !== 'undefined' && takeSentMark();

/** The "message sent" words, shared by the return notice and the local form's success. */
function SentBody() {
  const { t } = useI18n();
  return (
    <div role="status" className="flex flex-col items-start gap-3">
      <CircleCheck size={24} strokeWidth={1.5} aria-hidden className="text-ink-2" />
      <h3 className="text-[16px] leading-6 font-medium text-ink">{t('contact.sent.title')}</h3>
      <p className="text-[14px] leading-5 text-ink-2">{t('contact.sent.body')}</p>
    </div>
  );
}

/** "Message sent", shown once when the app opens back from the form service. */
export function ContactSentNotice() {
  const { t } = useI18n();
  const [open, setOpen] = useState(sentOnLoad);
  if (!open) return null;
  const close = () => setOpen(false);
  return (
    <Dialog
      title={t('contact.title')}
      onClose={close}
      footer={
        <Button variant="primary" onClick={close} className="ml-auto">
          {t('common.close')}
        </Button>
      }
    >
      <SentBody />
    </Dialog>
  );
}

/**
 * A message to whoever runs the app. Two modes, from the server (`GET /api/settings/contact.js`):
 *
 * - `local`: the dialog posts the message to this server (`POST /api/contact`), which keeps
 *   it for the admin. The page stays put and the success shows in place.
 * - `provider`: the dialog *is* the form the browser posts (`post`), with the field names
 *   the chosen service reads. The browser leaves for that service, which records the message
 *   and redirects back to this page marked `?contact=sent`; `ContactSentNotice` then says
 *   "sent". A request from script would hit CORS, which most services do not answer, hence a
 *   real submission.
 *
 * A signed-in user's name and email are filled in; they can change both.
 */
export function ContactDialog({
  me,
  onClose,
}: {
  me?: { name: string; email: string };
  onClose: () => void;
}) {
  const { t, errorText } = useI18n();
  const provider = CONTACT_FORM_MODE === 'provider';
  const fields = PROVIDER_FIELDS[CONTACT_FORM_PROVIDER] ?? PROVIDER_FIELDS.dsforms;
  const honeypot = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(me?.name ?? '');
  const [email, setEmail] = useState(me?.email ?? '');
  const [message, setMessage] = useState('');
  const [checked, setChecked] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const emailOk = EMAIL.test(email.trim());
  const complete = name.trim() !== '' && emailOk && message.trim() !== '';

  // Local mode posts from script, so the dialog form does not validate: do it here, then send.
  const sendLocal = async () => {
    setChecked(true);
    if (!complete || sending) return;
    setSending(true);
    setFailure(null);
    try {
      await api('/api/contact', {
        method: 'POST',
        json: {
          name: name.trim(),
          email: email.trim(),
          message: message.trim(),
          _honeypot: honeypot.current?.value ?? '',
        },
      });
      setSent(true);
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <Dialog
        title={t('contact.title')}
        onClose={onClose}
        footer={
          <Button variant="primary" onClick={onClose} className="ml-auto">
            {t('common.close')}
          </Button>
        }
      >
        <SentBody />
      </Dialog>
    );
  }

  // A provider form sends itself; a local form is validated and sent from script.
  const error = (field: boolean) =>
    checked && !provider && field ? t('contact.required') : undefined;

  return (
    <Dialog
      title={t('contact.title')}
      onClose={onClose}
      post={provider ? CONTACT_FORM_ENDPOINT : undefined}
      onSubmit={provider ? undefined : () => void sendLocal()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="ml-auto">
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" icon={Send} busy={sending}>
            {t('contact.send')}
          </Button>
        </>
      }
    >
      <p className="text-[14px] leading-5 text-ink-2">{t('contact.intro')}</p>
      <Field label={t('contact.name')} error={error(name.trim() === '')}>
        {(id) => (
          <TextInput
            id={id}
            name="name"
            value={name}
            required
            maxLength={100}
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field
        label={t('login.email')}
        hint={t('contact.emailHint')}
        error={checked && !provider && !emailOk ? t('contact.invalidEmail') : undefined}
      >
        {(id) => (
          <TextInput
            id={id}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={email}
            required
            maxLength={254}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </Field>
      <TextArea
        label={t('contact.message')}
        name="message"
        value={message}
        onChange={setMessage}
        maxLength={CONTACT_MESSAGE_MAX}
        required
        error={error(message.trim() === '')}
      />
      {failure && <ErrorNote>{failure}</ErrorNote>}
      {/* Left empty by people, filled by bots. A provider reads it by name; the local server
          reads it from the request body. */}
      <input
        ref={honeypot}
        type="text"
        name={provider ? fields.honeypot : '_honeypot'}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        style={{ display: 'none' }}
      />
      {provider && (
        <>
          <input type="hidden" name={fields.redirect} value={redirectBack()} />
          <p className="text-[13px] leading-5 text-ink-3">{t('contact.leaving')}</p>
        </>
      )}
    </Dialog>
  );
}
