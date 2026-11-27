# Web app — overview

The web client of the soundboard: a game master taps tiles on a tablet or phone to play
ambiance, loops and effects.

## Stack

React, Vite, TypeScript (strict), Tailwind (design tokens live in `src/index.css`, no config
file), TanStack Query, React Router, lucide for interface icons, vitest + React Testing
Library. Workspace packages: `@dnd/shared` (the app/server contract) and `@dnd/audio-engine`
(the Web Audio engine). The rules-text editor is loaded lazily so it stays out of the board's
bundle.

## Where things live

| Area | Path |
| --- | --- |
| API access | `src/api/` |
| Playback | `src/audio/` and the `@dnd/audio-engine` package |
| The player panel | `src/player/` |
| Shell, rail and tab bar | `src/layout/` |
| Board tiles | `src/board/` |
| Reusable components | `src/components/` |
| Editors | `src/editors/` |
| Pages | `src/pages/` |
| Text keys | `src/i18n/` (`en.ts` is the source, `fr.ts` mirrors it) |
| Test fixtures | `src/test/` |

## Related docs

- Playback and the player: [`player.md`](player.md)
- Tiles and boards: [`board-and-tiles.md`](board-and-tiles.md)
- Editors: [`editors.md`](editors.md)
- Library and sharing: [`library-and-sharing.md`](library-and-sharing.md)
- Search, sort, pages, categories: [`pages-and-lists.md`](pages-and-lists.md)
- Auth, settings, profile, admin: [`account-and-admin.md`](account-and-admin.md)
- Design spec: [`design-system.md`](design-system.md)
- Safe areas, dialogs, i18n: [`platform.md`](platform.md)
- Rules, release notes, contact: [`server-content.md`](server-content.md)
