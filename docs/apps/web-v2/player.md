# Web app — player

The player panel and the playback rules the app layers on top of the audio engine. This doc is a
spec: the rules below are the behavior the app promises, not a description of the code.

## The player panel

**Player controls never move or disappear.** Pause, Stop all, master volume and one-shot volume
are shown and enabled in every state — idle, playing, paused. Stop all with nothing playing
does nothing.

**The docked player stands over the page.** Below the desktop breakpoint the player is a dock
above the tab bar and opens upward over the page. While it is open, a dim layer lies behind it,
the page behind does not scroll, and a tap on the layer closes the player; the tab bar stays
above the layer and usable. The player's foot never moves.

**Row order.** Playlist rows come first, then the rest in the order they play (display only). A
playlist's row offers previous and next; a playing sound's row offers how it repeats and its
loop settings. A "once" sound has no such menu.

**Save as a mix.** A new mix can be started from what is looping right now.

## Playback rules

- The engine plays one set of layers at a time, plus one-shots on top.
- Tapping a mix replaces what plays (with a crossfade). Tapping the playing mix stops it.
- A loop or random-gaps sound toggles on top of what plays; if it already plays as part of a
  mix, the tap turns it off instead of doubling it.
- A "once" sound fires on every tap. A "once" item inside a mix plays once when the mix starts.
- Any tap while paused resumes first, so a tap is never silent.
- Removing the last layer stops playback. Signing out stops everything.
- A loop always starts at its beginning.
- Random pauses run from the end of one play to the start of the next, so plays of one sound
  never overlap; the first play starts at once.
- Playing a sound in another mode restarts it in that mode, never doubled.
- Stop all also drops "once" sounds still loading, so none starts after it.

### Playlists

- A playlist is one layer that plays its sounds one after another, each from track start to
  track end, and starts over after the last.
- Its crossfade blends each sound into the next, the last into the first; at zero they play back
  to back.
- A tapped playlist plays on top of the mix, one at a time; tapping it again stops it. It keeps
  playing when the mix changes or the playing mix is stopped.
- A mix can hold playlists, each one more layer of it; a playlist holds none.
- Tapping a sound never touches a playlist layer.

## Sleep timer

Stop in N minutes, fading out over the last M (M ≤ N). The fade is scheduled on the audio clock
so it happens even with a locked phone, and the timer ends by itself once nothing plays.
