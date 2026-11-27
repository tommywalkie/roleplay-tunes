# Server — content

Text and configuration the server owns: the rules, the release notes, the contact form and the
settings they share. This doc is a spec: the rules below are the behavior the server promises.

## Settings

A key/value store holds whether sign-ups are open, the default limits, and the rules text per
language plus a version stamp that moves only when the text really changes. Per-user limit
overrides live on the user row and are layered over the defaults.

## Rules sanitizer

One sanitizer and one allowlist (shared with the app's editor) protect the rules text and the
release notes — the only HTML the app renders from the server.

## Release notes

The server reads a folder of Markdown notes from its working directory, one file per version and
language, each opening with a date front matter. The body becomes HTML, sanitized like the rules,
and is served per language. The folder is read once in production and re-read on every call in
development, so an edited note shows on reload. The server also owns the seen state: whether a
newer version exists for a user, and recording that they have seen the latest.

A new version needs both language files and the same version in the root, web and server
`package.json`; see the repo [`docs/README.md`](../../README.md).

## Contact form

The server owns the contact setting (`off`, a local store, or a hosted form service) and hands
the app the mode, provider and endpoint at runtime, so a restart applies a change with no
rebuild.

- **Local**: a rate-limited, honeypot-checked route stores the message, and the Admin page lists
  them.
- **Hosted**: the browser posts the dialog as a real form to the service — never through `fetch`
  (most form services answer no CORS). The endpoint's origin must be allowed by the server.

The app side of all of this is in `docs/apps/web-v2/server-content.md`.
