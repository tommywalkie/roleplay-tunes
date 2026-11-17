/**
 * Server-wide settings stored in the database, and the limits that apply to one user
 *: a per-user override wins over the server default.
 */
import { eq, sql } from 'drizzle-orm';
import { DEFAULT_LIMITS, LIMIT_KEYS, type LimitKey, type Limits, type Usage } from '@dnd/shared';
import { db } from './db/index.js';
import { appSettings, mixes, scenes, sounds, users } from './db/schema.js';

type UserRow = typeof users.$inferSelect;

const OVERRIDE_COLUMN = {
  storageBytes: 'limitStorageBytes',
  audioFileBytes: 'limitAudioFileBytes',
  audioDurationSec: 'limitAudioDurationSec',
  imageFileBytes: 'limitImageFileBytes',
  mixItems: 'limitMixItems',
} as const satisfies Record<LimitKey, keyof UserRow>;

export function overrideColumn(key: LimitKey) {
  return OVERRIDE_COLUMN[key];
}

function readSetting(key: string): string | undefined {
  return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value;
}

function writeSetting(key: string, value: string) {
  db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run();
}

export function signupsOpen(): boolean {
  return readSetting('signupsOpen') !== 'false';
}

export function setSignupsOpen(open: boolean) {
  writeSetting('signupsOpen', String(open));
}

/** Limits applied to accounts that have no override. */
export function defaultLimits(): Limits {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of LIMIT_KEYS) {
    const stored = Number(readSetting(`limit.${key}`));
    if (Number.isFinite(stored) && stored >= 0) limits[key] = stored;
  }
  return limits;
}

export function setDefaultLimits(values: Partial<Limits>) {
  for (const key of LIMIT_KEYS) {
    const value = values[key];
    if (value !== undefined) writeSetting(`limit.${key}`, String(value));
  }
}

/** The user's own overrides only (null where the default applies). */
export function limitOverrides(user: UserRow): Record<LimitKey, number | null> {
  return Object.fromEntries(LIMIT_KEYS.map((key) => [key, user[OVERRIDE_COLUMN[key]]])) as Record<
    LimitKey,
    number | null
  >;
}

export function effectiveLimits(user: UserRow): Limits {
  const limits = defaultLimits();
  for (const key of LIMIT_KEYS) {
    const override = user[OVERRIDE_COLUMN[key]];
    if (override !== null && override !== undefined) limits[key] = override;
  }
  return limits;
}

/** Bytes of audio and images stored for one user. */
export function storageUsed(userId: string): number {
  const bytes = (table: typeof sounds | typeof mixes | typeof scenes, withAudio: boolean) =>
    db
      .select({
        total: withAudio
          ? sql<number>`coalesce(sum(${sounds.sizeBytes} + ${sounds.imageBytes}), 0)`
          : sql<number>`coalesce(sum(${table.imageBytes}), 0)`,
      })
      .from(table)
      .where(eq(table.ownerId, userId))
      .get()?.total ?? 0;
  return bytes(sounds, true) + bytes(mixes, false) + bytes(scenes, false);
}

export function usageOf(userId: string): Usage {
  const count = (table: typeof sounds | typeof mixes | typeof scenes) =>
    db
      .select({ n: sql<number>`count(*)` })
      .from(table)
      .where(eq(table.ownerId, userId))
      .get()?.n ?? 0;
  return {
    storageBytes: storageUsed(userId),
    sounds: count(sounds),
    mixes: count(mixes),
    scenes: count(scenes),
  };
}
