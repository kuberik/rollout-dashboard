/**
 * ⭐ THE REMEMBERED-SHAPE PRIMITIVE EVERY LOADING BRANCH READS FROM NOW.
 * (2026-09-04, LOAD-STATE-AUDIT-2026-09-04.md, "Deliver: remembered shape
 * hints".) Generalises the pattern `GithubConnectButton.svelte` already
 * shipped for its own three-shape control (`SHAPE_KEY`, `readHint`,
 * `$effect` writer) to any page's own loading-branch composition: counts and
 * booleans that decide how many placeholder cards/rows/groups a skeleton
 * draws, remembered in `localStorage` the moment the real data answers, and
 * read back the NEXT time the same route mounts — so a first-ever visit
 * renders today's fixed-guess skeleton (nothing to recall yet) and every
 * later visit's skeleton matches the page's own last-known composition
 * instead of a guess that can be 52px, or a whole card row, off.
 *
 * ⛔ NOT a general-purpose cache. Only counts, booleans and short strings
 * that describe SHAPE (how many groups, how many rows, whether a banner
 * renders) belong here — never rollout names, versions, tokens or anything
 * that answers a question about cluster state rather than about layout.
 */

const SHAPE_PREFIX = 'kuberik.skeleton-shape.v1.';

/** The only value types a remembered shape may hold — geometry, not data. */
export type ShapeValue = Record<string, number | boolean | string>;

function hasLocalStorage(): boolean {
	// SSR guard: `localStorage` does not exist during server-side rendering,
	// and reading it there throws in some runtimes rather than returning
	// `undefined` the way a plain browser global miss would.
	return typeof localStorage !== 'undefined';
}

/**
 * Remember the shape a page's skeleton should draw next time, keyed by a
 * short caller-chosen name (e.g. `'home'`, `'rollouts'`, `'activity'`). Call
 * this once the real data has settled — never speculatively, and never with
 * a value derived from a still-loading or partial answer.
 */
export function rememberShape(key: string, value: ShapeValue): void {
	if (!hasLocalStorage()) return;
	try {
		localStorage.setItem(SHAPE_PREFIX + key, JSON.stringify(value));
	} catch {
		// Private/incognito mode, or storage full: the hint just does not
		// persist, and the caller falls back to its own fixed default next
		// time — the same failure mode `GithubConnectButton`'s writer accepts.
	}
}

/**
 * Recall the last-remembered shape for `key`, or `null` on a first-ever
 * visit, a corrupted/foreign value, or when storage is unavailable (SSR,
 * private mode). Callers should treat `null` exactly like "nothing
 * remembered yet" and fall back to today's fixed-guess skeleton.
 */
export function recallShape<T extends ShapeValue = ShapeValue>(key: string): T | null {
	if (!hasLocalStorage()) return null;
	try {
		const raw = localStorage.getItem(SHAPE_PREFIX + key);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		for (const v of Object.values(parsed as Record<string, unknown>)) {
			const t = typeof v;
			if (t !== 'number' && t !== 'boolean' && t !== 'string') return null;
		}
		return parsed as T;
	} catch {
		return null;
	}
}
