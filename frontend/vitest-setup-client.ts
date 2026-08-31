import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// required for svelte5 + jsdom as jsdom does not support matchMedia
Object.defineProperty(window, 'matchMedia', {
	writable: true,
	enumerable: true,
	value: vi.fn().mockImplementation((query) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn()
	}))
});

// jsdom has no ResizeObserver, and `DeploymentTimeline` measures its own width
// in an `$effect`. Without this any test that renders `/activity` with real
// data throws an UNHANDLED error — which vitest reports outside the test that
// caused it, so it reads as a random failure somewhere else.
if (!('ResizeObserver' in globalThis)) {
	Object.defineProperty(globalThis, 'ResizeObserver', {
		writable: true,
		configurable: true,
		value: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	});
}

// add more mocks here if you need them
