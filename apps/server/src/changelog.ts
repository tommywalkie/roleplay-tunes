/**
 * The release notes: one Markdown file per version and language in `changelog/`
 * (`1.0.5.en.md`, `1.0.5.fr.md`), each opening with a `date: YYYY-MM-DD` front matter. The
 * folder is resolved from the working directory, like `drizzle/`: `apps/server` in
 * development, `/app/server` in the image.
 *
 * Markdown becomes HTML here, sanitized with the same allowlist as the server rules, so the
 * app renders notes and rules the same way and needs no Markdown code of its own.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { marked } from 'marked';
import { compareVersions, LOCALES, type Changelog, type Locale } from '@dnd/shared';
import { db } from './db/index.js';
import { users } from './db/schema.js';
import { sanitizeRules } from './terms.js';

const FILE = /^(\d+\.\d+\.\d+)\.([a-z]{2})\.md$/;
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

interface Entry {
  version: string;
  date: string;
  html: Partial<Record<Locale, string>>;
}

let cache: Entry[] | null = null;

/**
 * Every release, newest first. Read once in production, where the files ship with the
 * image; read again on every call in development, so an edited note shows on reload.
 */
function entries(): Entry[] {
  if (cache && process.env.NODE_ENV === 'production') return cache;
  const dir = resolve('changelog');
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    names = [];
  }
  const byVersion = new Map<string, Entry>();
  for (const name of names) {
    const match = FILE.exec(name);
    if (!match) continue;
    const [, version, locale] = match as unknown as [string, string, Locale];
    if (!LOCALES.includes(locale)) continue;
    const text = readFileSync(join(dir, name), 'utf8');
    const front = FRONT_MATTER.exec(text);
    const date = /^date:\s*(\S+)\s*$/m.exec(front?.[1] ?? '')?.[1] ?? '';
    const body = front ? text.slice(front[0].length) : text;
    const entry = byVersion.get(version) ?? { version, date, html: {} };
    entry.html[locale] = sanitizeRules(marked.parse(body, { async: false }));
    if (!entry.date) entry.date = date;
    byVersion.set(version, entry);
  }
  cache = [...byVersion.values()].sort((a, b) => compareVersions(b.version, a.version));
  return cache;
}

/** The newest version with notes, or null when there are none. */
export function latestVersion(): string | null {
  return entries()[0]?.version ?? null;
}

/** Every release in one language, falling back to English where a translation is missing. */
export function changelog(locale: Locale): Changelog {
  const all = entries();
  return {
    latest: all[0]?.version ?? null,
    releases: all.map(({ version, date, html }) => ({
      version,
      date,
      html: html[locale] ?? html.en ?? '',
    })),
  };
}

/** True when there are notes newer than the last ones this user saw. */
export function changelogUnseen(seen: string | null): boolean {
  const latest = latestVersion();
  return latest !== null && (seen === null || compareVersions(latest, seen) > 0);
}

/** Records that the user has seen every note there is now. */
export function markChangelogSeen(userId: string) {
  const latest = latestVersion();
  if (!latest) return;
  db.update(users).set({ changelogSeenVersion: latest }).where(eq(users.id, userId)).run();
}
