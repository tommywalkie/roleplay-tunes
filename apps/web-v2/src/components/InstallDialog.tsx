import { EllipsisVertical, Share, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { Dialog } from './Dialog';
import { Button, Icon } from './ui';

/** True when the page runs as the installed app rather than in a browser tab. */
export function runsInstalled(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
}

/** How to add the app to the home screen, step by step, for people who never did it. */
export function InstallDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog
      title={t('install.title')}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose} className="ml-auto">
          {t('install.done')}
        </Button>
      }
    >
      <p className="text-[14px] leading-5 text-ink-2">{t('install.intro')}</p>
      <Steps
        title={t('install.android')}
        steps={['install.android.1', 'install.android.2', 'install.android.3']}
        icons={[EllipsisVertical]}
      />
      <Steps
        title={t('install.ios')}
        steps={['install.ios.1', 'install.ios.2', 'install.ios.3']}
        icons={[Share]}
      />
    </Dialog>
  );
}

/** Numbered steps. `icons[i]` shows the button that step talks about, as it looks on screen. */
function Steps({
  title,
  steps,
  icons,
}: {
  title: string;
  steps: MessageKey[];
  icons: LucideIcon[];
}) {
  const { t } = useI18n();
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[15px] leading-6 font-medium">{title}</h3>
      <ol className="flex flex-col gap-3">
        {steps.map((key, i) => (
          <Step key={key} n={i + 1} icon={icons[i]}>
            {t(key)}
          </Step>
        ))}
      </ol>
    </section>
  );
}

function Step({ n, icon, children }: { n: number; icon?: LucideIcon; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-[12px] leading-4 text-ink-2 tabular-nums">
        {n}
      </span>
      <span className="flex min-w-0 flex-1 items-start gap-2 pt-0.5 text-[14px] leading-5 text-ink">
        <span>{children}</span>
        {icon && (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-[6px] border border-line bg-raised text-ink-2">
            <Icon icon={icon} className="size-4" />
          </span>
        )}
      </span>
    </li>
  );
}
