import '@testing-library/jest-dom/vitest'

// jsdom does not implement ResizeObserver; Radix/cmdk uses it when a
// searchable selector is mounted in component tests.
if (!globalThis.ResizeObserver) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
