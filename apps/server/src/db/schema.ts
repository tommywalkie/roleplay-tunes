/**
 * Data model. Every sound, mix and scene belongs to exactly one user; public sounds and
 * mixes can also be added to the library of other users.
 */
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

// Auth tables. Field names match Better Auth's core schema and its admin plugin.

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique().notNull(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull(),
  image: text('image'),
  createdAt: timestamp('createdAt').notNull(),
  updatedAt: timestamp('updatedAt').notNull(),
  // Admin plugin. `banned` is what the product calls "disabled".
  role: text('role').notNull().default('user'),
  banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
  banReason: text('banReason'),
  banExpires: timestamp('banExpires'),
  // Product fields.
  lastActiveAt: timestamp('lastActiveAt'),
  // Per-user limit overrides. Null means "use the server default".
  limitStorageBytes: integer('limitStorageBytes'),
  limitAudioFileBytes: integer('limitAudioFileBytes'),
  limitAudioDurationSec: integer('limitAudioDurationSec'),
  limitImageFileBytes: integer('limitImageFileBytes'),
  limitMixItems: integer('limitMixItems'),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expiresAt').notNull(),
    token: text('token').unique().notNull(),
    createdAt: timestamp('createdAt').notNull(),
    updatedAt: timestamp('updatedAt').notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonatedBy'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('createdAt').notNull(),
    updatedAt: timestamp('updatedAt').notNull(),
  },
  (t) => [index('accounts_user_idx').on(t.userId)],
);

export const verifications = sqliteTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expiresAt').notNull(),
    createdAt: timestamp('createdAt').notNull(),
    updatedAt: timestamp('updatedAt').notNull(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

// Domain tables

/** Illustration columns shared by sounds, mixes and scenes. */
const illustrationColumns = {
  illustrationType: text('illustrationType', { enum: ['none', 'icon', 'image'] })
    .notNull()
    .default('none'),
  iconId: text('iconId'),
  iconSvg: text('iconSvg'),
  imageKey: text('imageKey'),
  imageBytes: integer('imageBytes').notNull().default(0),
};

const PLAY_MODES = ['loop', 'oneshot', 'recurring'] as const;

export const sounds = sqliteTable(
  'sounds',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    license: text('license'),
    isPublic: integer('isPublic', { mode: 'boolean' }).notNull().default(false),
    fileKey: text('fileKey').notNull(),
    mimeType: text('mimeType').notNull(),
    sizeBytes: integer('sizeBytes').notNull(),
    durationSec: real('durationSec').notNull(),
    defaultMode: text('defaultMode', { enum: PLAY_MODES }).notNull(),
    defaultVolume: real('defaultVolume').notNull(),
    loopStartSec: real('loopStartSec'),
    loopEndSec: real('loopEndSec'),
    intervalMinSec: real('intervalMinSec').notNull(),
    intervalMaxSec: real('intervalMaxSec').notNull(),
    volumeVariation: real('volumeVariation').notNull().default(0),
    ...illustrationColumns,
    createdAt: timestamp('createdAt').notNull(),
    updatedAt: timestamp('updatedAt').notNull(),
  },
  (t) => [index('sounds_owner_idx').on(t.ownerId), index('sounds_public_idx').on(t.isPublic)],
);

export const mixes = sqliteTable(
  'mixes',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    isPublic: integer('isPublic', { mode: 'boolean' }).notNull().default(false),
    ...illustrationColumns,
    createdAt: timestamp('createdAt').notNull(),
    updatedAt: timestamp('updatedAt').notNull(),
  },
  (t) => [index('mixes_owner_idx').on(t.ownerId), index('mixes_public_idx').on(t.isPublic)],
);

export const mixItems = sqliteTable(
  'mix_items',
  {
    id: text('id').primaryKey(),
    mixId: text('mixId')
      .notNull()
      .references(() => mixes.id, { onDelete: 'cascade' }),
    soundId: text('soundId')
      .notNull()
      .references(() => sounds.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    mode: text('mode', { enum: PLAY_MODES }).notNull(),
    volume: real('volume').notNull(),
    intervalMinSec: real('intervalMinSec').notNull(),
    intervalMaxSec: real('intervalMaxSec').notNull(),
    volumeVariation: real('volumeVariation').notNull().default(0),
  },
  (t) => [
    uniqueIndex('mix_items_position_idx').on(t.mixId, t.position),
    uniqueIndex('mix_items_sound_idx').on(t.mixId, t.soundId),
    index('mix_items_by_sound_idx').on(t.soundId),
  ],
);

export const scenes = sqliteTable(
  'scenes',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    ...illustrationColumns,
    createdAt: timestamp('createdAt').notNull(),
  },
  (t) => [index('scenes_owner_idx').on(t.ownerId)],
);

export const sceneSounds = sqliteTable(
  'scene_sounds',
  {
    sceneId: text('sceneId')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    soundId: text('soundId')
      .notNull()
      .references(() => sounds.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.sceneId, t.soundId] }),
    index('scene_sounds_by_sound_idx').on(t.soundId),
  ],
);

export const sceneMixes = sqliteTable(
  'scene_mixes',
  {
    sceneId: text('sceneId')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    mixId: text('mixId')
      .notNull()
      .references(() => mixes.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.sceneId, t.mixId] }),
    index('scene_mixes_by_mix_idx').on(t.mixId),
  ],
);

/**
 * Uploaded illustration files. Several items, of several accounts, may show the same
 * image: the file stays while any item uses it, and counts against the storage of the
 * account that uploaded it.
 */
export const images = sqliteTable(
  'images',
  {
    key: text('key').primaryKey(),
    ownerId: text('ownerId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bytes: integer('bytes').notNull(),
    createdAt: timestamp('createdAt').notNull(),
  },
  (t) => [index('images_owner_idx').on(t.ownerId)],
);

/** Public sounds a user added to their own library. */
export const librarySounds = sqliteTable(
  'library_sounds',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    soundId: text('soundId')
      .notNull()
      .references(() => sounds.id, { onDelete: 'cascade' }),
    createdAt: timestamp('createdAt').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.soundId] }),
    index('library_sounds_by_sound_idx').on(t.soundId),
  ],
);

/** Public mixes a user added to their own library. */
export const libraryMixes = sqliteTable(
  'library_mixes',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mixId: text('mixId')
      .notNull()
      .references(() => mixes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('createdAt').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.mixId] }),
    index('library_mixes_by_mix_idx').on(t.mixId),
  ],
);

/** A user's own volume for a sound they did not upload. */
export const soundVolumes = sqliteTable(
  'sound_volumes',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    soundId: text('soundId')
      .notNull()
      .references(() => sounds.id, { onDelete: 'cascade' }),
    volume: real('volume').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.soundId] }),
    index('sound_volumes_by_sound_idx').on(t.soundId),
  ],
);

/**
 * A user's own volume for one sound of a mix they did not create. Keyed by sound rather
 * than by mix item, since every edit of the mix recreates its items.
 */
export const mixVolumes = sqliteTable(
  'mix_volumes',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mixId: text('mixId')
      .notNull()
      .references(() => mixes.id, { onDelete: 'cascade' }),
    soundId: text('soundId')
      .notNull()
      .references(() => sounds.id, { onDelete: 'cascade' }),
    volume: real('volume').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.mixId, t.soundId] }),
    index('mix_volumes_by_mix_idx').on(t.mixId),
    index('mix_volumes_by_sound_idx').on(t.soundId),
  ],
);

/** Server-wide settings: `signupsOpen`, and `limit.<key>` for each default limit. */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** One measurement per day, for the admin disk usage chart. */
export const storageSnapshots = sqliteTable('storage_snapshots', {
  day: text('day').primaryKey(),
  audioBytes: integer('audioBytes').notNull(),
  imageBytes: integer('imageBytes').notNull(),
  databaseBytes: integer('databaseBytes').notNull(),
  freeBytes: integer('freeBytes').notNull(),
});
