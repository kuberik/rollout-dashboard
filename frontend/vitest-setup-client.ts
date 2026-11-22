import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { mount, unmount } from 'svelte';

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

// Svelte (dev build, which is what vitest compiles) replaces
// `Array.prototype.includes/indexOf/lastIndexOf` with versions that, on every
// MISS, walk the whole array unwrapping `$state` proxies, to warn about
// `state_proxy_equality_mismatch`. The view-models behind CommandPalette do
// thousands of misses over fleet-sized arrays, so one render of the palette
// cost 2-4s of pure patched-`includes` time and the eleven CommandPalette test
// files ran 20-50s each (60s+ on a CI runner, which trips vitest's 60s worker
// RPC limit: `Timeout calling "onTaskUpdate"`). The patch is installed once,
// lazily, by `init_operations()` on first mount; mount a no-op component now to run it and restore the
// native methods through svelte's own `__svelte_cleanup` hook. Only the dev
// warning is lost; array semantics are unchanged. A palette render drops from
// ~3s to ~0.3s.
unmount(mount(() => {}, { target: document.createElement('div') }));
(Array as unknown as { __svelte_cleanup?: () => void }).__svelte_cleanup?.();

// add more mocks here if you need them
