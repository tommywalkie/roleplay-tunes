# Package — `@dnd/shared`

`packages/shared/src/index.ts` is **the contract between the app and the server**: the types,
limits and zod schemas both sides validate with. Change it deliberately; it is what keeps the two
in step.

It holds:

- The **limits and playback constants** both sides share (volume, waits, intervals, crossfade,
  text lengths).
- The **request/response schemas** the server handlers validate with, and the item shapes the app
  reads — including a mix's kind (mix or playlist), its crossfade, and the playlists it holds.
  Request bodies are strict, so an unknown field is refused.
- Small **shared helpers**: whether the server rules stand between the user and the board, an
  ordering of two `major.minor.patch` versions, the loop marker rules, a category's readable text
  colour, and the sanitizer allowlist.
