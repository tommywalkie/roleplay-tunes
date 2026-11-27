# Web app — board and tiles

The board is the grid of tiles a game master taps. This doc is a spec: the rules below are the
behavior the app promises.

- A tile shows the item's image or icon, and is lit while it plays.
- A "once" sound shows its progress along its tile.
- A mix tile says what it is (its kind — a mix or a playlist) and how many sounds it holds,
  each behind its own icon.
- On phones a tile shows a picture band; an image shows whole over a blurred copy of itself.

## Sound tile menu

Plays the sound with its own mode, once, as a loop, or with random pauses (offered as a few
suggested ranges), and opens its editor. Playing from here uses the chosen mode even if the
sound already plays — it starts over in that way, never doubled.

## Scene boards

The Scene page is one board of its mixes and sounds, playable, with search and sort. The Scenes,
Mixes and Sounds pages are the same tile grid with search, sort, and empty and no-match states
(see [`pages-and-lists.md`](pages-and-lists.md)).
