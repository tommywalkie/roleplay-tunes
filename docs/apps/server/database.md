# Server — database

SQLite through drizzle-orm. Every sound, mix and scene belongs to exactly one user; public
sounds and mixes can also be added to the library of other users.

## The model

- **Sounds, mixes and scenes** — each with an owner, an illustration, and visibility (sounds and
  mixes). A mix carries a **kind** (a mix, or a playlist) and a crossfade for a playlist.
- **Mix items** — the sounds inside a mix: order, mode, volume, waits, and any loop overrides.
- **Mix playlists** — the playlists a mix holds, each at its own volume.
- **Scene contents** — the sounds and mixes a scene gathers.
- **Images** — uploaded illustration files; several items may share one, and it counts against
  the storage of the account that uploaded it.

## Per-user values on items they did not upload

Kept beside the item and layered on when served, with a null field following the owner's value:
the library entries themselves, a user's own volume for a sound, a user's own loop settings for
a sound, and a user's own volume for one sound of a mix they did not create.

## Tags

Synonyms and categories each belong to the user who wrote them; the links to items name no user,
so the tag's owner is the one who set it. A synonym no item carries is deleted; a category stays
until its owner deletes it.

## Server and auth

Server-wide settings (sign-up toggle, default limits, the rules text), a daily disk-use
snapshot for the admin chart, and the stored contact messages. The auth library's own tables
(users, sessions, accounts, verifications) follow its schema.

The user row also carries the per-user limit overrides, when the rules were accepted, and the
newest release-notes version seen.

## Creation and location

The server creates its tables at start. Local data, test data and production data each live in
their own directory (production in a mounted volume). A new non-null column with a falsy default
can empty a table on creation, so a new column on a populated table is added nullable.
