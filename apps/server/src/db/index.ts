import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateDb } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from '../config.js';
import * as schema from './schema.js';

if (!config.isTest) mkdirSync(config.dataDir, { recursive: true });

export const sqlite = new Database(config.databasePath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });

let ready: Promise<void> | undefined;

/**
 * Creates or updates the tables straight from the schema definition.
 */
export function ensureSchema(): Promise<void> {
  ready ??= (async () => {
    const { pushSQLiteSchema } = await import('drizzle-kit/api');
    // drizzle-kit types the instance as a LibSQL database; better-sqlite3 works the same way.
    const { statementsToExecute } = await pushSQLiteSchema(schema, db as never);
    // Run the statements ourselves: drizzle-kit's own apply() assumes the LibSQL driver.
    for (const statement of statementsToExecute) sqlite.exec(statement);
    registerExistingImages();
  })();
  return ready;
}

/**
 * Records in `images` every uploaded image that items reference but that has no row yet,
 * owned by the account of the item. Databases created before the `images` table only
 * kept the image on the item itself. Runs at every start and does nothing once done.
 */
export function registerExistingImages() {
  for (const table of ['sounds', 'mixes', 'scenes']) {
    sqlite.exec(
      `INSERT OR IGNORE INTO images (key, ownerId, bytes, createdAt)
       SELECT imageKey, ownerId, imageBytes, createdAt FROM ${table}
       WHERE imageKey IS NOT NULL`,
    );
  }
}

/**
 * Applies the journal-based migrations in `drizzle/`.
 */
export function migrate(): Promise<void> {
  ready ??= Promise.resolve().then(() => {
    // Relative to the working directory, like `DATA_DIR`: dev, tests and the bundled
    // `dist/index.js` are all run from the `apps/server` folder.
    migrateDb(db, { migrationsFolder: resolve('drizzle') });
    registerExistingImages();
  });
  return ready;
}
