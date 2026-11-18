import type {
  Category,
  CreateCategoryRequest,
  CreateMixRequest,
  UpdateCategoryRequest,
  CreateSceneRequest,
  Library,
  Locale,
  Me,
  Mix,
  PlayMode,
  PublicSettings,
  ReusableImage,
  Scene,
  Sound,
  Terms,
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
  library: ['library'] as const,
  images: ['images'] as const,
  synonyms: ['synonyms'] as const,
  categories: ['categories'] as const,
  terms: ['terms'] as const,
};

export type Kind = 'sounds' | 'mixes' | 'scenes';

/**
 * Sounds, mixes and scenes reference each other, the public library shows them, and
 * every file counts against storage.
 */
function invalidateLibrary(qc: QueryClient) {
  for (const key of [
    keys.sounds,
    keys.mixes,
    keys.scenes,
    keys.me,
    keys.library,
    keys.images,
    keys.synonyms,
  ]) {
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

/** The server rules in one language, sanitized on the server. Readable signed out. */
export function useTerms(locale: Locale, enabled = true) {
  return useQuery({
    queryKey: [...keys.terms, locale],
    queryFn: () => api<Terms>(`/api/terms/${locale}`),
    staleTime: Infinity,
    enabled,
  });
}

/** Records that the user accepted the rules as they stand now. */
export function useAcceptTerms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/api/terms/accept', { method: 'POST', json: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
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

/** Every synonym the user put on an item, for suggestions while typing a new one. */
export const useSynonyms = () =>
  useQuery({ queryKey: keys.synonyms, queryFn: () => api<string[]>('/api/synonyms') });

/** The user's own categories, sorted by name. */
export const useCategories = () =>
  useQuery({ queryKey: keys.categories, queryFn: () => api<Category[]>('/api/categories') });

export function useSaveCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id?: string;
      body: CreateCategoryRequest | UpdateCategoryRequest;
    }) =>
      id
        ? api<Category>(`/api/categories/${id}`, { method: 'PATCH', json: body })
        : api<Category>('/api/categories', { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.categories }),
  });
}

/** Deleting a category takes it off every item, so the item lists change too. */
export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.categories });
      invalidateLibrary(qc);
    },
  });
}

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
export const useSaveScene = () => useSave<CreateSceneRequest | UpdateSceneRequest, Scene>('scenes');

export function useDelete(kind: Kind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/${kind}/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateLibrary(qc),
  });
}

/** Every public sound and mix, with the caller's access to each. */
export const useLibrary = () =>
  useQuery({ queryKey: keys.library, queryFn: () => api<Library>('/api/library') });

/** Images the user can put on their own items. */
export const useReusableImages = (enabled: boolean) =>
  useQuery({
    queryKey: keys.images,
    queryFn: () => api<ReusableImage[]>('/api/images'),
    enabled,
  });

/** Adds a public sound or mix of another account to the user's library, or removes it. */
export function useLibraryEntry(kind: 'sounds' | 'mixes') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, add }: { id: string; add: boolean }) =>
      api(`/api/library/${kind}/${id}`, { method: add ? 'PUT' : 'DELETE' }),
    onSettled: () => invalidateLibrary(qc),
  });
}

/** The user's own volumes for the sounds of a mix they added. */
export function useSetMixVolumes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, volumes }: { id: string; volumes: Record<string, number> }) =>
      api<Mix>(`/api/mixes/${id}/volumes`, { method: 'PUT', json: { volumes } }),
    onSettled: () => invalidateLibrary(qc),
  });
}
