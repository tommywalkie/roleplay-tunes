# Web app — account and admin

This doc is a spec: the rules below are the behavior the app promises.

## Auth

Sessions are cookies (Better Auth). A missing or expired session means "signed out" and shows
the sign-in page. On sign-out, clear only the signed-in user's state on the live query — do not
clear the whole query cache, which detaches the observer and leaves the board on screen.
Account creation is offered only when sign-ups are open, and requires reading the server rules
to the end (see [`server-content.md`](server-content.md)).

## Settings

Storage used against the limit, the per-file limits, the language, and the account. The user
changes their pseudonym here; the name field reads as a pseudonym everywhere.

## Profile

Initials, name, email, links to Settings and Admin, and sign out. On phones the main areas get a
tab each; the desktop rail also lists Settings and Admin. Profile also offers the release notes
again, the Credits dialog, and the "install the app" instructions.

## Admin page

Administrators only: server disk use, the sign-up toggle, default limits, and a user list with
search. Per user: role, access, own limits, a password reset link, and delete. Contact messages,
when the server keeps them, are listed here (read/unread, delete).

## Password reset

An admin creates a reset link; it points back at this app, which handles the token.
