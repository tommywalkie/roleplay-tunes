import type { LayerState } from '@dnd/audio-engine';
import { DEFAULT_INTERVAL_MAX_SEC, DEFAULT_INTERVAL_MIN_SEC, type Sound } from '@dnd/shared';
import { describe, expect, it, vi } from 'vitest';
import { makeFakeEngine, makeMix, makeMixItem, makeSound } from '../test/fixtures';
import {
  createPlayer,
  defaultPlay,
  layerLoop,
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
    mode: l.crossfadeSec > 0 ? 'crossfade' : 'gapless',
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
        crossfadeSec: 0,
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

describe('setLayerLoop', () => {
  const settings = {
    trackStartSec: 2,
    trackEndSec: 100,
    loopStartSec: 10,
    loopEndSec: 90,
    loopMode: 'crossfade' as const,
    crossfadeSec: 4,
  };
  const engineSettings = {
    trackStart: 2,
    trackEnd: 100,
    loopStart: 10,
    loopEnd: 90,
    mode: 'crossfade',
    crossfadeSec: 4,
  };

  it('changes the loop of a playing layer in place, keeping its mode and volume', () => {
    const { player, spies, engine } = setup();
    player().toggleSound(loop);
    player().setLayerVolume('sound:crowd', 0.4);
    spies.updateLayer.mockClear();
    player().setLayerLoop('sound:crowd', settings);
    expect(spies.updateLayer).toHaveBeenCalledTimes(1);
    expect(spies.updateLayer).toHaveBeenLastCalledWith('sound:crowd', {
      mode: { type: 'loop', randomStart: false, loop: engineSettings },
    });
    expect(spies.removeLayer).not.toHaveBeenCalled();
    expect(engine.getSnapshot().mix?.layers).toMatchObject([
      { id: 'sound:crowd', volume: 0.4, mode: { type: 'loop', loop: engineSettings } },
    ]);
  });

  it('keeps the random pauses of a recurring layer', () => {
    const { player, spies } = setup();
    player().toggleSound(drip);
    player().setLayerLoop('sound:drip', settings);
    expect(spies.updateLayer).toHaveBeenLastCalledWith('sound:drip', {
      mode: expect.objectContaining({
        type: 'recurring',
        minInterval: 5,
        maxInterval: 30,
        loop: engineSettings,
      }),
    });
  });

  it('resumes a paused engine', () => {
    const { player, spies } = setup();
    player().toggleSound(loop);
    player().togglePause();
    player().setLayerLoop('sound:crowd', settings);
    expect(spies.resume).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a layer that no longer plays, and never calls the server', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const { player, spies } = setup();
      player().setLayerLoop('sound:crowd', settings);
      expect(spies.updateLayer).not.toHaveBeenCalled();
      expect(spies.resume).not.toHaveBeenCalled();

      player().toggleSound(loop);
      player().setLayerLoop('sound:crowd', settings);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('layerLoop', () => {
  const sound = makeSound({
    durationSec: 60,
    loopStartSec: 5,
    loopEndSec: 50,
    crossfadeSec: 3,
  });

  it('falls back to the sound’s own loop when the layer carries none', () => {
    expect(layerLoop(sound, undefined)).toEqual(soundLoop(sound));
  });

  it('takes the layer’s markers over the sound’s', () => {
    expect(layerLoop(sound, { loopStart: 10 })).toEqual({
      ...soundLoop(sound),
      loopStartSec: 10,
    });
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

describe('playlists', () => {
  const road = makeMix({
    id: 'p1',
    name: 'Road',
    kind: 'playlist',
    items: [
      makeMixItem({ id: 'pi1', soundId: 'crowd', volume: 0.5 }),
      makeMixItem({ id: 'pi2', soundId: 'drip', volume: 0.7 }),
    ],
  });
  const songs = makeMix({
    id: 'p2',
    name: 'Songs',
    kind: 'playlist',
    items: [makeMixItem({ id: 'pi3', soundId: 'drip', volume: 1 })],
  });
  const tavern = makeMix({
    id: 'm1',
    name: 'Tavern',
    items: [makeMixItem({ id: 'i1', soundId: 'crowd', mode: 'loop', volume: 0.6 })],
  });
  const holding = makeMix({
    id: 'm2',
    name: 'Journey',
    items: [makeMixItem({ id: 'i2', soundId: 'drip', mode: 'loop', volume: 0.4 })],
    playlists: [{ playlistId: 'p1', volume: 0.3 }],
  });
  /** A playlist item carries its track range only: no loop markers, mode or crossfade. */
  const trackOf = (s: Sound) => {
    const { trackStart, trackEnd } = engineLoop(s);
    return { trackStart, trackEnd };
  };
  const roadItems = [
    { soundId: 'crowd', volume: 0.5, loop: trackOf(loop) },
    { soundId: 'drip', volume: 0.7, loop: trackOf(drip) },
  ];

  function setupWithMixes() {
    const fake = makeFakeEngine();
    const sounds = new Map([loop, drip, door].map((s) => [s.id, s]));
    const mixes = new Map([road, songs, tavern, holding].map((m) => [m.id, m]));
    const player = () =>
      createPlayer(
        fake.engine,
        fake.engine.getSnapshot(),
        (id) => sounds.get(id),
        (id) => mixes.get(id),
      );
    return { ...fake, player };
  }
  const ids = (engine: ReturnType<typeof setupWithMixes>['engine']) =>
    engine.getSnapshot().mix?.layers.map((l) => l.id) ?? [];

  it('plays a playlist alone as one sequence layer, and stops it on a second tap', () => {
    const { player, spies } = setupWithMixes();
    player().togglePlaylist(road);
    expect(spies.playMix).toHaveBeenLastCalledWith({
      id: LOOSE_MIX_ID,
      name: '',
      layers: [
        {
          id: 'playlist:p1',
          soundId: 'crowd',
          volume: 1,
          muted: false,
          mode: { type: 'sequence', items: roadItems, crossfadeSec: 0 },
        },
      ],
    });
    expect(player().isMixPlaying('p1')).toBe(true);

    player().togglePlaylist(road);
    expect(spies.removeLayer).toHaveBeenCalledWith('playlist:p1');
    expect(spies.stop).toHaveBeenCalledTimes(1);
    expect(player().isMixPlaying('p1')).toBe(false);
  });

  it('carries the playlist’s crossfade, and only each item’s track range', () => {
    const { player, engine } = setupWithMixes();
    // Old per-item loop settings (markers, crossfade mode) are not used in a playlist.
    const blended = makeMix({
      id: 'p3',
      name: 'Blend',
      kind: 'playlist',
      crossfadeSec: 3,
      items: [
        makeMixItem({
          id: 'pi4',
          soundId: 'crowd',
          volume: 1,
          trackStartSec: 2,
          trackEndSec: 50,
          loopStartSec: 10,
          loopEndSec: 40,
          crossfadeSec: 4,
        }),
        makeMixItem({ id: 'pi5', soundId: 'drip', volume: 1 }),
      ],
    });
    player().togglePlaylist(blended);
    const [layer] = engine.getSnapshot().mix!.layers;
    expect(layer.mode).toEqual({
      type: 'sequence',
      crossfadeSec: 3,
      items: [
        { soundId: 'crowd', volume: 1, loop: { trackStart: 2, trackEnd: 50 } },
        { soundId: 'drip', volume: 1, loop: trackOf(drip) },
      ],
    });
  });

  it('hands the sequence layer a 2.5 s crossfade, items keeping track start and end only', () => {
    const { player, engine } = setupWithMixes();
    const blended = makeMix({
      id: 'p4',
      name: 'Blend',
      kind: 'playlist',
      crossfadeSec: 2.5,
      items: [
        makeMixItem({
          id: 'pi6',
          soundId: 'crowd',
          volume: 0.9,
          loopStartSec: 5,
          loopEndSec: 30,
          crossfadeSec: 1.5,
        }),
        makeMixItem({
          id: 'pi7',
          soundId: 'drip',
          volume: 0.8,
          trackStartSec: 1,
          trackEndSec: 20,
          loopStartSec: 2,
          loopEndSec: 10,
          crossfadeSec: 0.5,
        }),
      ],
    });
    player().togglePlaylist(blended);
    const [layer] = engine.getSnapshot().mix!.layers;
    if (layer.mode.type !== 'sequence') throw new Error('expected a sequence layer');
    expect(layer.mode.crossfadeSec).toBe(2.5);
    expect(layer.mode.items).toHaveLength(2);
    for (const item of layer.mode.items) {
      expect(Object.keys(item.loop ?? {}).sort()).toEqual(['trackEnd', 'trackStart']);
    }
    expect(layer.mode.items[0].loop).toEqual(trackOf(loop));
    expect(layer.mode.items[1].loop).toEqual({ trackStart: 1, trackEnd: 20 });
  });

  it('is what toggleMix does with a playlist', () => {
    const { player, engine } = setupWithMixes();
    player().toggleMix(road);
    expect(ids(engine)).toEqual(['playlist:p1']);
    player().toggleMix(road);
    expect(engine.getSnapshot().mix).toBeNull();
  });

  it('plays on top of the mix, one playlist at a time', () => {
    const { player, spies, engine } = setupWithMixes();
    player().toggleMix(tavern);
    player().togglePlaylist(road);
    expect(spies.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'playlist:p1' }));
    expect(ids(engine)).toEqual(['item:i1', 'playlist:p1']);
    expect(player().isMixPlaying('m1')).toBe(true);
    expect(player().isMixPlaying('p1')).toBe(true);

    player().togglePlaylist(songs);
    expect(ids(engine)).toEqual(['item:i1', 'playlist:p2']);
    expect(player().isMixPlaying('p1')).toBe(false);

    // Tapping the playing one takes it off, the mix goes on.
    player().togglePlaylist(songs);
    expect(ids(engine)).toEqual(['item:i1']);
    expect(spies.stop).not.toHaveBeenCalled();
  });

  it('is carried into the next mix, settings unchanged', () => {
    const { player, engine } = setupWithMixes();
    player().togglePlaylist(road);
    player().toggleMix(tavern);
    const mix = engine.getSnapshot().mix!;
    expect(mix.id).toBe('m1');
    expect(mix.layers.map((l) => l.id)).toEqual(['item:i1', 'playlist:p1']);
    expect(mix.layers[1]).toMatchObject({
      volume: 1,
      mode: { type: 'sequence', items: roadItems, crossfadeSec: 0 },
    });
  });

  it('keeps playing alone when the playing mix is tapped off', () => {
    const { player, spies, engine } = setupWithMixes();
    player().toggleMix(tavern);
    player().togglePlaylist(road);
    player().toggleMix(tavern);
    expect(spies.stop).not.toHaveBeenCalled();
    expect(engine.getSnapshot().mix?.id).toBe(LOOSE_MIX_ID);
    expect(ids(engine)).toEqual(['playlist:p1']);
    expect(player().isMixPlaying('m1')).toBe(false);
    expect(player().isMixPlaying('p1')).toBe(true);
  });

  it('plays the playlists a mix holds as layers of the mix, at their volume', () => {
    const { player, engine } = setupWithMixes();
    player().toggleMix(holding);
    const layers = engine.getSnapshot().mix!.layers;
    expect(layers.map((l) => l.id)).toEqual(['item:i2', 'in-mix:m2:p1']);
    expect(layers[1]).toMatchObject({
      soundId: 'crowd',
      volume: 0.3,
      mode: { type: 'sequence', items: roadItems, crossfadeSec: 0 },
    });
    // A held playlist is part of the mix, not the one on top.
    expect(player().isMixPlaying('p1')).toBe(false);
    player().toggleMix(holding);
    expect(engine.getSnapshot().mix).toBeNull();
  });

  it('leaves out a held playlist it does not know', () => {
    const { engine } = setupWithMixes();
    const player = createPlayer(engine, engine.getSnapshot(), (id) =>
      [loop, drip].find((s) => s.id === id),
    );
    player.toggleMix(holding);
    expect(ids(engine)).toEqual(['item:i2']);
  });

  it('skips a playing playlist through the engine, resuming first', () => {
    const { player, spies } = setupWithMixes();
    player().togglePlaylist(road);
    player().togglePause();
    player().skipPlaylist('playlist:p1', 1);
    expect(spies.resume).toHaveBeenCalledTimes(1);
    expect(spies.skipLayer).toHaveBeenLastCalledWith('playlist:p1', 1);
    player().skipPlaylist('playlist:p1', -1);
    expect(spies.skipLayer).toHaveBeenLastCalledWith('playlist:p1', -1);
  });

  it('is never touched by tapping a sound it holds', () => {
    const { player, spies, engine } = setupWithMixes();
    player().togglePlaylist(road);
    expect(player().isSoundPlaying('crowd')).toBe(false);

    player().toggleSound(loop);
    expect(spies.removeLayer).not.toHaveBeenCalled();
    expect(ids(engine)).toEqual(['playlist:p1', 'sound:crowd']);
    expect(player().isSoundPlaying('crowd')).toBe(true);

    player().toggleSound(loop);
    expect(spies.removeLayer).toHaveBeenLastCalledWith('sound:crowd');
    expect(ids(engine)).toEqual(['playlist:p1']);

    player().playSoundAs(loop, { mode: 'loop' });
    expect(ids(engine)).toEqual(['playlist:p1', 'sound:crowd']);
    expect(spies.removeLayer).not.toHaveBeenCalledWith('playlist:p1');
  });

  it('is not saved as an item of a new mix', () => {
    const { player, engine } = setupWithMixes();
    player().toggleMix(tavern);
    player().togglePlaylist(road);
    expect(layersToMixItems(engine.getSnapshot().mix!.layers).map((i) => i.soundId)).toEqual([
      'crowd',
    ]);
  });
});
