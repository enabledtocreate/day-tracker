import React from 'react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

vi.mock('@/lib/getBaseUrl', () => ({ getBaseUrl: () => '/' }));

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
