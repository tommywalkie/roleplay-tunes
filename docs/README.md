# Roleplay Tunes — documentation

The rules to follow, and where every domain is written down. Read this first, then the doc for
the area you are touching. Everything here describes the project **as it is now**: if it is
written, it applies; nothing is kept for history.

## How to maintain these docs

- **Describe concepts, behavior and specs — not the code.** A doc says what a thing does and
  why, in the words of the product; it does not narrate the functions that implement it.
- **No values that drift.** Counts, page sizes, pixel sizes, character limits, timings and byte
  sizes are not worth the upkeep — describe the behavior instead ("lists are paged", "tiles show
  a picture band"). Keep a number only where it *is* the spec (the spacing grid, the type
  weights).
- **Name the concept, not the identifier.** Point at an area, not at every file; say what
  happens, not which function or prop makes it happen. The one deliberate exception is the
  component inventory in the design spec, which exists so screens reuse the same components.
- **Keep the specs.** A doc's rules are the behavior the product promises; changing an important
  one is a product decision, not a refactor. Update the doc in the same change.
- **No history.** No done lists, no "we used to", no dead references.
- **Stay in budget.** The doc set is small on purpose — around eighteen files, twenty at most.
  Add a domain doc and a row in the table below rather than growing an existing one.

## Ground rules

- The contract between app and server is `packages/shared/src/index.ts` and the OpenAPI spec the
  server serves. Do not take behavior, layout or copy from reference images in the repo.
- The user starts and stops the dev servers. Ask them to run one; do not launch it.
- Temporary scripts and outputs go in `tmp/` at the repo root (gitignored), nowhere else.
- Tests are written by a delegated subagent with precise instructions. If it stops on a quota,
  resume it rather than redo its work.
- `apps/web-v2/src/i18n/en.ts` is the source of text keys; `fr.ts` must mirror it.

## Commands (from the repo root)

| What | Command |
| --- | --- |
| API server | `pnpm dev:server` |
| Web app | `pnpm dev:web` |
| Tests / type-check / lint / build | `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` |
| Icon picker data | `node scripts/build-icon-libraries.mjs` |
| Brand assets (favicons, social preview) | `node scripts/build-brand-assets.mjs` |
| Docker image (server + web) | `docker build -t roleplay-tunes .` |

The web app's dev port is fixed because the server trusts that origin by default, and the dev
proxy makes the session cookie same-origin. The dev server picks up saved files on its own; if a
page still looks stale, reload once.

## Environment

Each app's dev script loads its own `.env` (gitignored). The server validates every setting at
start. Tests read no env file: the server suite runs isolated, on an in-memory database, and the
web suite has no server to ask.

## Release notes and versioning

Release notes are one Markdown file per version and language, each opening with a date front
matter and listing the changes. A new version needs both language files and the same version in
the root, web and server `package.json`. See [`apps/server/content.md`](apps/server/content.md)
and [`ops/deployment.md`](ops/deployment.md).

They are read by non-technical users, in plain language. Write them as natural sentences in the
voice of the product, and treat the wording as final: use it as it is, never reword or paraphrase
it.

## Domains

| Area | Doc |
| --- | --- |
| Web app, overview | [`apps/web-v2/README.md`](apps/web-v2/README.md) |
| Web app, player | [`apps/web-v2/player.md`](apps/web-v2/player.md) |
| Web app, board and tiles | [`apps/web-v2/board-and-tiles.md`](apps/web-v2/board-and-tiles.md) |
| Web app, editors | [`apps/web-v2/editors.md`](apps/web-v2/editors.md) |
| Web app, library and sharing | [`apps/web-v2/library-and-sharing.md`](apps/web-v2/library-and-sharing.md) |
| Web app, pages and lists | [`apps/web-v2/pages-and-lists.md`](apps/web-v2/pages-and-lists.md) |
| Web app, account and admin | [`apps/web-v2/account-and-admin.md`](apps/web-v2/account-and-admin.md) |
| Web app, design spec | [`apps/web-v2/design-system.md`](apps/web-v2/design-system.md) |
| Web app, platform | [`apps/web-v2/platform.md`](apps/web-v2/platform.md) |
| Web app, server-driven content | [`apps/web-v2/server-content.md`](apps/web-v2/server-content.md) |
| Server, overview | [`apps/server/README.md`](apps/server/README.md) |
| Server, API | [`apps/server/api.md`](apps/server/api.md) |
| Server, database | [`apps/server/database.md`](apps/server/database.md) |
| Server, auth | [`apps/server/auth.md`](apps/server/auth.md) |
| Server, sharing | [`apps/server/sharing.md`](apps/server/sharing.md) |
| Server, content | [`apps/server/content.md`](apps/server/content.md) |
| Package `@dnd/shared` | [`packages/shared.md`](packages/shared.md) |
| Package `@dnd/audio-engine` | [`packages/audio-engine.md`](packages/audio-engine.md) |
| Operations | [`ops/deployment.md`](ops/deployment.md) |
