import type { Limits, Role } from '@dnd/shared';
import { Check, Copy, KeyRound } from 'lucide-react';
import { useState } from 'react';
import {
  overridesOf,
  useDeleteUser,
  useResetLink,
  useUpdateUser,
  type AdminUser,
  type UserChanges,
} from '../api/admin';
import { Dialog } from '../components/Dialog';
import { fromLimitInputs, LimitFields, toLimitInputs } from '../components/LimitFields';
import { Button, ErrorNote, Segmented, TextInput } from '../components/ui';
import { useI18n } from '../i18n';
import { EditorFooter } from './EditorFooter';

/** One account, seen by an admin: role, access, its own limits, password reset, deletion. */
export function UserDialog({
  user,
  defaults,
  isSelf,
  onClose,
}: {
  user: AdminUser;
  defaults: Limits;
  /** The admin's own account: the server refuses to lock out the last admin anyway. */
  isSelf: boolean;
  onClose: () => void;
}) {
  const { t, errorText } = useI18n();
  const update = useUpdateUser();
  const remove = useDeleteUser();
  const reset = useResetLink();

  const [role, setRole] = useState<Role>(user.role);
  const [banned, setBanned] = useState(Boolean(user.banned));
  const [limits, setLimits] = useState(() => toLimitInputs(overridesOf(user)));
  const [copied, setCopied] = useState(false);

  const error = update.error ?? remove.error ?? reset.error;

  const submit = () => {
    const changes: UserChanges = { id: user.id };
    if (role !== user.role) changes.role = role;
    if (banned !== Boolean(user.banned)) changes.banned = banned;
    const overrides = fromLimitInputs(limits);
    const before = overridesOf(user);
    if (Object.entries(overrides).some(([key, value]) => before[key as keyof Limits] !== value)) {
      changes.overrides = overrides;
    }
    update.mutate(changes, { onSuccess: onClose });
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard blocked: the link stays selectable in the field.
    }
  };

  return (
    <Dialog
      title={user.name}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <EditorFooter
          onCancel={onClose}
          onDelete={isSelf ? undefined : () => remove.mutate(user.id, { onSuccess: onClose })}
          saving={update.isPending}
          deleting={remove.isPending}
        />
      }
    >
      {error && <ErrorNote>{errorText(error)}</ErrorNote>}

      <p className="-mt-2 truncate text-[14px] leading-5 text-ink-2">{user.email}</p>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] leading-5 text-ink-2">{t('admin.user.role')}</span>
        <Segmented
          label={t('admin.user.role')}
          value={role}
          onChange={setRole}
          options={[
            { value: 'user', label: t('settings.role.user') },
            { value: 'admin', label: t('settings.role.admin') },
          ]}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] leading-5 text-ink-2">{t('admin.user.access')}</span>
        <Segmented
          label={t('admin.user.access')}
          value={banned ? 'off' : 'on'}
          onChange={(v) => setBanned(v === 'off')}
          options={[
            { value: 'on', label: t('admin.user.enabled') },
            { value: 'off', label: t('admin.user.disabled') },
          ]}
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] leading-5 text-ink-2">{t('admin.user.limits')}</span>
          <span className="text-[13px] leading-5 text-ink-3">{t('admin.user.limitsHint')}</span>
        </div>
        <LimitFields value={limits} onChange={setLimits} defaults={defaults} />
      </div>

      <div className="flex flex-col items-start gap-3 border-t border-line pt-6">
        <Button
          icon={KeyRound}
          busy={reset.isPending}
          onClick={() => {
            setCopied(false);
            reset.mutate(user.id);
          }}
        >
          {t('admin.user.reset')}
        </Button>
        {reset.data && (
          <div className="flex w-full flex-col gap-2">
            <div className="flex w-full gap-2">
              <TextInput
                readOnly
                value={reset.data.url}
                aria-label={t('admin.user.reset')}
                onFocus={(e) => e.target.select()}
                className="font-mono text-[13px]"
              />
              <Button icon={copied ? Check : Copy} onClick={() => void copy(reset.data.url)}>
                {t(copied ? 'admin.user.copied' : 'admin.user.copy')}
              </Button>
            </div>
            <p className="text-[13px] leading-5 text-ink-3">{t('admin.user.resetHint')}</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
