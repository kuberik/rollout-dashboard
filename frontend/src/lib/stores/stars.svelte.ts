/**
 * The viewer's starred apps. Persisted per browser in localStorage under
 * `kuberik.home.starred` as a JSON string array (sorted). No demo defaults:
 * a fresh browser has nothing starred, and mock mode may seed stars only by
 * writing this key from its scenario, never through this module.
 *
 * Reactive: `stars.apps` is a `SvelteSet`, so anything that reads it inside
 * a `$derived` / `$effect` (Home's `buildLumenHome(model, now, { starredApps:
 * stars.apps })`, which calls `.has`, or `StarToggle`'s `isStarred(app)`)
 * re-runs when a star changes. Write only through `toggleStar` so storage
 * stays in step.
 *
 * SSR-safe (no storage on the server: nothing is starred) and storage-safe
 * (a private window, a throwing accessor or a corrupt value reads as nothing
 * starred, and a failed write keeps the star for this page view only).
 *
 * Tabs stay in step: the `storage` event another tab fires when it writes the
 * key re-reads it here (`syncStarsFromStorage`), so starring an app on its page
 * in one tab moves it into Home's starred tier in another without a reload.
 */
import { browser } from '$app/environment';
import { SvelteSet } from 'svelte/reactivity';

export const STARS_KEY = 'kuberik.home.starred';

/** Parse the stored value; anything but an array of strings reads as empty. Deduplicated, order kept. */
export function parseStars(raw: string | null | undefined): string[] {
	if (!raw) return [];
	try {
		const v: unknown = JSON.parse(raw);
		if (!Array.isArray(v)) return [];
		return v.filter((x, i): x is string => typeof x === 'string' && x !== '' && v.indexOf(x) === i);
	} catch {
		return [];
	}
}

function read(): string[] {
	if (!browser) return [];
	try {
		return parseStars(localStorage.getItem(STARS_KEY));
	} catch {
		return [];
	}
}

function save(): void {
	if (!browser) return;
	try {
		localStorage.setItem(STARS_KEY, JSON.stringify([...stars.apps].sort()));
	} catch {
		// storage unavailable or full: the star holds for this page view only
	}
}

/** `stars.apps`: the starred app names (read it; change it with `toggleStar`). */
export const stars: { readonly apps: SvelteSet<string> } = {
	apps: new SvelteSet<string>(read())
};

export function isStarred(app: string): boolean {
	return stars.apps.has(app);
}

/** Star or unstar `app` (or force it with `on`); returns the new state. */
export function toggleStar(app: string, on?: boolean): boolean {
	const want = on ?? !stars.apps.has(app);
	if (want) stars.apps.add(app);
	else stars.apps.delete(app);
	save();
	return want;
}

/**
 * Re-read storage (another tab changed it, or a test reset it). Applies only
 * the difference, so a reader of an app whose star did not change is not
 * re-run.
 */
export function reloadStars(): void {
	const next: ReadonlySet<string> = new Set(read()); // eslint-disable-line svelte/prefer-svelte-reactivity -- a local lookup, never read reactively
	for (const app of [...stars.apps]) if (!next.has(app)) stars.apps.delete(app);
	for (const app of next) stars.apps.add(app);
}

/**
 * The `storage` listener. Another tab wrote (or `localStorage.clear()`ed,
 * which arrives as `key === null`) our key: take its value. Events for other
 * keys, and from `sessionStorage`, are ignored.
 */
export function syncStarsFromStorage(e: StorageEvent): void {
	if (e.key !== null && e.key !== STARS_KEY) return;
	if (e.storageArea && browser && e.storageArea !== safeLocalStorage()) return;
	reloadStars();
}

function safeLocalStorage(): Storage | null {
	try {
		return localStorage;
	} catch {
		return null;
	}
}

if (browser) {
	try {
		window.addEventListener('storage', syncStarsFromStorage);
		import.meta.hot?.dispose(() => window.removeEventListener('storage', syncStarsFromStorage));
	} catch {
		// no window events: stars still work, just not across tabs
	}
}
