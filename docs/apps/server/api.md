# Server — API

Fastify, with one route file per resource. The OpenAPI documentation is served by the app (a UI
and a JSON spec). This doc is a spec: the rules below are the behavior the server promises.

## Validation caveat

**Route schemas are documentation only.** Every handler validates with the zod schemas from
`@dnd/shared` — Fastify's own validation coerced values and could not read multipart bodies.
Response schemas still shape the output, so any loose object must allow additional properties or
its contents are stripped.

## Errors

Errors share one shape the web client understands, with an optional per-field map for form
errors. The client also reads the auth library's own error shape.

## Ownership

Anything a request names must belong to (or be usable by) the user; ids they cannot use are
reported exactly like ids that do not exist. Scene membership of a sound or mix is replaced
wholesale on save.

## Auth

The auth library serves its own routes — see [`auth.md`](auth.md).

## Content

The release notes, the rules, and the contact form (rate-limited and honeypot-checked) — see
[`content.md`](content.md).

## Images

An icon is sent by its id; an image is uploaded separately as a multipart request.
