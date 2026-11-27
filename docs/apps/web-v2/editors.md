# Web app — editors

Every editor opens as a dialog and shares the same footer, tag fields, visibility field and
illustration field. A dialog opened from inside another stacks (see [`platform.md`](platform.md)).
This doc is a spec: the rules below are the behavior the app promises.

## Sound editor and upload

- **Upload sounds** takes several files at once and reports a result per file.
- **Sound editor**: name, illustration, play mode, volume, wait bounds, volume variation and
  scenes.
- **More details** (a folding section): where a sound is from — artists, year, movie, game, tv,
  album and a link. Each is short and optional, and shows on the library card behind its own
  icon.
- **Description** (sounds and mixes) and **license** (sounds): a list of usual licenses or free
  text, worded per language.

## Mix editor

Picks sounds and sets, per sound, its volume and play mode, plus the mix's scenes. A
"random gaps" item shows its shortest and longest wait. It also picks the **playlists** the mix
holds, each one more layer at its own volume (a public mix holds public playlists only — see
[`library-and-sharing.md`](library-and-sharing.md)).

## Playlist editor

Lists the sounds in order, and sets each one's volume and its track range (the loop editor in
range-only mode). One **crossfade between sounds** slider blends each sound into the next, the
last into the first, with a small preview of the blend under it. No play mode: a playlist plays
each sound once, track start to track end (see [`player.md`](player.md)).

## Scene editor

Gathers the mixes and sounds wanted within reach for one place or moment.

## Loop editor

A zoomable, scrollable waveform with the track and loop markers. Tap places the playhead, drag
scrolls, pinch or the wheel zooms; an overview strip of the whole track scrolls too. Markers
move by their tags, outside the waveform. One **crossfade slider** blends the loop's end into
its start; at 0 the loop is gapless, and a loop too short to blend offers no crossfade.

Who saves what:

- The owner sets the sound's own loop.
- A user who added the sound sets their own copy, overlaid on the sound by the server.
- A mix owner sets one per item; items of a mix the user did not create come resolved with the
  mix and sound owners' values.
- The player's per-sound menu can open the loop settings live, on the playing layer only, never
  saved.

## Field widgets

Pickers choose sounds, mixes, playlists, scenes, icons and images, and open as stacked dialogs.
The illustration field covers the icon picker and image upload. The tag fields carry the user's
synonyms and categories (see [`pages-and-lists.md`](pages-and-lists.md)). Reuse these and the
components in the design spec rather than wiring fields by hand.
