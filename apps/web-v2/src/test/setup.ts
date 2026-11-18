import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// jsdom has no ResizeObserver; the icon grid measures its scroller with one. Fires once,
// synchronously, with a fixed content box — enough to lay out a virtual grid in tests.
class ResizeObserverStub {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    const entry = {
      target,
      contentRect: { width: 600, height: 400, top: 0, left: 0 },
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
  unobserve(): void {}
  disconnect(): void {}
}
window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
