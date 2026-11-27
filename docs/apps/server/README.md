# Server — overview

The API of Roleplay Tunes (Fastify, SQLite, Better Auth). In production the same server also
serves the built web app.

## Where things live

| Area | Path |
| --- | --- |
| Routes | `src/routes/` — one file per resource |
| Data model | `src/db/` |
| Everything else | the top of `src/`: boot and app, configuration, auth, sharing, storage, tags, rules, release notes, settings, errors |

## Settings

Every setting is listed and explained in `.env.example`; the server checks them at start and
refuses to run on an invalid value. The dev scripts load each app's `.env`. See
[`ops/deployment.md`](../../ops/deployment.md) for the ones required in production.

The bundled icon sets are read from a configured directory, defaulting to the built web app's,
or to the web app's public folder in development where the icon script writes them.

## Related docs

- Routes and validation: [`api.md`](api.md)
- Data model and storage: [`database.md`](database.md)
- Auth and the admin: [`auth.md`](auth.md)
- Visibility and pruning: [`sharing.md`](sharing.md)
- Rules, changelog, contact, settings: [`content.md`](content.md)
