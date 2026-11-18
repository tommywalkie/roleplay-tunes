/**
 * The server rules: one text per language, written by an administrator and shown to
 * everyone as the terms of service.
 *
 * They live in the same key/value table as the sign-up toggle and the default limits
 * (`termsEnabled`, `termsUpdatedAt`, `termsRules.<language>`). The HTML is sanitized on
 * the way in, so what the app renders can only be what the allowlist in `@dnd/shared`
 * permits: the editor offers the same list, and nothing else can reach a database row.
 */
import sanitizeHtml from 'sanitize-html';
import { eq } from 'drizzle-orm';
import {
  LOCALES,
  TERMS_ATTRIBUTES,
  TERMS_SCHEMES,
  TERMS_TAGS,
  localeSchema,
  type Locale,
  type SetTermsRequest,
  type Terms,
  type TermsAdmin,
} from '@dnd/shared';
import { db } from './db/index.js';
import { users } from './db/schema.js';
import { readSetting, writeSetting } from './settings.js';

const ENABLED_KEY = 'termsEnabled';
const UPDATED_KEY = 'termsUpdatedAt';
const RULES_KEY = (locale: Locale) => `termsRules.${locale}`;

/** The allowlist, in the shape the sanitizer wants. Links also get a safe `rel`. */
const SANITIZE = {
  allowedTags: [...TERMS_TAGS],
  // `rel` and `target` are allowed because `transformTags` below fixes their value: an
  // incoming one is overwritten, never kept.
  allowedAttributes: { a: [...(TERMS_ATTRIBUTES as { a: readonly string[] }).a, 'rel', 'target'] },
  allowedSchemes: [...TERMS_SCHEMES],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  transformTags: {
    // The editor's links, and any that slip in otherwise, leave the app rather than
    // replacing it, and never carry a referrer to the target.
    a: (name: string, attribs: Record<string, string>) => ({
      tagName: name,
      attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' },
    }),
  },
} satisfies sanitizeHtml.IOptions;

export function sanitizeRules(html: string): string {
  return sanitizeHtml(html, SANITIZE);
}

export function termsEnabled(): boolean {
  return readSetting(ENABLED_KEY) === 'true';
}

export function termsUpdatedAt(): string | null {
  return readSetting(UPDATED_KEY) ?? null;
}

/** The stored rules of one language, already sanitized when they were saved. */
export function rulesOf(locale: Locale): string {
  return readSetting(RULES_KEY(locale)) ?? '';
}

/** Every language, as the administrator edits them. */
export function adminTerms(): TermsAdmin {
  return {
    enabled: termsEnabled(),
    updatedAt: termsUpdatedAt(),
    // Every language the contract lists, so the record is never partial.
    rules: Object.fromEntries(LOCALES.map((locale) => [locale, rulesOf(locale)])) as Record<
      Locale,
      string
    >,
  };
}

/** One language, as a visitor sees it. */
export function publicTerms(locale: Locale): Terms {
  return { enabled: termsEnabled(), updatedAt: termsUpdatedAt(), html: rulesOf(locale) };
}

/**
 * Saves the toggle and every language the body carries. The version stamp moves only when
 * some rule text really changed, so re-saving an unchanged page does not ask everyone to
 * accept the rules again.
 */
export function saveTerms(body: SetTermsRequest): TermsAdmin {
  writeSetting(ENABLED_KEY, String(body.enabled));
  let changed = false;
  for (const [key, html] of Object.entries(body.rules)) {
    const locale = localeSchema.parse(key);
    const clean = sanitizeRules(html);
    if (clean !== rulesOf(locale)) {
      writeSetting(RULES_KEY(locale), clean);
      changed = true;
    }
  }
  if (changed) writeSetting(UPDATED_KEY, new Date().toISOString());
  return adminTerms();
}

/**
 * Records that the user accepted the rules as they stand now. The stamp is the current
 * version, so a later change shows the rules to them again.
 */
export function acceptTerms(userId: string) {
  const version = termsUpdatedAt();
  db.update(users)
    .set({ termsAcceptedAt: version ? new Date(version) : new Date() })
    .where(eq(users.id, userId))
    .run();
}
