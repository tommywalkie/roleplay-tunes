import type {
  CreateMixRequest,
  CreateSceneRequest,
  Me,
  Mix,
  PlayMode,
  PublicSettings,
  Scene,
  Sound,
  UpdateMixRequest,
  UpdateSceneRequest,
  UpdateSoundRequest,
} from '@dnd/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from './client';

export const keys = {
  me: ['me'] as const,
  publicSettings: ['settings', 'public'] as const,
  sounds: ['sounds'] as const,
  mixes: ['mixes'] as const,
  scenes: ['scenes'] as const,
};

export type Kind = 'sounds' | 'mixes' | 'scenes';

/** Sounds, mixes and scenes reference each other, and every file counts against storage. */
function invalidateLibrary(qc: QueryClient) {
  for (const key of [keys.sounds, keys.mixes, keys.scenes, keys.me]) {
    void qc.invalidateQueries({ queryKey: key });
  }
}

// undefined

/** The signed-in user, or `null` when nobody is signed in. */
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async (): Promise<Me | null> => {
      try {
        return await api<Me>('/api/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 30_000,
  });
}

export function usePublicSettings() {
  return useQuery({
    queryKey: keys.publicSettings,
    queryFn: () => api<PublicSettings>('/api/settings/public'),
  });
}

export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api('/api/auth/sign-in/email', { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}

export function useSignUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; email: string; password: string }) =>
      api('/api/auth/sign-up/email', { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/api/auth/sign-out', { method: 'POST', json: {} }),
    onSuccess: () => {
      // Set "nobody" on the live query so the app switches to the sign-in page at once
      // (clearing the whole cache would detach it and leave the board on screen), then
      // drop everything the account had loaded.
      qc.setQueryData(keys.me, null);
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== keys.me[0] });
    },
  });
}

// undefined

export const useSounds = () =>
  useQuery({ queryKey: keys.sounds, queryFn: () => api<Sound[]>('/api/sounds') });
export const useMixes = () =>
  useQuery({ queryKey: keys.mixes, queryFn: () => api<Mix[]>('/api/mixes') });
export const useScenes = () =>
  useQuery({ queryKey: keys.scenes, queryFn: () => api<Scene[]>('/api/scenes') });

export interface UploadSoundInput {
  file: File;
  name?: string;
  defaultMode?: PlayMode;
  sceneIds?: string[];
}

export function useUploadSound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, name, defaultMode, sceneIds }: UploadSoundInput) => {
      // Text fields must come before the file part.
      const form = new FormData();
      if (name) form.append('name', name);
      if (defaultMode) form.append('defaultMode', defaultMode);
      if (sceneIds?.length) form.append('sceneIds', JSON.stringify(sceneIds));
      form.append('file', file);
      return api<Sound>('/api/sounds', { method: 'POST', form });
    },
    onSuccess: () => invalidateLibrary(qc),
  });
}

/**
 * What an editor saves in one go. An image is a separate upload on the server, so it
 * travels as `image` next to the JSON body: a file to set, `null` to leave untouched.
 */
export interface SaveInput<Body> {
  id?: string;
  body: Body;
  image?: File | null;
}

function useSave<Body, Result extends { id: string }>(kind: Kind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body, image }: SaveInput<Body>): Promise<Result> => {
      const saved = id
        ? await api<Result>(`/api/${kind}/${id}`, { method: 'PATCH', json: body })
        : await api<Result>(`/api/${kind}`, { method: 'POST', json: body });
      if (image) {
        const form = new FormData();
        form.append('file', image);
        await api(`/api/${kind}/${saved.id}/image`, { method: 'PUT', form });
      }
      return saved;
    },
    // Also on error: the JSON part may have been saved before the image was refused.
    onSettled: () => invalidateLibrary(qc),
  });
}

export const useSaveSound = () => useSave<UpdateSoundRequest, Sound>('sounds');
export const useSaveMix = () => useSave<CreateMixRequest | UpdateMixRequest, Mix>('mixes');
export const useSaveScene = () =>
  useSave<CreateSceneRequest | UpdateSceneRequest, Scene>('scenes');

export function useDelete(kind: Kind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/${kind}/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateLibrary(qc),
  });
}
