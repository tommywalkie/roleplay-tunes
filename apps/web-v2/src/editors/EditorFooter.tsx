import { Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/ui';
import { useI18n } from '../i18n';

/**
 * Delete on the left, cancel and save on the right. The same footer under every editor,
 * so the buttons are always where the thumb expects them. Delete asks in a second dialog
 * that takes the editor's place; going back returns to the editor as it was left.
 */
export function EditorFooter({
  onCancel,
  onDelete,
  saving,
  deleting,
  canSave = true,
  deleteLabel,
  confirmText,
  blocked,
}: {
  /**
   * Why the delete cannot happen right now. Set, the delete button opens a dialog that says
   * so, with no way to confirm, instead of a refusal on the form after a click.
   */
  blocked?: ReactNode;
  onCancel: () => void;
  /** Omit for an item that does not exist yet. */
  onDelete?: () => void;
  saving: boolean;
  deleting?: boolean;
  canSave?: boolean;
  /** Label of the delete button, and what the confirmation says, when it does something else. */
  deleteLabel?: string;
  confirmText?: string;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const label = deleteLabel ?? t('common.delete');

  return (
    <>
      {onDelete && (
        // Phones show the icon only: a long label such as "Remove from my library" would
        // push Cancel and Save out of the footer.
        <Button
          variant="danger"
          icon={Trash2}
          onClick={() => setConfirming(true)}
          aria-label={label}
          title={label}
          className="-ml-2 min-w-11 px-3"
        >
          <span className="hidden sm:inline">{label}</span>
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
      {confirming && onDelete && blocked && (
        <Dialog
          title={label}
          onClose={() => setConfirming(false)}
          footer={
            <Button variant="primary" onClick={() => setConfirming(false)} className="ml-auto">
              {t('common.back')}
            </Button>
          }
        >
          {blocked}
        </Dialog>
      )}
      {confirming && onDelete && !blocked && (
        <Dialog
          title={label}
          onClose={() => setConfirming(false)}
          onSubmit={onDelete}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)} className="ml-auto">
                {t('common.back')}
              </Button>
              <Button type="submit" variant="danger" icon={Trash2} busy={deleting}>
                {label}
              </Button>
            </>
          }
        >
          <p className="text-[15px] leading-[22px] text-ink-2">
            {confirmText ?? t('common.confirmDelete')}
          </p>
        </Dialog>
      )}
    </>
  );
}
