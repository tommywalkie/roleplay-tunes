import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../components/ui';
import { useI18n } from '../i18n';

/**
 * Delete on the left (asks for a second tap), cancel and save on the right. The same
 * footer under every editor, so the buttons are always where the thumb expects them.
 */
export function EditorFooter({
  onCancel,
  onDelete,
  saving,
  deleting,
  canSave = true,
  deleteLabel,
  confirmLabel,
}: {
  onCancel: () => void;
  /** Omit for an item that does not exist yet. */
  onDelete?: () => void;
  saving: boolean;
  deleting?: boolean;
  canSave?: boolean;
  /** Labels of the delete button and of its second tap, when it does something else. */
  deleteLabel?: string;
  confirmLabel?: string;
}) {
  const { t } = useI18n();
  const [armed, setArmed] = useState(false);

  // An armed delete button falls back to safe after a few seconds.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <>
      {onDelete && (
        <Button
          variant="danger"
          icon={Trash2}
          busy={deleting}
          onClick={() => (armed ? onDelete() : setArmed(true))}
          className="-ml-2 px-3"
        >
          {armed ? (confirmLabel ?? t('common.confirmDelete')) : (deleteLabel ?? t('common.delete'))}
        </Button>
      )}
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" busy={saving} disabled={!canSave || deleting}>
          {t('common.save')}
        </Button>
      </div>
    </>
  );
}
