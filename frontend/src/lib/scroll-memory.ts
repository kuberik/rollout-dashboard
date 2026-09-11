/**
 * ⭐ WHERE `<main>`'S SCROLL OFFSET GOES WHEN A ROUTE UNMOUNTS. (2026-09-05,
 * operator walk: *"scroll `/revisions` to 900px, open a revision, press
 * Back → `main.scrollTop` is 0."*)
 *
 * From `sm` up `<main>` is the ONE scroller (see `CLAUDE.md`'s "The scroll
 * model has two sides of one breakpoint"). SvelteKit's own scroll
 * restoration only ever tracks `window.scrollY` — which never moves under
 * this model, because the DOCUMENT does not scroll at `sm`+ — so a Back
 * navigation that lands `<main>` back on a page it left scrolled 900px deep
 * has nothing to restore it with. The root layout's `afterNavigate` was
 * unconditionally resetting `main.scrollTop` to 0 on every navigation,
 * `popstate` included, which is exactly backwards for Back/Forward.
 *
 * This module is the missing memory: a URL-keyed map of "how far `<main>`
 * was scrolled the last time this route was left", written by the root
 * layout's `beforeNavigate` (the only moment the outgoing page's `<main>`
 * and the outgoing URL are both still known) and read by its
 * `afterNavigate` on a `popstate` arrival.
 *
 * ⛔ NOT a general history API.
 *
 * ⭐ FIX PASS ITEM 7 (2026-09-10) — SUPERSEDES "below `sm` this store is
 * never consulted". That was wrong on `/changes`: the browser's own native
 * restoration reads whatever height the page happens to have at the exact
 * instant a `popstate` lands, which is the short skeleton, not the real
 * list — it clamps short and never revisits the offset once real content
 * grows the page taller a moment later. `routes/+layout.svelte`'s
 * `beforeNavigate`/`afterNavigate` now write and read a document-scroller
 * entry too (`window.scrollY` in place of `main.scrollTop`), keyed with a
 * `doc:` prefix so it can never collide with an `<main>`-scroller entry
 * saved for the SAME url at the other breakpoint.
 */

const MAX_ENTRIES = 50;
const STORAGE_KEY = 'kuberik.scroll-memory.v1';

function hasSessionStorage(): boolean {
	// SSR guard, same idiom as `skeleton-hints.ts`'s `hasLocalStorage` —
	// `sessionStorage` does not exist during server-side rendering, and some
	// runtimes throw on the reference rather than returning `undefined`.
	try {
		return typeof sessionStorage !== 'undefined';
	} catch {
		return false;
	}
}

function load(): Map<string, number> {
	if (!hasSessionStorage()) return new Map();
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return new Map();
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return new Map();
		const entries: [string, number][] = [];
		for (const entry of parsed) {
			if (
				Array.isArray(entry) &&
				entry.length === 2 &&
				typeof entry[0] === 'string' &&
				typeof entry[1] === 'number'
			) {
				entries.push([entry[0], entry[1]]);
			}
		}
		return new Map(entries);
	} catch {
		return new Map();
	}
}

// Module-level, so it survives client-side navigations for free (this module
// is imported once per tab). `sessionStorage` only matters for the ONE case
// module state does not survive on its own: a plain reload re-running this
// file's top level. Read once, eagerly, at import time.
const memory = load();

function persist(): void {
	if (!hasSessionStorage()) return;
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...memory.entries()]));
	} catch {
		// Private/incognito mode, or storage full: the in-memory map is still
		// correct for the rest of this tab's life — only the reload-survives-it
		// part is lost, same failure mode `skeleton-hints.ts` accepts.
	}
}

/**
 * The key this store indexes by — pathname + search, never the hash. Two
 * navigations to the same path with different query params (`?tab=`) are
 * different scroll positions; a hash-only change is not a route the reader
 * left in any meaningful sense.
 */
export function scrollMemoryKey(url: URL): string {
	return url.pathname + url.search;
}

/**
 * Record `<main>`'s scroll offset for `key`. Re-inserts the key at the end
 * of the map's iteration order (delete-then-set) so the map doubles as an
 * LRU without a separate recency structure — the oldest-touched entry is
 * always `memory.keys().next().value`.
 */
export function saveScrollPosition(key: string, y: number): void {
	memory.delete(key);
	memory.set(key, y);
	while (memory.size > MAX_ENTRIES) {
		const oldest = memory.keys().next().value;
		if (oldest === undefined) break;
		memory.delete(oldest);
	}
	persist();
}

/** The remembered offset for `key`, or `undefined` if none was ever saved. */
export function getScrollPosition(key: string): number | undefined {
	return memory.get(key);
}

/** Test-only escape hatch to reset module state between cases. */
export function clearScrollMemoryForTest(): void {
	memory.clear();
	persist();
}
