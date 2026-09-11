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

// jsdom has no `Element.scrollIntoView` either — `CommandPalette`'s roving
// selection calls it on the selected row inside a `requestAnimationFrame`
// callback. Without this the error throws OUTSIDE the synchronous test body
// (inside the rAF callback), so vitest reports it as an unhandled exception
// attributed to whichever test happens to be running next — exactly the
// "random failure somewhere else" class of bug the `ResizeObserver` stub
// above already exists for. Surfaced by the fix pass (2026-09-10) wiring a
// `createQuery` into `CommandPalette.svelte`, which made two `rerender`-based
// focus-return tests run far enough to hit it for the first time.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// add more mocks here if you need them
