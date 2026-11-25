# Roleplay Tunes

A soundboard for tabletop game masters, made for a tablet or phone at the table.

- **Sounds** are the building blocks: a loop (tavern crowd), a sound that repeats with random gaps (a dripping cave), or a one-shot played on each tap (a door opening).
- **Mixes** combine several sounds, each at its own volume, into one ambiance.
- **Scenes** gather the mixes and sounds you want within reach for one place or moment.
- A **player** is always on screen with pause, stop all and volume controls.
- Sounds, mixes and scenes can show an icon, an uploaded image, or an image already used on another item.
- Sounds and mixes can be made **public**: everyone finds them in the Library and can add them to their own board without copying the file or using their storage. Only the owner can edit them; others set their own volume.
- Accounts with per-user storage limits, and an admin page to manage users, limits and sign-ups.
- Available in English and French.

## Project layout

| Folder | What it is |
| --- | --- |
| `apps/web-v2` | The web app (React, Vite, Tailwind) |
| `apps/server` | The API (Fastify, SQLite, Better Auth); it also serves the built web app in production |
| `packages/shared` | Types and validation rules shared by the app and the server |
| `packages/audio-engine` | The Web Audio engine behind the player |
| `scripts` | Builds the icon libraries used by the icon picker |

`apps/web-v2/AGENTS.md` is the working guide for the web app (behavior rules, design direction, status).

## Run it locally

You need Node.js 22 and pnpm 10 (`corepack enable`).

The Node version is pinned in `.nvmrc` (and `.node-version` for fnm, mise and asdf). With
[nvm](https://github.com/nvm-sh/nvm), run this once per terminal from the repo root:

```bash
nvm install   # first time only: installs the pinned version
nvm use
```

On Windows, [nvm-windows](https://github.com/coreybutler/nvm-windows) may not read `.nvmrc`
by itself depending on its version: run `nvm install 22` then `nvm use 22`.

```bash
pnpm install
node scripts/build-icon-libraries.mjs   # once: generates the icon picker data
pnpm dev:server                         # API on http://localhost:3000
pnpm dev:web                            # app on http://localhost:5173
```

Run the last two in separate terminals, then open http://localhost:5173 and create an account. No configuration is needed: local data goes to `tmp/dev-data` (ignored by git). Optional settings go in `apps/server/.env` and `apps/web-v2/.env` (ignored by git), which the two dev scripts load through Node's own `--env-file-if-exists`; a variable set in the shell wins. The API's own documentation is at http://localhost:3000/docs.

The account that signs up with the admin email (`admin@roleplay-tunes.local` by default) becomes the administrator and gets an Admin page.

## Checks

```bash
pnpm test        # unit tests in every package
pnpm typecheck   # TypeScript in every package
pnpm lint
pnpm build
```

## Deploy with Docker

One image holds the server and the web app.

```bash
docker build -t roleplay-tunes .
docker run -d -p 3000:3000 -v ambiance-data:/data \
  -e AUTH_SECRET="$(openssl rand -base64 48)" \
  -e PUBLIC_URL=https://ambiance.example.com \
  -e ADMIN_EMAIL=you@example.com \
  roleplay-tunes
```

- `AUTH_SECRET` (32 characters or more) is required. Keep the same value between restarts, or everyone is signed out.
- `PUBLIC_URL` is the address people type, without a trailing slash. Put the container behind a reverse proxy that provides HTTPS, and set `TRUST_PROXY=true`.
- Everything the app stores (database, audio, images) lives in the `/data` volume. Back it up.
- Any site, such as a self-hosted dashboard, can show or fetch the app's icons and social preview (`/favicon.svg`, `/icon-192.png`, `/og-image.png`, ...). Uploaded images stay private.
- **Set your own `ADMIN_EMAIL` and register it right after the first start, before sharing the address.** Sign-up is public and no email is verified, so whoever registers that address first becomes the administrator. You can close sign-ups from the Admin page afterwards.

All server settings are listed and explained in `.env.example`. The server checks them at start and refuses to run on an invalid value.

The contact form has two modes, set with `CONTACT_FORM_MODE`. The server reads these at start and hands them to the app at runtime, so a restart applies a change (no rebuild, and nothing to pass at build time). `local` keeps the messages on this server, and an administrator reads them in the Admin page. `provider` posts them to a form service: give `CONTACT_FORM_PROVIDER` (`dsforms`, `formspree` or `web3forms`; only `dsforms` has been tried) and `CONTACT_FORM_ENDPOINT`. Left unset, the app shows no contact form.

## License

Roleplay Tunes is open source, licensed under the **Apache License, Version 2.0** (`Apache-2.0`): see [`LICENSE`](LICENSE). The source lives at <https://github.com/tommywalkie/roleplay-tunes>.

The icon sets and fonts the app ships keep their own licences, listed in the app under Profile → Credits.
