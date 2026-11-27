# Web app — platform

Behaviour that comes from the browser, the device, or content the server hands over. This doc is
a spec: the rules below are the behavior the app promises.

## Safe areas (iOS)

The status bar is translucent, so the page starts under it: the body is padded by the top and
side insets, and screens fill the body — never the dynamic viewport unit, which overflows by the
inset. Use the shared safe-area variable rather than the raw `env()` value, because an installed
iPhone app can have a shortened viewport the helper accounts for. Entrance animations use fill
mode `backwards`, and the main scroll area is its own stacking context: on iOS Safari, an
element that keeps its last keyframe paints over the fixed player and dialogs.

## Dialogs stack

A dialog opened from inside another hides the first's panel, which stays mounted with its form
state; closing it shows the first again. The first dialog's dim layer stays for the whole stack,
so the page never flashes between them. Confirmations and the pickers open this way, to keep
editors short.

## Rendering HTML

Any HTML rendered from a string other than icon SVG comes from the server already sanitized with
the shared allowlist, and shows in the rich-text style: the server rules and the release notes.
**The app has no sanitizer of its own.**

## Language belongs to the browser, not the account

The locale is held above the app, saved to `localStorage`, and read back at boot. It can be set
before an account exists, holds once the app opens, and survives a reload.

## Install the app

Install instructions live on the Profile page and the sign-in page.
