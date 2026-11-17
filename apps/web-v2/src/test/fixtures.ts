import type { AudioEngine, EngineSnapshot, LayerConfig, MixConfig } from '@dnd/audio-engine';
import type { Me, Mix, Sound } from '@dnd/shared';
import { vi } from 'vitest';

export function makeSound(over: Partial<Sound> = {}): Sound {
  const id = over.id ?? 's1';
  return {
    id,
    name: 'Tavern crowd',
    audioUrl: `/api/sounds/${id}/audio`,
    mimeType: 'audio/mpeg',
    sizeBytes: 1_000_000,
    durationSec: 168,
    defaultMode: 'loop',
    defaultVolume: 0.8,
    loopStartSec: null,
    loopEndSec: null,
    intervalMinSec: 20,
    intervalMaxSec: 90,
    volumeVariation: 0,
    illustration: { type: 'none' },
    sceneIds: [],
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...over,
  };
}

export function makeMix(over: Partial<Mix> = {}): Mix {
  return {
    id: 'm1',
    name: 'Tavern evening',
    illustration: { type: 'none' },
    items: [],
    sceneIds: [],
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...over,
  };
}

export function makeMe(over: Partial<Me> = {}): Me {
  const MB = 1024 * 1024;
  return {
    id: 'u1',
    email: 'gm@example.com',
    name: 'Game Master',
    role: 'user',
    limits: {
      storageBytes: 500 * MB,
      audioFileBytes: 30 * MB,
      audioDurationSec: 600,
      imageFileBytes: 5 * MB,
      mixItems: 50,
    },
    usage: { storageBytes: 125 * MB, sounds: 12, mixes: 3, scenes: 2 },
    ...over,
  };
}

/**
 * An engine that keeps the same observable state as the real one (mix, layers, one-shots,
 * status, volumes) without any audio, and notifies subscribers synchronously.
 */
export function makeFakeEngine() {
  let snapshot: EngineSnapshot = {
    status: 'idle',
    masterVolume: 1,
    effectsVolume: 1,
    mix: null,
    transition: null,
    activeOneshotCount: 0,
    activeOneshots: [],
    preview: null,
    memory: { usedBytes: 0, budgetBytes: 1 },
  };
  const listeners = new Set<() => void>();
  const errorListeners = new Set<(e: { code: string; soundId?: string }) => void>();
  const set = (patch: Partial<EngineSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const l of listeners) l();
  };
  const layers = () => snapshot.mix?.layers ?? [];
  const setLayers = (next: (LayerConfig & { load: 'ready' })[]) => {
    if (snapshot.mix) set({ mix: { ...snapshot.mix, layers: next } });
  };
  let shots = 0;

  const engine = {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot: () => snapshot,
    on: vi.fn((type: string, cb: (e: { code: string; soundId?: string }) => void) => {
      if (type === 'error') errorListeners.add(cb);
      return () => errorListeners.delete(cb);
    }),
    unlock: vi.fn(async () => {}),
    preload: vi.fn(async () => {}),
    playMix: vi.fn((mix: MixConfig) =>
      set({
        status: 'playing',
        mix: { id: mix.id, name: mix.name, layers: mix.layers.map((l) => ({ ...l, load: 'ready' })) },
      }),
    ),
    addLayer: vi.fn((layer: LayerConfig) => setLayers([...layers(), { ...layer, load: 'ready' }] as never)),
    updateLayer: vi.fn((id: string, patch: Partial<LayerConfig>) =>
      setLayers(layers().map((l) => (l.id === id ? { ...l, ...patch } : l)) as never),
    ),
    removeLayer: vi.fn((id: string) => setLayers(layers().filter((l) => l.id !== id) as never)),
    refreshSound: vi.fn(),
    setMasterVolume: vi.fn((v: number) => set({ masterVolume: v })),
    setEffectsVolume: vi.fn((v: number) => set({ effectsVolume: v })),
    playOneshot: vi.fn((soundId: string) => {
      const id = `shot-${++shots}`;
      const activeOneshots = [
        ...snapshot.activeOneshots,
        { id, soundId, startedAt: Date.now(), durationSec: 2 },
      ];
      set({ activeOneshots, activeOneshotCount: activeOneshots.length });
      return { id, stop: vi.fn(), setVolume: vi.fn() };
    }),
    stopAllOneshots: vi.fn(() => set({ activeOneshots: [], activeOneshotCount: 0 })),
    pause: vi.fn(async () => set({ status: 'paused' })),
    resume: vi.fn(async () => set({ status: snapshot.mix ? 'playing' : 'idle' })),
    stop: vi.fn(() => set({ mix: null, status: snapshot.status === 'paused' ? 'paused' : 'idle' })),
    previewLoop: vi.fn(),
    getWaveformPeaks: vi.fn(),
    snapToZeroCrossing: vi.fn(),
    dispose: vi.fn(async () => {}),
  };

  return {
    engine: engine as unknown as AudioEngine,
    spies: engine,
    emitError: (e: { code: string; soundId?: string }) => errorListeners.forEach((cb) => cb(e)),
  };
}
