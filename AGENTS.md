# AGENTS.md

Roleplay Tunes: a soundboard for tabletop game masters, made for a tablet or phone at the
table. The GM taps tiles to play ambiance, loops and effects. See `README.md` for the
project layout, setup and deployment.

## Ground rules

- The contract between app and server is `packages/shared/src/index.ts` and the OpenAPI
  spec at `http://localhost:3000/docs/json`. Do not take behavior, layout or copy from
  `docs/` or reference images in the repo.
- The user starts and stops the dev servers. Ask them to run one; do not launch it.
- Temporary scripts and outputs go in `tmp/` at the repo root (gitignored), nowhere else.
- Tests are written by a delegated subagent with precise instructions. If it stops on a
  quota, resume it rather than redo its work.
- `apps/web-v2/src/i18n/en.ts` is the source of text keys; `fr.ts` must mirror it.

## Commands (from the repo root)

| What | Command |
| --- | --- |
| API server (port 3000) | `pnpm dev:server` |
| Web app (port 5173, fixed) | `pnpm dev:web` |
| Tests / type-check / lint / build | `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` |
| Icon picker data | `node scripts/build-icon-libraries.mjs` |
| Brand assets (favicons, social preview) | `node scripts/build-brand-assets.mjs` |

Port 5173 is fixed because the server trusts that origin by default. Vite proxies `/api`
to the server, so the session cookie is same-origin. A blank page after several quick
edits to one file is a stale transform: save again or restart the dev server.

## Behavior that must not regress

**Player.** Pause, Stop all, master volume and one-shot volume are always shown and
enabled, in every state. Stop all with nothing playing does nothing. On phones and
tablets the player is a dock above the tab bar that opens upward over a dimmed, frozen
page; a tap on the dim layer closes it, and the tab bar stays usable.

**Playback rules.**

- One set of layers plays at a time, with one-shots on top.
- Tapping a mix replaces what plays (crossfade). Tapping the playing mix stops it.
- Tapping a loop or random-gaps sound toggles it on top of what plays. If it already plays
  inside a mix, the tap turns it off instead of doubling it.
- A "once" sound fires on every tap. A "once" item in a mix plays once when the mix starts.
- Any tap while paused resumes first: a tap is never silent.
- Removing the last layer stops playback. Signing out stops everything.
- A loop always starts at its beginning.
- Random gaps run from the end of one play to the start of the next, so plays never
  overlap; the first play starts at once.
- Playing a sound in another mode (tile menu) restarts it in that mode, never doubled.
- Stop all also drops "once" sounds still loading.

**Safe areas (iOS).** Screens fill the body, never `100dvh`. Use `var(--safe-bottom)`,
not `env(safe-area-inset-bottom)`, because the installed iPhone app has a shortened
viewport. Entrance animations use fill mode `backwards`: on iOS Safari an element that
keeps its last keyframe paints over the fixed player and dialogs.

**Dialogs stack.** A dialog opened from another hides the first, which keeps its state
and comes back on close. The dim layer stays for the whole stack.

**Lists.** The search field sticks to the top of the scrolling area. Search matches the
name and the synonyms the user sees. Sorting (by name either way, or by date added) and
any new search, filter or tab return to page 1. Pages hold 20 items.

**Synonyms and categories belong to each user.** A user tags any item they own or added.
They see the owner's synonyms (not removable) plus their own, and only their own
categories.

**Public items.** Sounds and mixes can be public and are then listed in the Library.
An added item keeps its owner: only the owner edits it; others set their own volume,
scenes, tags, and can remove it from their library.

**Auth.** Sessions are Better Auth cookies. Any 401 means "signed out" and shows the
sign-in page. On sign-out, set the `me` query to `null`; never clear the whole query cache.

**HTML from the server.** Server rules and release notes arrive already sanitized by the
server. The app has no sanitizer of its own; icon SVG is the only other HTML rendered.

**Server rules.** When the version on record is not the current one, the rules dialog
blocks the board and can only be accepted or answered by signing out. Sign-up requires
reading the rules to the end; switching language resets that.

**Release notes.** One Markdown file per version and language in
`apps/server/changelog/` (`1.0.6.en.md`, `1.0.6.fr.md`), starting with `date: YYYY-MM-DD`.
A new version needs both files and the same version in the root, web and server
`package.json`. Each user sees new notes once, after the server rules.

**Language belongs to the browser**, not the account, and survives a reload.

## Design direction

A mixing desk on a dim game table: steady, tactile, low-light.

- One warm, very low-saturation dark neutral ramp for every surface, three text roles,
  hairline borders.
- One accent, lamp amber, reserved for "this is making sound right now". Not for buttons.
- One off-white primary action per view.
- Instrument Sans for the interface; Geist Mono only for bare numbers; Cinzel only for the
  product name, never for headings, labels or body.
- Weights 400 and 500. Sentence case. No exclamation marks, no trailing periods on labels.
- 4px spacing grid; 44px touch targets; radii 8 to 10 controls, 14 to 16 cards, 20 dialogs.
- Motion: one easing, color/opacity/transform only, no looping animation except spinners
  and one-shot progress.
- Interface icons: lucide at 18px, stroke 1.5, in the color of their text.

## Server caveats

- Route schemas are documentation only: handlers validate with the zod schemas from
  `@dnd/shared`. Response schemas still shape output, so loose objects must carry
  `additionalProperties: true` or their contents are stripped.
- An admin's password reset link points to `<PUBLIC_URL>/reset-password?token=…`.
