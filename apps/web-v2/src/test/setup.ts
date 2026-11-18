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

// jsdom has no IntersectionObserver either; the terms dialog watches the foot of its text
// with one. Reports nothing as visible, which is what a scrolled-out sentinel means.
class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  root = null;
  rootMargin = '';
  thresholds = [];
}
window.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver;

// jsdom lays nothing out, so it has neither of the two points ProseMirror reaches for when
// it scrolls a selection into view: `elementFromPoint` to find what is under the caret, and
// `getClientRects` to measure the node. The node is often a text node or a range, so both
// carry the method. All of it is meaningless without a real layout, and none of it is used
// for anything but that scroll.
if (!document.elementFromPoint) {
  document.elementFromPoint = () => null;
}
const noRects = () => [] as unknown as DOMRectList;
const noRect = () => new DOMRect();
// `Element` has both in jsdom (as zeros); a text node and a range have neither.
for (const proto of [Element.prototype, CharacterData.prototype, Range.prototype]) {
  if (!('getClientRects' in proto))
    Object.defineProperty(proto, 'getClientRects', { value: noRects });
  if (!('getBoundingClientRect' in proto))
    Object.defineProperty(proto, 'getBoundingClientRect', { value: noRect });
}
