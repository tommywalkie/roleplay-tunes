import type { ContactMessage } from '@dnd/shared';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useDeleteMessage } from '../api/admin';
import { Dialog } from '../components/Dialog';
import { Button, ErrorNote } from '../components/ui';
import { useI18n } from '../i18n';

/** One contact message, seen by an admin: the text, and deletion. Opening it marks it read. */
export function ContactMessageDialog({
  message,
  onClose,
}: {
  message: ContactMessage;
  onClose: () => void;
}) {
  const { t, locale, errorText } = useI18n();
  const remove = useDeleteMessage();
  const [confirming, setConfirming] = useState(false);

  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(message.createdAt),
  );

  return (
    <Dialog
      title={message.name}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="danger"
            icon={Trash2}
            busy={remove.isPending}
            onClick={() =>
              confirming ? remove.mutate(message.id, { onSuccess: onClose }) : setConfirming(true)
            }
          >
            {t(confirming ? 'admin.message.confirmDelete' : 'common.delete')}
          </Button>
          <Button variant="primary" className="ml-auto" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      {remove.error && <ErrorNote>{errorText(remove.error)}</ErrorNote>}
      <div className="flex flex-col gap-1">
        <a
          href={`mailto:${message.email}`}
          className="truncate text-[14px] leading-5 text-ink-2 underline decoration-line-strong underline-offset-2 transition-colors duration-150 hover:text-ink"
        >
          {message.email}
        </a>
        <span className="text-[12px] leading-4 text-ink-3">{when}</span>
      </div>
      <p className="whitespace-pre-wrap text-[14px] leading-6 text-ink">{message.message}</p>
    </Dialog>
  );
}
