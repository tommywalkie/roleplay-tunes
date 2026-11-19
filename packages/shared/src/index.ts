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

export const ICON_SETS = ['tabler', 'material', 'lucide', 'healthicons', 'twemoji'] as const;
export type IconSet = (typeof ICON_SETS)[number];

/** `<set>:<slug>`, for example `tabler:door`. */
export const iconIdSchema = z
  .string()
  .max(120)
  .regex(/^(tabler|material|lucide|healthicons|twemoji):[a-z0-9][a-z0-9-]*$/);

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

// Synonyms and categories

/**
 * Other words for an item, used by search. Each user keeps their own: on an item they see
 * the owner's and their own, and remove only their own. The same text twice on one item
 * is kept once; an exact match counts as the same synonym.
 */
export const SYNONYM_MAX = 40;
export const SYNONYMS_PER_ITEM = 30;
export const synonymSchema = z
  .string()
  .trim()
  .min(1)
  .max(SYNONYM_MAX)
  .regex(/^[^\u0000-\u001f\u007f]*$/, 'Control characters are not allowed');
export const synonymsSchema = z.array(synonymSchema).max(SYNONYMS_PER_ITEM);

/** A synonym on an item, as the caller sees it. `mine`: the caller added it and may remove it. */
export const itemSynonymSchema = z.object({ label: z.string(), mine: z.boolean() });
export type ItemSynonym = z.infer<typeof itemSynonymSchema>;

/**
 * A user's own label for sorting their items. Names are unique per user (exact text).
 * The text color is not stored: clients derive it from the background.
 */
export const CATEGORY_NAME_MAX = 40;
export const CATEGORIES_PER_USER = 100;
export const categoryColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A color such as #4a7c59');

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  icon: z.object({ iconId: z.string(), svg: z.string() }).nullable(),
  createdAt: z.string(),
});
export type Category = z.infer<typeof categorySchema>;

const categoryBody = z
  .object({
    name: nameSchema.pipe(z.string().max(CATEGORY_NAME_MAX)),
    color: categoryColorSchema,
    iconId: iconIdSchema.nullable(),
  })
  .strict();
export const createCategorySchema = categoryBody.partial({ iconId: true });
export type CreateCategoryRequest = z.infer<typeof createCategorySchema>;
export const updateCategorySchema = categoryBody.partial();
export type UpdateCategoryRequest = z.infer<typeof updateCategorySchema>;

/** Fields every sound, mix and scene response carries for the caller. */
const taggedFields = {
  synonyms: z.array(itemSynonymSchema),
  /** The caller's own categories on the item. */
  categoryIds: z.array(z.string()),
};

/**
 * Fields every user who has the item may send, owner or not: their own synonyms and
 * categories on it, each list replacing what they had set before.
 */
const taggingFields = {
  synonyms: synonymsSchema,
  categoryIds: idListSchema,
};

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
  ...taggedFields,
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
 * send `defaultVolume` (kept as their own volume), `sceneIds` (their own scenes),
 * `synonyms` and `categoryIds` (their own) only.
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
    ...taggingFields,
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
  ...taggedFields,
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
    ...taggingFields,
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
  ...taggedFields,
  createdAt: z.string(),
});
export type Scene = z.infer<typeof sceneSchema>;

const sceneBody = z
  .object({
    name: nameSchema,
    illustration: illustrationInputSchema,
    soundIds: idListSchema,
    mixIds: idListSchema,
    ...taggingFields,
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
  /** When the user last accepted the server rules. Null while they never did. */
  termsAcceptedAt: z.string().nullable(),
  /** The server has release notes newer than the last ones this user saw. */
  changelogUnseen: z.boolean(),
});
export type Me = z.infer<typeof meSchema>;

/** One release of the app: its notes in one language, as sanitized HTML. */
export const releaseSchema = z.object({
  /** `major.minor.patch`, as the manifests write it. */
  version: z.string(),
  /** `YYYY-MM-DD`, or empty when the file gives none. */
  date: z.string(),
  html: z.string(),
});
export type Release = z.infer<typeof releaseSchema>;

/** Every release, newest first. */
export const changelogSchema = z.object({
  latest: z.string().nullable(),
  releases: z.array(releaseSchema),
});
export type Changelog = z.infer<typeof changelogSchema>;

/** Orders two `major.minor.patch` versions: negative when `a` comes first. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Deleting your own account requires typing its email. */
export const deleteMeSchema = z.object({ email: z.string().min(1) }).strict();

/** What a user may change about their own account: the name others see. */
export const updateMeSchema = z.object({ name: nameSchema }).strict();
export type UpdateMeRequest = z.infer<typeof updateMeSchema>;

export const publicSettingsSchema = z.object({ signupsOpen: z.boolean() });
export type PublicSettings = z.infer<typeof publicSettingsSchema>;

// Locales and terms of service

/** The languages the app speaks, and the ones an administrator writes the rules in. */
export const LOCALES = ['en', 'fr'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = (typeof LOCALES)[number];

/**
 * What the server rules may contain. The editor's toolbar and the server's sanitizer both
 * read these lists, so one place decides what is possible: add a tag here and it becomes
 * an editable, storable and renderable format; remove it and the sanitizer drops it from
 * anything saved after. `href` is the only attribute kept, on links only.
 */
export const TERMS_TAGS = [
  'p',
  'h2',
  'h3',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'u',
  's',
  'a',
  'br',
] as const;
export const TERMS_ATTRIBUTES = { a: ['href'] } as const;
export const TERMS_SCHEMES = ['http', 'https', 'mailto'] as const;

/** Sanitized HTML of one language, held in one settings row. */
export const TERMS_RULES_MAX = 20_000;
export const termsRulesSchema = z.record(localeSchema, z.string().max(TERMS_RULES_MAX));

/** The rules as an administrator edits them: every language at once. */
export const termsAdminSchema = z.object({
  enabled: z.boolean(),
  updatedAt: z.string().nullable(),
  rules: termsRulesSchema,
});
export type TermsAdmin = z.infer<typeof termsAdminSchema>;

/** The rules as one visitor sees them: the sanitized text of the language they asked for. */
export const termsSchema = z.object({
  enabled: z.boolean(),
  updatedAt: z.string().nullable(),
  html: z.string(),
});
export type Terms = z.infer<typeof termsSchema>;

/**
 * Draft rules to run through the sanitizer without saving, so the admin's preview shows
 * what readers would get rather than what was typed.
 */
export const termsPreviewSchema = z
  .object({ locale: localeSchema, html: z.string().max(TERMS_RULES_MAX) })
  .strict();
export type TermsPreviewRequest = z.infer<typeof termsPreviewSchema>;

/** What an administrator saves. A language left out keeps what it had. */
export const setTermsSchema = z.object({ enabled: z.boolean(), rules: termsRulesSchema }).strict();
export type SetTermsRequest = z.infer<typeof setTermsSchema>;

/**
 * True when the rules stand between this user and the app: they are on, they say something,
 * and the acceptance on record is not for the version they now stand in. `acceptedAt` is
 * the user's stamp, null while they never accepted one — never equal to any version.
 */
export function termsAwait(
  terms: Pick<Terms, 'enabled' | 'updatedAt' | 'html'>,
  acceptedAt: string | null | undefined,
): boolean {
  return terms.enabled && terms.html !== '' && acceptedAt !== terms.updatedAt;
}

// Contact

export const CONTACT_NAME_MAX = 100;
export const CONTACT_EMAIL_MAX = 254;
export const CONTACT_MESSAGE_MAX = 5000;

/** A message left through the contact form; kept by the server in `local` mode. */
export const contactMessageSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  message: z.string(),
  createdAt: z.string(),
  /** When an administrator marked it read. Null while it is new. */
  readAt: z.string().nullable(),
});
export type ContactMessage = z.infer<typeof contactMessageSchema>;

/**
 * What the contact form sends in `local` mode. `_honeypot` is the bot trap: a real visitor
 * leaves it empty, and the server quietly drops a message that fills it.
 */
export const contactSubmissionSchema = z
  .object({
    name: nameSchema,
    email: z.string().trim().min(1).max(CONTACT_EMAIL_MAX).pipe(z.email()),
    message: z.string().trim().min(1).max(CONTACT_MESSAGE_MAX),
    _honeypot: z.string().max(200).default(''),
  })
  .strict();
export type ContactSubmission = z.infer<typeof contactSubmissionSchema>;

/** An administrator marks a message read or unread. */
export const setContactReadSchema = z.object({ read: z.boolean() }).strict();
export type SetContactReadRequest = z.infer<typeof setContactReadSchema>;

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
