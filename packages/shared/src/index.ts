/**
 * API contract shared by the server and the web app. Vocabulary follows.
 * Dates travel as ISO 8601 strings.
 */
import { z } from 'zod';

// Play modes

export const PLAY_MODES = ['loop', 'oneshot', 'recurring'] as const;
export const playModeSchema = z.enum(PLAY_MODES);
export type PlayMode = z.infer<typeof playModeSchema>;

/** Recurring wait bounds, in seconds (minimum wait 1 s). */
export const MIN_INTERVAL_SEC = 1;
export const MAX_INTERVAL_SEC = 3600;
export const DEFAULT_INTERVAL_MIN_SEC = 20;
export const DEFAULT_INTERVAL_MAX_SEC = 90;
export const DEFAULT_VOLUME = 0.8;

// Limits

export const LIMIT_KEYS = [
  'storageBytes',
  'audioFileBytes',
  'audioDurationSec',
  'imageFileBytes',
  'mixItems',
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export const limitsSchema = z.object({
  storageBytes: z.number().int().min(0),
  audioFileBytes: z.number().int().min(0),
  audioDurationSec: z.number().int().min(0),
  imageFileBytes: z.number().int().min(0),
  mixItems: z.number().int().min(0),
});
export type Limits = z.infer<typeof limitsSchema>;

const MB = 1024 * 1024;
export const DEFAULT_LIMITS: Limits = {
  storageBytes: 500 * MB,
  audioFileBytes: 30 * MB,
  audioDurationSec: 600,
  imageFileBytes: 5 * MB,
  mixItems: 50,
};

/** Hard ceilings no admin setting can exceed (protects the server itself). */
export const MAX_LIMITS: Limits = {
  storageBytes: 1024 * 1024 * MB,
  audioFileBytes: 200 * MB,
  audioDurationSec: 3600,
  imageFileBytes: 20 * MB,
  mixItems: 200,
};

// Common fields

/** A display name: 1 to 100 characters, no control characters. */
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^\u0000-\u001f\u007f]*$/, 'Control characters are not allowed');

export const volumeSchema = z.number().min(0).max(1);
export const intervalSecSchema = z.number().min(MIN_INTERVAL_SEC).max(MAX_INTERVAL_SEC);
const idSchema = z.string().min(1).max(64);
const idListSchema = z.array(idSchema).max(1000);

// Illustrations

export const ICON_SETS = ['tabler', 'material', 'lucide', 'healthicons'] as const;
export type IconSet = (typeof ICON_SETS)[number];

/** `<set>:<slug>`, for example `tabler:door`. */
export const iconIdSchema = z
  .string()
  .max(120)
  .regex(/^(tabler|material|lucide|healthicons):[a-z0-9][a-z0-9-]*$/);

export const illustrationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('icon'), iconId: iconIdSchema, svg: z.string() }),
  z.object({ type: z.literal('image'), url: z.string() }),
]);
export type Illustration = z.infer<typeof illustrationSchema>;

/**
 * What a client may send to set an illustration. A new image is set through the dedicated
 * upload route; `image` reuses an image already shown on an item the user can see, by its
 * key. SVG markup is never accepted from a client.
 */
export const illustrationInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('icon'), iconId: iconIdSchema }),
  z.object({ type: z.literal('image'), imageKey: z.string().uuid() }),
]);
export type IllustrationInput = z.infer<typeof illustrationInputSchema>;

/** An image the user can put on their own items, from `GET /api/images`. */
export const reusableImageSchema = z.object({
  key: z.string(),
  url: z.string(),
});
export type ReusableImage = z.infer<typeof reusableImageSchema>;

// Sharing

/**
 * How the caller relates to a sound or mix: they own it, they added it from the public
 * library, or it is public and not added yet (library listing only).
 */
export const ACCESS_KINDS = ['owner', 'added', 'available'] as const;
export const accessSchema = z.enum(ACCESS_KINDS);
export type Access = z.infer<typeof accessSchema>;

export const DESCRIPTION_MAX = 500;
export const LICENSE_MAX = 200;

/** Optional free text: trimmed, an empty string is stored as no value. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

// Sounds

export const soundSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  license: z.string().nullable(),
  isPublic: z.boolean(),
  access: accessSchema,
  ownerName: z.string(),
  audioUrl: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  durationSec: z.number(),
  defaultMode: playModeSchema,
  defaultVolume: volumeSchema,
  loopStartSec: z.number().nullable(),
  loopEndSec: z.number().nullable(),
  intervalMinSec: z.number(),
  intervalMaxSec: z.number(),
  volumeVariation: z.number(),
  illustration: illustrationSchema,
  sceneIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Sound = z.infer<typeof soundSchema>;

/** Text fields sent next to the file in the multipart upload (all optional). */
export const uploadSoundFieldsSchema = z.object({
  name: nameSchema.optional(),
  defaultMode: playModeSchema.optional(),
  sceneIds: idListSchema.optional(),
});
export type UploadSoundFields = z.infer<typeof uploadSoundFieldsSchema>;

/**
 * A sound's owner may send every field. A user who added the sound from the library may
 * send `defaultVolume` (kept as their own volume) and `sceneIds` (their own scenes) only.
 */
export const updateSoundSchema = z
  .object({
    name: nameSchema,
    description: optionalText(DESCRIPTION_MAX),
    license: optionalText(LICENSE_MAX),
    isPublic: z.boolean(),
    defaultMode: playModeSchema,
    defaultVolume: volumeSchema,
    loopStartSec: z.number().min(0).nullable(),
    loopEndSec: z.number().min(0).nullable(),
    intervalMinSec: intervalSecSchema,
    intervalMaxSec: intervalSecSchema,
    volumeVariation: z.number().min(0).max(1),
    illustration: illustrationInputSchema,
    sceneIds: idListSchema,
  })
  .partial()
  .strict();
export type UpdateSoundRequest = z.infer<typeof updateSoundSchema>;

// Mixes

export const mixItemSchema = z.object({
  id: z.string(),
  soundId: z.string(),
  mode: playModeSchema,
  volume: volumeSchema,
  intervalMinSec: z.number(),
  intervalMaxSec: z.number(),
  volumeVariation: z.number(),
});
export type MixItem = z.infer<typeof mixItemSchema>;

/** One item of a create or update body. Missing settings fall back to the sound's defaults. */
export const mixItemInputSchema = z
  .object({
    soundId: idSchema,
    mode: playModeSchema.optional(),
    volume: volumeSchema.optional(),
    intervalMinSec: intervalSecSchema.optional(),
    intervalMaxSec: intervalSecSchema.optional(),
    volumeVariation: z.number().min(0).max(1).optional(),
  })
  .strict();
export type MixItemInput = z.infer<typeof mixItemInputSchema>;

export const mixSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isPublic: z.boolean(),
  access: accessSchema,
  ownerName: z.string(),
  illustration: illustrationSchema,
  items: z.array(mixItemSchema),
  sceneIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Mix = z.infer<typeof mixSchema>;

const mixBody = z
  .object({
    name: nameSchema,
    description: optionalText(DESCRIPTION_MAX),
    isPublic: z.boolean(),
    illustration: illustrationInputSchema,
    /** Order of the array is the order of the items. A sound may appear once per mix. */
    items: z.array(mixItemInputSchema).max(MAX_LIMITS.mixItems),
    sceneIds: idListSchema,
  })
  .strict();

export const createMixSchema = mixBody.partial().required({ name: true });
export type CreateMixRequest = z.infer<typeof createMixSchema>;

export const updateMixSchema = mixBody.partial();
export type UpdateMixRequest = z.infer<typeof updateMixSchema>;

/**
 * The caller's own volume for sounds of a mix they added from the library, by sound id.
 * Replaces every volume they set before for that mix.
 */
export const mixVolumesSchema = z
  .object({ volumes: z.record(idSchema, volumeSchema) })
  .strict();
export type MixVolumesRequest = z.infer<typeof mixVolumesSchema>;

// Library

/** Every public sound and mix, from any account, with the caller's access to each. */
export const librarySchema = z.object({
  sounds: z.array(soundSchema),
  mixes: z.array(mixSchema),
});
export type Library = z.infer<typeof librarySchema>;

// Scenes

export const sceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number(),
  illustration: illustrationSchema,
  soundIds: z.array(z.string()),
  mixIds: z.array(z.string()),
  createdAt: z.string(),
});
export type Scene = z.infer<typeof sceneSchema>;

const sceneBody = z
  .object({
    name: nameSchema,
    illustration: illustrationInputSchema,
    soundIds: idListSchema,
    mixIds: idListSchema,
  })
  .strict();

export const createSceneSchema = sceneBody.partial().required({ name: true });
export type CreateSceneRequest = z.infer<typeof createSceneSchema>;

export const updateSceneSchema = sceneBody.partial();
export type UpdateSceneRequest = z.infer<typeof updateSceneSchema>;

/** Full list of the caller's scene ids, in the wanted order. */
export const orderScenesSchema = z.object({ ids: idListSchema }).strict();
export type OrderScenesRequest = z.infer<typeof orderScenesSchema>;

// Account

export const ROLES = ['user', 'admin'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const usageSchema = z.object({
  storageBytes: z.number(),
  sounds: z.number(),
  mixes: z.number(),
  scenes: z.number(),
});
export type Usage = z.infer<typeof usageSchema>;

export const meSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  limits: limitsSchema,
  usage: usageSchema,
});
export type Me = z.infer<typeof meSchema>;

/** Deleting your own account requires typing its email. */
export const deleteMeSchema = z.object({ email: z.string().min(1) }).strict();

export const publicSettingsSchema = z.object({ signupsOpen: z.boolean() });
export type PublicSettings = z.infer<typeof publicSettingsSchema>;

// Errors

export const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation',
  'file_too_large',
  'unsupported_type',
  'duration_too_long',
  'quota_exceeded',
  'mix_items_limit',
  'signups_closed',
  'conflict',
  'rate_limited',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    /** Field path to message, present for `validation` errors. */
    fields: z.record(z.string(), z.string()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
