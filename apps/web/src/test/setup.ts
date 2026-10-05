import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// jsdom does not implement scrollIntoView; Radix Select calls it when
// focusing the selected item inside the open listbox.
Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
  writable: true,
  value: vi.fn(),
});

let focusSink: HTMLElement | null = null;

// jsdom remembers the document as the last focused element after a focused
// node is removed (RTL cleanup between tests), so the next element.focus()
// dispatches a synthetic blur on window. Radix Select closes on window blur,
// which breaks any test that opens a select after another test ran. Focusing
// a persistent inert sink element keeps the last focused target an element,
// so the blur is dispatched at the sink instead of the window.
beforeEach(() => {
  if (!focusSink?.isConnected) {
    focusSink = document.createElement('div');
    focusSink.tabIndex = -1;
    focusSink.dataset.testid = 'focus-sink';
    document.body.appendChild(focusSink);
  }
  focusSink.focus();
});

afterEach(() => {
  cleanup();
});
