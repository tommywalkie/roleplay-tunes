# Web app — server-driven content

Screens whose text and configuration the server owns: the rules, the release notes, the contact
form and the credits. This doc is a spec: the rules below are the behavior the app promises.

## Server rules (terms of service)

One sanitized text per language, plus a version stamp that moves only when the text changes.
While the version on record is not current, the rules dialog blocks the board and can only be
accepted or answered by signing out.

The sign-up page gates creation on a checkbox that unlocks only once the reader reaches the foot
of the text. A tap on the locked row opens the rules in an agree mode: an agree button stays
greyed until the foot is reached, then ticks the box and closes. Switching language re-earns
that unlock — another language is another text. Profile offers a read-only copy; an admin writes
the text.

## Release notes (changelog)

The server serves one Markdown file per version and language (see the repo
[`docs/README.md`](../../README.md) for the file format and the version bump), turned into HTML
and sanitized like the rules. The server owns the seen state: it knows whether a newer version
exists for the user.

The app opens the release-notes dialog when there are unseen notes, once the rules are loaded
and answered. Closing it in any way records that the notes were seen. New accounts see it too,
after the rules; Profile offers it again.

## Contact form

Shown only when the server is configured for one. The server decides the mode at runtime and
hands it to the app, so a restart applies a change with no rebuild — the modes are `off`, a
local message store, and a hosted form service.

- **Local**: the dialog posts to this server (rate-limited and honeypot-checked), which stores
  the message; an admin reads them under Messages, and the dialog confirms in place.
- **Hosted**: the dialog *is* the form the browser posts to the service — never through `fetch`,
  since most form services answer no CORS. The browser leaves and comes back marked, and the app
  says "message sent" once. A provider endpoint's origin must be allowed by the server, or the
  browser refuses to submit.

Playback stops while the browser is away, and the dialog says so. Name and email are prefilled
for a signed-in user.

## Credits

One card per work: each bundled icon set (source, version, count, licence), and the fonts. The
icon sets come from the generated icon index; the font versions are read at build time.
