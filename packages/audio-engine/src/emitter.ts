export class Emitter<Events extends object> {
  private listeners = new Map<keyof Events, Set<(e: never) => void>>();

  on<K extends keyof Events>(type: K, cb: (e: Events[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(cb as (e: never) => void);
    return () => set.delete(cb as (e: never) => void);
  }

  emit<K extends keyof Events>(type: K, e: Events[K]) {
    for (const cb of this.listeners.get(type) ?? []) (cb as (e: Events[K]) => void)(e);
  }

  clear() {
    this.listeners.clear();
  }
}
