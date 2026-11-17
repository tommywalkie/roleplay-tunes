import type { Me } from '@dnd/shared';
import { useI18n } from '../i18n';
import { cx } from './ui';

/** Share of the storage limit in use, 0..1. A zero limit counts as full. */
export function storageRatio(me: Pick<Me, 'usage' | 'limits'>): number {
  const limit = me.limits.storageBytes;
  return limit > 0 ? Math.min(1, me.usage.storageBytes / limit) : 1;
}

/** One bar, one sentence: how much of the account's storage is used. */
export function StorageMeter({ me, compact }: { me: Me; compact?: boolean }) {
  const { t, bytes } = useI18n();
  const ratio = storageRatio(me);
  const left = Math.max(0, me.limits.storageBytes - me.usage.storageBytes);
  const tone = ratio >= 1 ? 'bg-danger' : ratio >= 0.9 ? 'bg-lamp' : 'bg-ink-2';
  const usage = t('storage.usage', {
    used: bytes(me.usage.storageBytes),
    limit: bytes(me.limits.storageBytes),
  });

  return (
    <div className="flex flex-col gap-2">
      {!compact && (
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-mono text-[28px] leading-8 font-medium tabular-nums">
            {bytes(me.usage.storageBytes)}
          </span>
          <span className="text-[13px] leading-5 text-ink-3 tabular-nums">
            {ratio >= 1 ? t('storage.full') : t('storage.left', { left: bytes(left) })}
          </span>
        </div>
      )}
      <div
        role="progressbar"
        aria-label={t('settings.storage')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuetext={usage}
        className="h-1.5 overflow-hidden rounded-[3px] bg-line-strong"
      >
        <div
          className={cx('h-full origin-left rounded-[3px]', tone)}
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
      <span className="text-[12px] leading-4 text-ink-3 tabular-nums">{usage}</span>
    </div>
  );
}
