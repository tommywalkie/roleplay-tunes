import type { Me } from '@dnd/shared';
import { Check, CircleAlert, FileAudio, LoaderCircle, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useUploadSound } from '../api/hooks';
import { Dialog } from '../components/Dialog';
import { Button, cx, Icon } from '../components/ui';
import { useI18n } from '../i18n';

interface Row {
  key: number;
  name: string;
  state: 'waiting' | 'uploading' | 'done' | 'error';
  error?: string;
}

/** Sends audio files one after the other and reports on each, so one refusal stops nothing. */
export function UploadDialog({
  me,
  sceneIds,
  onClose,
}: {
  me: Me;
  /** Scenes the new sounds join right away, when uploading from a scene's page. */
  sceneIds?: string[];
  onClose: () => void;
}) {
  const { t, bytes, errorText } = useI18n();
  const upload = useUploadSound();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const nextKey = useRef(0);

  const send = async (files: File[]) => {
    if (files.length === 0) return;
    const batch = files.map((file) => ({ file, key: nextKey.current++ }));
    setRows((list) => [
      ...list,
      ...batch.map(({ file, key }): Row => ({ key, name: file.name, state: 'waiting' })),
    ]);
    const set = (key: number, change: Partial<Row>) =>
      setRows((list) => list.map((r) => (r.key === key ? { ...r, ...change } : r)));
    setBusy(true);
    for (const { file, key } of batch) {
      set(key, { state: 'uploading' });
      try {
        await upload.mutateAsync({ file, sceneIds });
        set(key, { state: 'done' });
      } catch (e) {
        set(key, { state: 'error', error: errorText(e) });
      }
    }
    setBusy(false);
  };

  const done = rows.filter((r) => r.state === 'done').length;

  return (
    <Dialog
      title={t('upload.title')}
      onClose={onClose}
      footer={
        <>
          <span className="text-[13px] leading-5 text-ink-3 tabular-nums" aria-live="polite">
            {rows.length > 0 && t('upload.summary', { done, total: rows.length })}
          </span>
          <Button variant="primary" onClick={onClose} disabled={busy} className="ml-auto">
            {t('common.close')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-start gap-3">
        <Button icon={Upload} busy={busy} onClick={() => input.current?.click()}>
          {t('upload.pick')}
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept="audio/*,.mp3,.m4a,.aac,.ogg,.oga,.wav,.flac,.webm"
          className="sr-only"
          tabIndex={-1}
          aria-label={t('upload.pick')}
          onChange={(e) => {
            void send([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <p className="text-[13px] leading-5 text-ink-3">
          {t('upload.formats', {
            size: bytes(me.limits.audioFileBytes),
            minutes: Math.floor(me.limits.audioDurationSec / 60),
          })}
        </p>
        <p className="text-[13px] leading-5 text-ink-3">{t('upload.libraryHint')}</p>
      </div>

      {rows.length > 0 && (
        <ul className="flex flex-col gap-0.5 rounded-[12px] border border-line bg-deep p-1">
          {rows.map((row) => (
            <li key={row.key} className="flex min-h-12 items-center gap-3 px-3 py-2">
              <Icon icon={FileAudio} className="text-ink-3" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px] leading-5">{row.name}</span>
                {row.error && <span className="text-[13px] leading-5 text-danger">{row.error}</span>}
              </div>
              <span
                className={cx(
                  'flex shrink-0 items-center gap-2 text-[13px] leading-5',
                  row.state === 'error' ? 'text-danger' : 'text-ink-3',
                )}
              >
                {row.state === 'uploading' && <Icon icon={LoaderCircle} className="animate-spin" />}
                {row.state === 'done' && <Icon icon={Check} className="text-ok" />}
                {row.state === 'error' && <Icon icon={CircleAlert} />}
                {row.state === 'waiting' && t('upload.waiting')}
                {row.state === 'uploading' && t('upload.uploading')}
                {row.state === 'done' && t('upload.done')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
