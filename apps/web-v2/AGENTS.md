# AGENTS.md — apps/web-v2

The web client of the soundboard: a game master taps tiles on a tablet or phone to play
ambiance, loops and effects. This file is the working guide for anyone (human or agent)
changing this app. Keep it current: update the "Status" section in the same change that
adds or removes a feature.

## Ground rules for this app

- This client was built from `packages/` and the live API only. The previous client
  (`apps/web`) has been deleted. Do not take behavior, layout or copy from `docs/` or from
  reference images in the repo. The contract is `packages/shared/src/index.ts` (used by
  both the server and this app) and the OpenAPI spec at `http://localhost:3000/docs/json`.
- The user starts and stops the dev server themselves. Ask them to run it; do not launch it.
- Temporary scripts and outputs go in `tmp/` at the repo root (gitignored), nowhere else.
- Tests are written by a delegated subagent with precise instructions; if it stops on a
  quota, resume it rather than redoing its work.

## Run

| What | Command (from the repo root) |
| --- | --- |
| API server (port 3000) | `pnpm dev:server` |
| This app (port 5173, fixed) | `pnpm --filter @dnd/web-v2 dev` |
| Tests | `pnpm --filter @dnd/web-v2 test` |
| Type-check | `pnpm --filter @dnd/web-v2 typecheck` |
| Lint | `pnpm exec eslint apps/web-v2/src` |
| Build | `pnpm --filter @dnd/web-v2 build` |
| Icon manifests | `node scripts/build-icon-libraries.mjs` (writes `apps/web-v2/public/icons`) |
| Brand assets | `node scripts/build-brand-assets.mjs` (writes favicons and the social preview in `apps/web-v2/public`) |
| Screenshots, mocked API | `node tmp/web-v2-shots/shoot.mjs` and `shoot-admin.mjs` (dev server must be running) |
| Docker image (server + this app) | `docker build -t roleplay-tunes .` |

If the dev server shows a blank page after several quick edits to one file, it served a
stale transform: save the file once more or restart the dev server.

## Deployment

`Dockerfile` at the repo root builds one image (`node:22-bookworm-slim`): icon manifests,
this app and the server are built, then the server serves this app from `WEB_DIST=/app/web`
and reads icons from `/app/web/icons`. Data lives in the `/data` volume. Required at run
time: `AUTH_SECRET` (32+ characters) and `PUBLIC_URL`; see `.env.example` for the rest.
The image keeps dev dependencies because the server still creates its tables through
drizzle-kit at start; switch the `pnpm deploy` line to `--prod` once it uses migrations.

The port is fixed at 5173 because the server trusts that origin by default
(`TRUSTED_ORIGINS`). Vite proxies `/api` to `http://localhost:3000`, so the session cookie
is same-origin. `public/icons/*.json` is generated and required by the icon picker.

## Stack

React 19, Vite, TypeScript (strict), Tailwind v4 (tokens in `src/index.css`, no config
file), TanStack Query, React Router, lucide-react for interface icons, vitest + React
Testing Library. Workspace packages: `@dnd/shared` (types, limits, zod schemas) and
`@dnd/audio-engine` (Web Audio engine). Tiptap (ProseMirror) backs the server-rules field
on the Admin page only, behind a lazy import so it stays out of the board's bundle.

## Layout of `src/`

| Path | Role |
| --- | --- |
| `api/client.ts` | `api()` fetch wrapper and `ApiError`. Reads both error shapes: the API's `{ error: { code } }` and Better Auth's `{ code }` |
| `api/hooks.ts` | Every query and mutation. Saving an item = JSON request, then an optional image upload |
| `audio/player.tsx` | The board's playback rules on top of the engine (`createPlayer`), and `PlayerProvider` |
| `player/PlayerPanel.tsx` | The always-visible player: column on desktop (`lg`, 1024px), dock on phones and tablets |
| `layout/AppShell.tsx` | Navigation rail or tab bar, page outlet, player |
| `board/tiles.tsx` | `SoundTile`, `MixTile`, `SceneTile`: tiles wired to the player |
| `components/` | `Tile`, `Page`, `Dialog`, `Menu`, `InstallDialog`, `TermsDialog`, `PickList`, `IllustrationField` (icon picker, image upload), `StorageMeter`, `Toasts`, `ui.tsx` primitives |
| `editors/` | Sound, mix and scene editors, upload dialog, shared footer, `LicenseField`, `RulesEditor`/`RulesCard` (server rules, lazy) |
| `layout/viewport.ts` | Measures the installed iPhone app's shortened viewport (see Safe areas) |
| `pages/` | Login, Scenes, Scene, Mixes, Sounds, Library, Categories, Profile, Settings, Admin, ResetPassword |
| `api/admin.ts` | Admin queries and mutations, password reset |
| `i18n/` | `en.ts` is the source of keys, `fr.ts` must mirror it (a test checks this) |
| `test/` | `fixtures.ts`: `makeSound`, `makeMix`, `makeMe`, `makeFakeEngine` |

## Behavior that must not regress

**Player controls never move or disappear.** Pause, Stop all, master volume and one-shot
volume are rendered and enabled in every state (idle, playing, paused). Stop all with
nothing playing is a harmless no-op. `PlayerPanel.test.tsx` locks this in.

**Playback rules** (`audio/player.tsx`, covered by `player.test.ts`):

- The engine plays one set of layers at a time, plus one-shots on top.
- Tapping a mix replaces what plays (crossfade). Tapping the playing mix stops it.
- Tapping a loop or random-gaps sound toggles it on top of what plays. If that sound
  already plays as part of a mix, the tap turns it off instead of doubling it.
- Tapping a "once" sound fires it on every tap.
- A "once" item inside a mix is played one time when the mix starts.
- Any tap while paused resumes first, so a tap is never silent.
- Removing the last layer stops the engine. Signing out stops everything.
- A loop always starts at its beginning (`randomStart: false`).
- Random pauses run from the end of one play to the start of the next, so plays of one
  sound never overlap; the first play starts at once (engine, `graph/layer.ts`).
- The sound tile menu plays a sound in any mode (`playSoundAs`), whatever its own. If the
  sound already plays, alone or in a mix, it starts over in the new way, never doubled.
- Stop all also drops "once" sounds still loading, so none starts after it.

**Safe areas.** The status bar is `black-translucent`: the body is padded by the top and
side insets, and screens fill the body with `h-full`, never `100dvh`. Use
`var(--safe-bottom)` instead of `env(safe-area-inset-bottom)`: `layout/viewport.ts` takes
off the part of the inset that an installed iPhone app's shortened viewport already covers.
Entrance animations use fill mode `backwards`, and `main` is its own stacking context:
on iOS Safari, a page element that keeps its last keyframe painted over the fixed player
and dialogs.

**Dialogs stack.** A `Dialog` opened from inside another hides the first's panel, which
stays mounted with its form state; closing it shows the first again. The first dialog's
dim layer stays for the whole stack, so the page never flashes between them. Delete
confirmations (`EditorFooter`), the icon and image pickers (`IllustrationField`) and the
lists of sounds and mixes to choose (`PickField`) open this way, to keep editors short.

**Search stays on screen.** On list pages the search field sticks to the top of the
scrolling area (`Page`); the title scrolls away. Search matches an item's name and the
synonyms the user sees on it (`searchText`), on pages, in the Library and in the
"Choose" lists.

**Synonyms and categories are per user.** Each user puts their own on any item they own
or added (`TagFields` in every editor, owner or not, sends `synonyms` and `categoryIds`).
On an item they see the owner's synonyms (no remove button) and their own; only their
own categories. A duplicate is the exact same text. A synonym no item carries is deleted
by the server; a category stays until its owner deletes it from its dialog. Categories are
created, changed and deleted through `CategoryDialog` only: from the editor's field, or
from the Categories page (`/categories`, reached from Profile), which lists them as rows
that open that dialog and has a "New category" action; the list pages filter by them
(`CategoryFilter`: items carrying any of the chosen ones). A category's text color is
derived from its background (`textOn`: white or dark slate).

**Auth.** Sessions are cookies from Better Auth (`/api/auth/sign-in/email`,
`/sign-up/email`, `/sign-out`). `useMe()` returns `null` on 401 and `App.tsx` shows the
sign-in page. Any 401 on any call sets "nobody" (see `main.tsx`). On sign-out, set the
`me` query to `null` on the live query; never `queryClient.clear()`, which detaches the
observer and leaves the board on screen.

**Illustrations.** The server returns `{ type: 'none' | 'icon' | 'image' }`. Icon SVG
markup comes from the server's own copy of the icon sets and is rendered as HTML; never
render markup from any other source that way. A client sends an icon by `iconId` only;
an image is a separate multipart `PUT /api/<kind>/<id>/image`
(`illustrationChanges` decides what to send). The one exception is the server rules: HTML
an admin wrote, sanitized on the way in against `TERMS_TAGS`/`TERMS_ATTRIBUTES` in
`@dnd/shared`, rendered by `TermsDialog` into `.rich-text`.

**Server rules (terms of service).** One sanitized text per language, in the same
key/value settings table as the sign-up toggle and the default limits, plus a version
stamp that moves only when the text really changed. `termsAwait(terms, me.termsAcceptedAt)`
(one function, in `@dnd/shared`) decides whether they stand between the user and the board:
`AppShell` then shows `TermsDialog` with `dismissible={false}` — no close button, no
backdrop, no Escape — offering accept or sign out. The sign-up page instead gates creation on
a checkbox that only unlocks once the reader reaches the foot of the text (an
`IntersectionObserver` sentinel in `TermsDialog`); the Profile page offers a read-only copy.
Switching language on the sign-up screen re-earns that unlock: another language is another
text, and the box un-ticks.

**Language belongs to the browser, not the account.** `I18nProvider` (above `App` in
`main.tsx`) holds the locale and saves it to `localStorage` under `ambiance.locale`, which
`detectLocale` reads back at boot. One `Segmented` on Settings and one on the sign-in screen
set it, so a choice made before an account exists still holds once the app opens and
survives a reload.

## Design direction

A mixing desk on a dim game table: steady, tactile, low-light.

- One warm, very low-saturation dark neutral ramp for every surface (`--color-deep`,
  `page`, `card`, `raised`), three text roles (`ink`, `ink-2`, `ink-3`), hairline borders.
- One accent, lamp amber (`--color-lamp`), reserved for "this is making sound right now":
  the lamp dot, a lit tile border and icon, lit faders, one-shot progress. Not for buttons.
- The primary action of a view is off-white (`Button variant="primary"`), one per view.
- Instrument Sans for the interface; Geist Mono only for bare numbers (volume percent,
  counts, the big storage figure). Text that contains words stays in the sans face.
- Cinzel, an inscriptional Roman face, only for the product name (`Wordmark` in
  `components/Brand.tsx`). It has no lowercase: it sets the name in caps. Never use it for
  page headings, labels or body.
- The mark (a cartoon sword and a music note, in lamp amber and one shade darker) lives in
  `components/Brand.tsx`; the favicons, the web app manifest icons and the social preview
  are drawn from the same geometry by `scripts/build-brand-assets.mjs`.
- Weights 400 and 500. Sentence case. No exclamation marks, no trailing periods on labels.
- 4px spacing grid; touch targets 44px; radii 8 to 10 controls, 14 to 16 cards, 20 dialogs.
- Motion: one easing (`--ease-out`), color/opacity/transform only, no looping animation
  except spinners and the one-shot progress bar.
- Interface icons: lucide at 18px, stroke 1.5, in the color of their text.

## Known server caveats

- Route schemas in `apps/server` are documentation only: `app.ts` installs a no-op
  validator, and every handler validates with the zod schemas of `@dnd/shared`. Fastify's
  own validation coerced values (`name: 5` became "5") and could not read multipart bodies.
  Response schemas still shape the output, so loose objects (`illustration`, `limits`,
  `usage`) must carry `additionalProperties: true` or their contents are stripped.
- All server tests pass (313), and the server type-check is clean.
- The server reads icon sets from `ICONS_DIR`, defaulting to `<WEB_DIST>/icons`, or to
  `apps/web-v2/public/icons` in development, where the icon script writes them.
- An admin's password reset link points to `<PUBLIC_URL>/reset-password?token=…`, which
  this app handles (`pages/ResetPasswordPage.tsx`).

## Status

### Done

- Sign in, account creation (only when sign-ups are open), sign out
- Scenes, Mixes and Sounds pages: tile grid, search, empty and no-match states
- Scene page: its mixes and sounds, playable, with search
- Tiles showing the uploaded image or chosen icon, lit while playing, one-shot progress
- Player: pause/resume, stop all, master and one-shot volume, per-sound volume, mute, remove
- Responsive shell: tab bar and docked player on phones and tablets, rail and player
  column from desktop width (`lg`, 1024px)
- Sound upload (several files, per-file result), sound editor (name, illustration, play
  mode, volume, wait bounds, volume variation, scenes)
- Mix editor (sounds, per-sound volume and mode, scenes) and scene editor (mixes, sounds)
- Icon picker over five libraries (13,728 icons), Twemoji being full-colour art with
  names from emojibase-data, and image upload
- Settings: storage used against the limit, per-file limits, language, account
- English and French, switchable on the sign-in screen and in Settings, remembered per browser
- Product name (Roleplay Tunes) set in Cinzel, favicon set (SVG, 32, 192, 512, maskable
  512, Apple touch), a web app manifest, and a 1200×630 social preview with Open Graph and
  Twitter tags (the server fills in the absolute `PUBLIC_URL` in `index.html`)
- Admin page (administrators only): server disk split, sign-up toggle, default limits,
  user list with search; per user: role, access, own limits, password reset link, delete
- Password reset page for links created by an admin
- Public library: sounds and mixes are private or public; public ones are listed on the
  Library page (preview, add). Added items keep their owner: their editor is greyed out
  except the user's own volume, scenes and "Remove from my library"
- Description (sounds, mixes) and license (sounds): a list of usual licenses, or "Other"
  with free text. Options worded per language are saved as codes (`unknown`,
  `private-use`) and shown through `licenseText`; license names are saved as they are
- Mix editor: a "Random gaps" item shows its shortest and longest wait
- Player: each playing sound has a button to switch it between loop and random pauses
  (`setLayerPlay`), keeping its volume and its place in the mix
- Sound tile menu: play with its own mode, once, as a loop, or with random pauses (a
  dialog with Short, Medium and Very random suggestions), and edit
- Player: "Save as a mix" opens a new mix with what loops right now (own and added sounds)
- Player: sleep timer (`SleepTimer.tsx`, `useSleepTimer`): stop in N minutes, fading out over
  the last M (M ≤ N). The fade is scheduled on the audio clock at once (`fadeOutMaster`), so
  it happens with a locked phone; a page timer re-applies it and stops everything at the end,
  then `restoreMaster`. It ends by itself once nothing plays
- Settings: the user changes their pseudonym (`PATCH /api/me`). The name field reads as a
  pseudonym everywhere, since users were typing their real full name
- "Install the app" instructions on the Profile page and the sign-in page
- Tiles on phones: a 70px picture band; an image shows whole over a blurred, darker copy
  of itself, an icon gets 4px of padding (`Illustration` with `tile`)
- Library lists newest first (by `createdAt`, sorted in the client)
- Library rows readable on phones: description and license under the row, full width.
  Under the name, what the item is (a sound's mode and length, a mix's stack of sound
  pictures); at the foot, who shared it (initials and name) and the license as a tag
- A playing "once" sound: its progress runs along the foot of its tile's picture; in the
  player its row reads like a loop's, with "Once · length" where a loop has its fader
- Icon and image pickers keep one height and scroll their own grid; the icon grid is
  virtualised and shows the whole selected set (no cap on mounted icons)
- Synonyms on sounds, mixes and scenes: tags with suggestions from the user's own
  (`GET /api/synonyms`); categories (name, color from a palette or any color, optional
  icon), several per item, as filters on the Scenes, Mixes, Sounds and Library pages
- Server rules: an admin writes one sanitized text per language (Tiptap field, lazy
  chunk, allowlist shared with the server's sanitizer); everyone else reads them in
  `TermsDialog` — forced and un-closable when the version on record is not the current
  one, offered from Profile, and required reading before an account can be created
- "Choose image" reuses an image already shown on an own or added item
- Profile page (initials, name, email, links to Settings and Admin, sign out); phones get
  five tabs (Scenes, Mixes, Sounds, Library, Profile), the rail also lists Settings and Admin
- Dockerfile and `.dockerignore` at the repo root (written, not yet built: see Not done)
- 163 tests, all passing: synonyms field, categories (field, dialog, filter, text
  color), search by synonyms, playback rules, player panel stability, API client, i18n,
  login, sign-out, pick list and pick field, limit fields, admin page, password reset,
  sound tile menu and pauses dialog, dialog stack, license field and codes, changing how
  a playing sound repeats, mix editor pauses, Library rows, icon picker (virtualised
  grid: visible rows only, scroll to the end, search narrowing, scroll reset, pick).
  Tests that open a `Menu` stub `window.matchMedia`, and the icon grid tests rely on the
  `ResizeObserver` stub in `src/test/setup.ts` (jsdom has neither)

### Not done

- The Docker image has never been built or started (the Docker daemon was not running)
- Disk usage history chart (`history` of `GET /api/admin/usage` is fetched, not drawn)
- Loop-point editor with waveform (the engine supports it: `previewLoop`,
  `getWaveformPeaks`, `snapToZeroCrossing`)
- Delete my account
- Scene reordering (`PUT /api/scenes/order`)
- Stopping a single one-shot from the player
- Remembering volumes between visits
- Installable web app (manifest, offline)
- `README.md` at the repo root still describes the deleted `apps/web`
- A visual pass against a real account (screenshots so far use a mocked API)
