import type {
  ContactMessage,
  LimitKey,
  Limits,
  Role,
  SetTermsRequest,
  TermsAdmin,
  TermsPreviewRequest,
  Usage,
} from '@dnd/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { keys } from './hooks';

/** One account as the admin list returns it. A `null` limit means "use the default". */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
  banned: boolean | null;
  lastActiveAt: string | null;
  limitStorageBytes: number | null;
  limitAudioFileBytes: number | null;
  limitAudioDurationSec: number | null;
  limitImageFileBytes: number | null;
  limitMixItems: number | null;
  usage: Usage;
}

export type LimitOverrides = Record<LimitKey, number | null>;

export interface AdminSettings {
  signupsOpen: boolean;
  defaults: Limits;
}

export interface DiskSplit {
  audioBytes: number;
  imageBytes: number;
  databaseBytes: number;
  freeBytes: number;
}

export interface DiskUsage {
  current: DiskSplit;
  history: (DiskSplit & { day: string })[];
}

const OVERRIDE_COLUMNS: Record<LimitKey, keyof AdminUser> = {
  storageBytes: 'limitStorageBytes',
  audioFileBytes: 'limitAudioFileBytes',
  audioDurationSec: 'limitAudioDurationSec',
  imageFileBytes: 'limitImageFileBytes',
  mixItems: 'limitMixItems',
};

export function overridesOf(user: AdminUser): LimitOverrides {
  const out = {} as LimitOverrides;
  for (const key of Object.keys(OVERRIDE_COLUMNS) as LimitKey[]) {
    out[key] = user[OVERRIDE_COLUMNS[key]] as number | null;
  }
  return out;
}

const adminKeys = {
  all: ['admin'] as const,
  settings: ['admin', 'settings'] as const,
  terms: ['admin', 'terms'] as const,
  users: ['admin', 'users'] as const,
  messages: ['admin', 'messages'] as const,
  usage: ['admin', 'usage'] as const,
};

export const useAdminSettings = () =>
  useQuery({
    queryKey: adminKeys.settings,
    queryFn: () => api<AdminSettings>('/api/admin/settings'),
  });
export const useAdminUsers = () =>
  useQuery({ queryKey: adminKeys.users, queryFn: () => api<AdminUser[]>('/api/admin/users') });
export const useAdminUsage = () =>
  useQuery({ queryKey: adminKeys.usage, queryFn: () => api<DiskUsage>('/api/admin/usage') });

/** Admin changes can touch the signed-in admin's own account and the public sign-up flag. */
function useAdminMutation<Input, Result = void>(run: (input: Input) => Promise<Result>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.all });
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.publicSettings });
    },
  });
}

export const useSetSignups = () =>
  useAdminMutation((open: boolean) =>
    api('/api/admin/settings/signups', { method: 'PUT', json: { open } }),
  );

export const useSetDefaultLimits = () =>
  useAdminMutation((limits: Limits) =>
    api('/api/admin/settings/defaults', { method: 'PUT', json: { limits } }),
  );

/** Every language of the server rules, as saved. */
export const useAdminTerms = () =>
  useQuery({
    queryKey: adminKeys.terms,
    queryFn: () => api<TermsAdmin>('/api/admin/settings/terms'),
  });

/** Saves the toggle and the text of every language given. */
export const useSetTerms = () =>
  useAdminMutation((body: SetTermsRequest) =>
    api<TermsAdmin>('/api/admin/settings/terms', { method: 'PUT', json: body }),
  );

/** Draft rules, sanitized by the server without being saved. */
export const usePreviewTerms = () =>
  useMutation({
    mutationFn: ({ locale, html }: TermsPreviewRequest) =>
      api<{ html: string }>('/api/admin/settings/terms/preview', {
        method: 'POST',
        json: { locale, html },
      }),
  });

export interface UserChanges {
  id: string;
  role?: Role;
  banned?: boolean;
  overrides?: LimitOverrides;
}

/** Sends only the parts that were given; each is its own request on the server. */
export const useUpdateUser = () =>
  useAdminMutation(async ({ id, role, banned, overrides }: UserChanges) => {
    const base = `/api/admin/users/${id}`;
    if (role !== undefined) await api(`${base}/role`, { method: 'PATCH', json: { role } });
    if (banned !== undefined) await api(`${base}/banned`, { method: 'PATCH', json: { banned } });
    if (overrides) await api(`${base}/limits`, { method: 'PATCH', json: { overrides } });
  });

export const useDeleteUser = () =>
  useAdminMutation((id: string) => api(`/api/admin/users/${id}`, { method: 'DELETE' }));

export const useResetLink = () =>
  useAdminMutation((id: string) =>
    api<{ url: string }>(`/api/admin/users/${id}/reset-password`, { method: 'POST', json: {} }),
  );

export const useResetPassword = () =>
  useMutation({
    mutationFn: (body: { token: string; newPassword: string }) =>
      api('/api/auth/reset-password', { method: 'POST', json: body }),
  });

/** Messages left through the contact form (local mode), newest first. */
export const useAdminMessages = () =>
  useQuery({
    queryKey: adminKeys.messages,
    queryFn: () => api<ContactMessage[]>('/api/admin/contact'),
  });

export const useSetMessageRead = () =>
  useAdminMutation(({ id, read }: { id: string; read: boolean }) =>
    api(`/api/admin/contact/${id}/read`, { method: 'PATCH', json: { read } }),
  );

export const useDeleteMessage = () =>
  useAdminMutation((id: string) => api(`/api/admin/contact/${id}`, { method: 'DELETE' }));
