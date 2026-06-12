import React from 'react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

vi.mock('@/lib/getBaseUrl', () => ({
  getBaseUrl: () => '/',
  resolveAppUrl: (path: string) => '/' + path.replace(/^\//, ''),
}));

// jsdom doesn't implement pointer capture; schedule resize/drag handlers call these.
// Provide safe no-op implementations so unit tests can dispatch pointer events.
if (!('setPointerCapture' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    value: () => {},
    configurable: true,
  });
}
if (!('releasePointerCapture' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    value: () => {},
    configurable: true,
  });
}

// jsdom may not define PointerEvent; schedule resize dispatches PointerEvent on window/handles.
if (typeof (globalThis as unknown as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
  const PointerEventPolyfill = class extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = (init.pointerType as string) ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  };
  (globalThis as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent =
    PointerEventPolyfill as unknown as typeof PointerEvent;
}

// jsdom doesn't implement <dialog>.showModal/close.
const dialogProto = (globalThis as any).HTMLDialogElement?.prototype;
if (dialogProto) {
  if (typeof dialogProto.showModal !== 'function') {
    dialogProto.showModal = () => {};
  }
  if (typeof dialogProto.close !== 'function') {
    dialogProto.close = () => {};
  }
}
