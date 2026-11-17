/**
 * Immutable snapshot store for useSyncExternalStore.
 * Updates replace the snapshot object; listeners are notified once per microtask.
 */
export class Store<S extends object> {
  private snapshot: S;
  private listeners = new Set<() => void>();
  private notifyScheduled = false;

  constructor(initial: S) {
    this.snapshot = initial;
  }

  get = (): S => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(fn: (s: S) => S) {
    const next = fn(this.snapshot);
    if (next === this.snapshot) return;
    this.snapshot = next;
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const l of this.listeners) l();
    });
  }

  clear() {
    this.listeners.clear();
  }
}
