# Package — `@dnd/audio-engine`

The Web Audio engine behind the player. The web app's `audio/player.tsx` holds the board's rules
on top of it; the engine plays layers and one-shots.

- **The engine** loads, plays and stops, controls a layer, exposes waveforms for the loop editor,
  and holds the master and one-shot volume (with a scheduled fade for the sleep timer).
- **A layer** is a looping sound, a sound that repeats with random pauses, or a **sequence** (a
  playlist: sounds one after another, with a crossfade between them, shared with the looping
  engine).
- **One-shots** play on top of the layers.
- **Loading** decodes and caches audio buffers.
- **The audio context** is unlocked on the first tap (mobile browsers require it) and drives the
  lock-screen media session.
- **Testing** ships a fake audio context the web app's tests build a fake engine from.
