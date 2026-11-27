# Server — auth

Sessions are cookies from **Better Auth**, with its admin plugin. Its own tables (users, sessions,
accounts, verifications) follow the library's schema. This doc is a spec: the rules below are the
behavior the server promises.

## The administrator

The account that signs up with the configured admin email becomes the administrator and gets the
Admin page. The default address is unrouteable, so a real one must be set: **sign-up is public
and no email is verified, so whoever registers that address first becomes the administrator.**
Close sign-ups from the Admin page afterwards.

An admin's password reset link points back at the web app, which handles the token.

## Per-user state

The user row carries the per-user limit overrides (null means "use the server default"), when the
user accepted the rules, and the newest release-notes version they have seen.

## Sessions and origins

The session cookie is same-origin through the web app's dev proxy. A configured list of trusted
origins is why the web app's dev port is fixed — see [`../../ops/deployment.md`](../../ops/deployment.md).
