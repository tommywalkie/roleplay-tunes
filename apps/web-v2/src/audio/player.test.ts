import type { LayerState } from '@dnd/audio-engine';
import { DEFAULT_INTERVAL_MAX_SEC, DEFAULT_INTERVAL_MIN_SEC, type Sound } from '@dnd/shared';
import { describe, expect, it } from 'vitest';
import { makeFakeEngine, makeMix, makeMixItem, makeSound } from '../test/fixtures';
import {
  createPlayer,
  defaultPlay,
  layersToMixItems,
  LOOSE_MIX_ID,
  soundLoop,
  toDescriptor,
} from './player';

function setup() {
  const fake = makeFakeEngine();
  // Rules read the live engine state, so one player object serves a whole test.
  const byId = new Map([loop, drip, door].map((s) => [s.id, s]));
  const player = () => createPlayer(fake.engine, fake.engine.getSnapshot(), (id) => byId.get(id));
  return { ...fake, player };
}

const loop = makeSound({ id: 'crowd', name: 'Tavern crowd', defaultMode: 'loop' });
const drip = makeSound({
  id: 'drip',
  name: 'Drip',
  defaultMode: 'recurring',
  intervalMinSec: 5,
  intervalMaxSec: 30,
  volumeVariation: 0.25,
});
const door = makeSound({ id: 'door', name: 'Door', defaultMode: 'oneshot', durationSec: 2 });

/** The engine-shaped loop markers of a sound (what a layer's mode carries). */
const engineLoop = (s: Sound) => {
  const l = soundLoop(s);
  return {
    trackStart: l.trackStartSec,
    trackEnd: l.trackEndSec,
    loopStart: l.loopStartSec,
    loopEnd: l.loopEndSec,
    mode: l.loopMode,
    crossfadeSec: l.crossfadeSec,
  };
};

describe('toDescriptor', () => {
  it('maps a sound to what the engine loads', () => {
    expect(
      toDescriptor(
        makeSound({
          id: 'a',
          loopStartSec: 1,
          loopEndSec: 9,
          trackStartSec: 0.5,
          trackEndSec: 20,
          loopMode: 'crossfade',
          crossfadeSec: 3,
          defaultVolume: 0.5,
        }),
      ),
    ).toEqual({
      id: 'a',
      url: '/api/sounds/a/audio',
      kind: 'loop',
      loopStart: 1,
      loopEnd: 9,
      trackStart: 0.5,
      trackEnd: 20,
      loopMode: 'crossfade',
      crossfadeSec: 3,
      defaultVolume: 0.5,
    });
    expect(toDescriptor(door).kind).toBe('oneshot');
  });
});

describe('toggleSound', () => {
  it('starts a loop as a loose layer when nothing plays', () => {
    const { player, spies, engine } = setup();
    player().toggleSound(loop);
    expect(spies.playMix).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot().mix?.id).toBe(LOOSE_MIX_ID);
    expect(engine.getSnapshot().mix?.layers).toMatchObject([
      { id: 'sound:crowd', soundId: 'crowd', volume: 0.8, muted: false, mode: { type: 'loop' } },
    ]);
    expect(player().isSoundPlaying('crowd')).toBe(true);
  });

  it('adds a loop on top of the mix that plays instead of replacing it', () => {
    const { player, spies, engine } = setup();
    player().toggleMix(makeMix({ id: 'm1', items: [] }));
    player().toggleSound(loop);
    expect(spies.addLayer).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot().mix?.id).toBe('m1');
  });

  it('turns a playing loop off, and stops the engine when it was the last one', () => {
    const { player, spies, engine } = setup();
    player().toggleSound(loop);
    player().toggleSound(loop);
    expect(spies.removeLayer).toHaveBeenCalledWith('sound:crowd');
    expect(engine.getSnapshot().mix).toBeNull();
    expect(player().isSoundPlaying('crowd')).toBe(false);
  });

  it('turns off a sound that plays as part of a mix rather than doubling it', () => {
    const { player, spies, engine } = setup();
    const mix = makeMix({
      id: 'm1',
      items: [
        makeMixItem({ id: 'i1', soundId: 'crowd', mode: 'loop', volume: 0.6 }),
        makeMixItem({ id: 'i2', soundId: 'drip', mode: 'loop', volume: 0.6 }),
      ],
    });
    player().toggleMix(mix);
    player().toggleSound(loop);
    expect(spies.addLayer).not.toHaveBeenCalled();
    expect(engine.getSnapshot().mix?.layers.map((l) => l.soundId)).toEqual(['drip']);
  });

  it('starts a loop at its beginning, not at a random point', () => {
    const { player, engine } = setup();
    player().toggleSound(loop);
    expect(engine.getSnapshot().mix?.layers[0]?.mode).toEqual({
      type: 'loop',
      randomStart: false,
      loop: engineLoop(loop),
    });
  });

  it('maps random gaps to a recurring layer with ordered bounds and volume jitter', () => {
    const { player, engine } = setup();
    player().toggleSound(drip);
    expect(engine.getSnapshot().mix?.layers[0]?.mode).toEqual({
      type: 'recurring',
      minInterval: 5,
      maxInterval: 30,
      volumeJitter: [0.75, 1],
      loop: engineLoop(drip),
    });
  });

  it('fires a one-shot on every tap without touching the layers', () => {
    const { player, spies, engine } = setup();
    player().toggleSound(door);
    player().toggleSound(door);
    expect(spies.playOneshot).toHaveBeenCalledTimes(2);
    expect(spies.playMix).not.toHaveBeenCalled();
    expect(engine.getSnapshot().mix).toBeNull();
    expect(player().isSoundPlaying('door')).toBe(true);
  });

  it('resumes a paused engine first, so a tap is never silent', () => {
    const { player, spies } = setup();
    player().togglePause();
    player().toggleSound(loop);
    expect(spies.resume).toHaveBeenCalledTimes(1);
  });
});

describe('playSoundAs', () => {
  it('fires a one-shot of any sound without touching the layers', () => {
    const { player, spies, engine } = setup();
    player().playSoundAs(loop, { mode: 'oneshot' });
    expect(spies.playOneshot).toHaveBeenCalledWith('crowd');
    expect(spies.playMix).not.toHaveBeenCalled();
    expect(engine.getSnapshot().mix).toBeNull();
  });

  it('plays a random-gaps sound as a loop in place of its own layer', () => {
    const { player, engine } = setup();
    player().toggleSound(drip);
    player().playSoundAs(drip, { mode: 'loop' });
    expect(engine.getSnapshot().mix?.layers).toMatchObject([
      { id: 'sound:drip', soundId: 'drip', mode: { type: 'loop', randomStart: false } },
    ]);
  });

  it('replaces a sound that plays in a mix, with the given intervals, instead of doubling it', () => {
    const { player, engine } = setup();
    player().toggleMix(
      makeMix({
        id: 'm1',
        items: [
          makeMixItem({ id: 'i1', soundId: 'crowd', mode: 'loop', volume: 0.6 }),
          makeMixItem({ id: 'i2', soundId: 'drip', mode: 'loop', volume: 0.6 }),
        ],
      }),
    );
    player().playSoundAs(loop, { mode: 'recurring', intervalMinSec: 3, intervalMaxSec: 12 });
    const snapshot = engine.getSnapshot();
    expect(snapshot.mix?.id).toBe('m1');
    expect(snapshot.mix?.layers.map((l) => l.id)).toEqual(['item:i2', 'sound:crowd']);
    expect(snapshot.mix?.layers[1]?.mode).toEqual({
      type: 'recurring',
      minInterval: 3,
      maxInterval: 12,
      volumeJitter: [1, 1],
      loop: {
        trackStart: 0,
        trackEnd: 168,
        loopStart: 0,
        loopEnd: 168,
        mode: 'gapless',
        crossfadeSec: 2,
      },
    });
  });

  it('starts a loose mix when nothing plays', () => {
    const { player, engine } = setup();
    player().playSoundAs(door, { mode: 'loop' });
    expect(engine.getSnapshot().mix?.id).toBe(LOOSE_MIX_ID);
    expect(engine.getSnapshot().mix?.layers).toMatchObject([
      { soundId: 'door', volume: 0.8, mode: { type: 'loop' } },
    ]);
  });

  it('keeps the volume the replaced layer was given in the player', () => {
    const { player, engine } = setup();
    player().toggleSound(loop);
    player().setLayerVolume('sound:crowd', 0.3);
    player().playSoundAs(loop, { mode: 'recurring', intervalMinSec: 2, intervalMaxSec: 8 });
    expect(engine.getSnapshot().mix?.layers).toMatchObject([
      { soundId: 'crowd', volume: 0.3, mode: { type: 'recurring' } },
    ]);
  });
});

describe('setLayerPlay', () => {
  it('turns a playing layer into a loop that starts at its beginning, in place', () => {
    const { player, spies, engine } = setup();
    player().toggleSound(drip);
    player().setLayerVolume('sound:drip', 0.3);
    player().setLayerPlay('sound:drip', drip, { mode: 'loop' });
    expect(spies.updateLayer).toHaveBeenLastCalledWith('sound:drip', {
      mode: { type: 'loop', randomStart: false, loop: engineLoop(drip) },
    });
    expect(spies.removeLayer).not.toHaveBeenCalled();
    expect(engine.getSnapshot().mix?.layers).toMatchObject([
      { id: 'sound:drip', volume: 0.3, mode: { type: 'loop', randomStart: false } },
    ]);
  });

  it('gives a loop random pauses with sorted bounds and the sound’s volume variation', () => {
    const { player, spies } = setup();
    const wind = makeSound({ id: 'wind', defaultMode: 'loop', volumeVariation: 0.4 });
    player().toggleSound(wind);
    player().setLayerPlay('sound:wind', wind, {
      mode: 'recurring',
      intervalMinSec: 30,
      intervalMaxSec: 10,
    });
    expect(spies.updateLayer).toHaveBeenLastCalledWith('sound:wind', {
      mode: {
        type: 'recurring',
        minInterval: 10,
        maxInterval: 30,
        volumeJitter: [0.6, 1],
        loop: engineLoop(wind),
      },
    });
  });

  it('keeps the volume jitter of a layer that already has random pauses', () => {
    const { player, spies } = setup();
    player().toggleSound(drip);
    player().setLayerPlay(
      'sound:drip',
      { ...drip, volumeVariation: 0.9 },
      {
        mode: 'recurring',
        intervalMinSec: 2,
        intervalMaxSec: 8,
      },
    );
    expect(spies.updateLayer).toHaveBeenLastCalledWith('sound:drip', {
      mode: {
        type: 'recurring',
        minInterval: 2,
        maxInterval: 8,
        volumeJitter: [0.75, 1],
        loop: engineLoop(drip),
      },
    });
  });

  it('resumes a paused engine', () => {
    const { player, spies } = setup();
    player().toggleSound(loop);
    player().togglePause();
    player().setLayerPlay('sound:crowd', loop, {
      mode: 'recurring',
      intervalMinSec: 2,
      intervalMaxSec: 8,
    });
    expect(spies.resume).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a layer that no longer plays', () => {
    const { player, spies } = setup();
    player().setLayerPlay('sound:crowd', loop, { mode: 'loop' });
    expect(spies.updateLayer).not.toHaveBeenCalled();
    expect(spies.resume).not.toHaveBeenCalled();
  });
});

describe('defaultPlay', () => {
  it('follows the sound’s own mode, with its own pauses for random gaps', () => {
    expect(defaultPlay(loop)).toEqual({ mode: 'loop' });
    expect(defaultPlay(door)).toEqual({ mode: 'oneshot' });
    expect(defaultPlay(drip)).toEqual({ mode: 'recurring', intervalMinSec: 5, intervalMaxSec: 30 });
  });
});

describe('layersToMixItems', () => {
  const layerOf = (
    over: Partial<LayerState> & Pick<LayerState, 'id' | 'soundId' | 'mode'>,
  ): LayerState => ({
    volume: 1,
    muted: false,
    load: 'ready',
    ...over,
  });

  it('keeps each sound once, with the mode, volume and pauses it plays with', () => {
    const items = layersToMixItems([
      layerOf({
        id: 'a',
        soundId: 'crowd',
        volume: 0.6,
        mode: { type: 'loop', randomStart: false },
      }),
      layerOf({
        id: 'b',
        soundId: 'drip',
        volume: 0.4,
        mode: { type: 'recurring', minInterval: 5, maxInterval: 30, volumeJitter: [0.75, 1] },
      }),
      layerOf({ id: 'c', soundId: 'crowd', volume: 0.2, mode: { type: 'loop' } }),
    ]);
    expect(items).toEqual([
      {
        soundId: 'crowd',
        mode: 'loop',
        volume: 0.6,
        intervalMinSec: DEFAULT_INTERVAL_MIN_SEC,
        intervalMaxSec: DEFAULT_INTERVAL_MAX_SEC,
        volumeVariation: 0,
        trackStartSec: null,
        trackEndSec: null,
        loopStartSec: null,
        loopEndSec: null,
        loopMode: null,
        crossfadeSec: null,
      },
      {
        soundId: 'drip',
        mode: 'recurring',
        volume: 0.4,
        intervalMinSec: 5,
        intervalMaxSec: 30,
        volumeVariation: 0.25,
        trackStartSec: null,
        trackEndSec: null,
        loopStartSec: null,
        loopEndSec: null,
        loopMode: null,
        crossfadeSec: null,
      },
    ]);
  });

  it('carries a layer’s loop markers into the mix item', () => {
    const items = layersToMixItems([
      layerOf({
        id: 'a',
        soundId: 'crowd',
        mode: {
          type: 'loop',
          randomStart: false,
          loop: {
            trackStart: 1,
            trackEnd: 60,
            loopStart: 5,
            loopEnd: 40,
            mode: 'crossfade',
            crossfadeSec: 4,
          },
        },
      }),
    ]);
    expect(items[0]).toMatchObject({
      trackStartSec: 1,
      trackEndSec: 60,
      loopStartSec: 5,
      loopEndSec: 40,
      loopMode: 'crossfade',
      crossfadeSec: 4,
    });
  });
});

describe('toggleMix', () => {
  const mix = makeMix({
    id: 'm1',
    name: 'Tavern evening',
    items: [
      makeMixItem({ id: 'i1', soundId: 'crowd', mode: 'loop', volume: 0.6 }),
      makeMixItem({
        id: 'i2',
        soundId: 'drip',
        mode: 'recurring',
        volume: 0.4,
        intervalMinSec: 5,
        intervalMaxSec: 30,
        volumeVariation: 0.5,
      }),
      makeMixItem({ id: 'i3', soundId: 'door', mode: 'oneshot', volume: 0.9 }),
    ],
  });

  it('plays looping items as layers with the mix settings, and "once" items one time', () => {
    const { player, spies, engine } = setup();
    player().toggleMix(mix);
    expect(engine.getSnapshot().mix).toMatchObject({
      id: 'm1',
      name: 'Tavern evening',
      layers: [
        { id: 'item:i1', soundId: 'crowd', volume: 0.6, mode: { type: 'loop' } },
        {
          id: 'item:i2',
          soundId: 'drip',
          volume: 0.4,
          mode: { type: 'recurring', volumeJitter: [0.5, 1] },
        },
      ],
    });
    expect(spies.playOneshot).toHaveBeenCalledWith('door', {
      volume: 0.9,
      trackStart: 0,
      trackEnd: 2,
    });
    expect(player().isMixPlaying('m1')).toBe(true);
  });

  it('replaces the mix that plays with the new one', () => {
    const { player, engine } = setup();
    player().toggleMix(mix);
    player().toggleMix(makeMix({ id: 'm2', name: 'Forest night' }));
    expect(engine.getSnapshot().mix?.id).toBe('m2');
    expect(player().isMixPlaying('m1')).toBe(false);
  });

  it('stops the mix when its own tile is tapped again', () => {
    const { player, spies, engine } = setup();
    player().toggleMix(mix);
    player().toggleMix(mix);
    expect(spies.stop).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot().mix).toBeNull();
  });
});

describe('transport', () => {
  it('stop all ends layers and one-shots together', () => {
    const { player, spies, engine } = setup();
    player().toggleSound(loop);
    player().toggleSound(door);
    player().stopAll();
    expect(spies.stop).toHaveBeenCalled();
    expect(spies.stopAllOneshots).toHaveBeenCalled();
    expect(engine.getSnapshot().mix).toBeNull();
    expect(engine.getSnapshot().activeOneshots).toEqual([]);
  });

  it('stop all is safe when nothing plays', () => {
    const { player } = setup();
    expect(() => player().stopAll()).not.toThrow();
  });

  it('pause toggles between pause and resume', () => {
    const { player, spies } = setup();
    player().togglePause();
    expect(spies.pause).toHaveBeenCalledTimes(1);
    player().togglePause();
    expect(spies.resume).toHaveBeenCalledTimes(1);
  });

  it('removing the last layer stops the engine', () => {
    const { player, engine } = setup();
    player().toggleSound(loop);
    player().removeLayer('sound:crowd');
    expect(engine.getSnapshot().mix).toBeNull();
  });

  it('reports load failures and ignores other engine errors', () => {
    const { player, emitError } = setup();
    const seen: (string | undefined)[] = [];
    const off = player().onLoadError((id) => seen.push(id));
    emitError({ code: 'LOAD_FAILED', soundId: 'crowd' });
    emitError({ code: 'UNLOCK_FAILED' });
    off();
    emitError({ code: 'DECODE_FAILED', soundId: 'door' });
    expect(seen).toEqual(['crowd']);
  });
});
