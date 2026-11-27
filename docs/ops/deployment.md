# Deployment

One Docker image holds the server and the web app. `Dockerfile` is at the repo root.

## The image

The build generates the icon manifests, builds the web app, then the server; the server serves
the app and reads the icons from the built output. Data (database, audio, images) lives in a
mounted **volume** — back it up. The release-notes folder is copied in, like the dev schema
folder.

The image keeps dev dependencies while the server still creates its tables at start; switch to a
production install once it uses migrations.

## Run

```bash
docker build -t roleplay-tunes .
docker run -d -p 3000:3000 -v ambiance-data:/data \
  -e AUTH_SECRET="$(openssl rand -base64 48)" \
  -e PUBLIC_URL=https://ambiance.example.com \
  -e ADMIN_EMAIL=you@example.com \
  roleplay-tunes
```

- `AUTH_SECRET` is required; keep the same value between restarts, or everyone is signed out.
- `PUBLIC_URL` is the address people type, without a trailing slash. Put the container behind a
  reverse proxy that provides HTTPS, and tell the server to trust the proxy.
- `ADMIN_EMAIL` — **set your own and register it right after the first start, before sharing the
  address.** Sign-up is public and no email is verified, so whoever registers that address first
  becomes the administrator (see [`../apps/server/auth.md`](../apps/server/auth.md)).

Every setting is listed and explained in `.env.example`; the server refuses to run on an invalid
value.

## Network

The web app's dev port is fixed because the server trusts that origin by default, and in
development the dev proxy makes the session cookie same-origin. In production the server serves
the app itself.

## Contact form

The mode (`off`, a local store, or a hosted form service) is read at start and handed to the app
at runtime, so a restart applies a change with no rebuild. See
[`../apps/server/content.md`](../apps/server/content.md).

## Licensing

The repo is Apache-2.0 (`LICENSE` at the root). The production build keeps third-party `@license`
comments, since the minifier strips them and MIT/ISC ask for them in copies.
