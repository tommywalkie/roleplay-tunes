import { describe, expect, it } from 'vitest';
import { makeFakeEngine, makeMix, makeSound } from '../test/fixtures';
import { createPlayer, LOOSE_MIX_ID, toDescriptor } from './player';

function setup() {
  const fake = makeFakeEngine();
  // Rules read the live engine state, so one player object serves a whole test.
  const player = () => createPlayer(fake.engine, fake.engine.getSnapshot());
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

describe('toDescriptor', () => {
  it('maps a sound to what the engine loads', () => {
    expect(toDescriptor(makeSound({ id: 'a', loopStartSec: 1, loopEndSec: 9, defaultVolume: 0.5 }))).toEqual({
      id: 'a',
      url: '/api/sounds/a/audio',
      kind: 'loop',
      loopStart: 1,
      loopEnd: 9,
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
        { id: 'i1', soundId: 'crowd', mode: 'loop', volume: 0.6, intervalMinSec: 20, intervalMaxSec: 90, volumeVariation: 0 },
        { id: 'i2', soundId: 'drip', mode: 'loop', volume: 0.6, intervalMinSec: 20, intervalMaxSec: 90, volumeVariation: 0 },
      ],
    });
    player().toggleMix(mix);
    player().toggleSound(loop);
    expect(spies.addLayer).not.toHaveBeenCalled();
    expect(engine.getSnapshot().mix?.layers.map((l) => l.soundId)).toEqual(['drip']);
  });

  it('maps random gaps to a recurring layer with ordered bounds and volume jitter', () => {
    const { player, engine } = setup();
    player().toggleSound(drip);
    expect(engine.getSnapshot().mix?.layers[0]?.mode).toEqual({
      type: 'recurring',
      minInterval: 5,
      maxInterval: 30,
      volumeJitter: [0.75, 1],
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

describe('toggleMix', () => {
  const mix = makeMix({
    id: 'm1',
    name: 'Tavern evening',
    items: [
      { id: 'i1', soundId: 'crowd', mode: 'loop', volume: 0.6, intervalMinSec: 20, intervalMaxSec: 90, volumeVariation: 0 },
      { id: 'i2', soundId: 'drip', mode: 'recurring', volume: 0.4, intervalMinSec: 5, intervalMaxSec: 30, volumeVariation: 0.5 },
      { id: 'i3', soundId: 'door', mode: 'oneshot', volume: 0.9, intervalMinSec: 20, intervalMaxSec: 90, volumeVariation: 0 },
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
        { id: 'item:i2', soundId: 'drip', volume: 0.4, mode: { type: 'recurring', volumeJitter: [0.5, 1] } },
      ],
    });
    expect(spies.playOneshot).toHaveBeenCalledWith('door', { volume: 0.9 });
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
