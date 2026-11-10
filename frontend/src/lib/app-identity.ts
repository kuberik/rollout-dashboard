/**
 * WHICH APP — a per-app glyph you recognise before you read the name.
 * (Home v2, CRAFT-STUDY P5: Linear gives every initiative its own glyph and
 * colour, Railway a logo per service; our rows were text with the same green
 * dot on every healthy app.) Drawn by `AppGlyph.svelte`.
 *
 * An identity is a MONOGRAM (the letters carry most of it) plus one hue from
 * a small closed set. The hue is a function of the app's name only, so an app
 * looks the same on every page, every cluster and every reload.
 *
 * ── HOW THE HUES STAY OUT OF STATE'S WAY (the rule design-rollout asked for)
 *
 * The hue wheel is already spoken for by ten meanings:
 *   status  success 155 · danger 25 · stuck/warning 78 · held 48 ·
 *           checking/progress 98 · deploying/active 262        (language.css)
 *   env     dev 184 · test 222 · staging 293 · prod 323        (§2.6 seeds)
 * An app hue must sit at least `STATUS_CLEARANCE` (30°) of OKLCH hue from
 * every STATUS hue — a mark that reads as "red-ish" next to a failure is a
 * false alarm (qa6, 2026-10-10: hue 5, 20° from danger, read red) — and at
 * least `ENV_CLEARANCE` (15°) from every environment seed (identity beside
 * identity only needs to be told apart). Only three bands survive both:
 *   199–207 (sky), 308 (purple), 338–355 (rose);
 * the set takes one hue from each — 203, 308, 345 — plus a NEUTRAL identity
 * (no hue at all, the grey of the material), so four looks in all.
 * The second guard is CHROMA: an app glyph never reaches a status colour's
 * saturation. Its ink is C ≤ 0.10 and its field C ≤ 0.045, where every status
 * solid is C ≥ 0.15. The third is SHAPE: a lettered rounded square, never a
 * dot or a disc. `app-identity.test.ts` asserts all three.
 *
 * Four looks and a two-letter monogram give ~(4 × 26²) distinct marks; the
 * monogram carries most of the identity, the hue only helps.
 *
 * ⛔ NEVER REORDER `APP_HUES` (it would recolour every app). The set was
 * re-derived ONCE, on 2026-10-10, when the clearance rule changed.
 */

export const STATUS_HUES = { success: 155, danger: 25, warning: 78, held: 48, progress: 98, active: 262 } as const;
export const ENV_HUES = { dev: 184, test: 222, staging: 293, prod: 323 } as const;
/** r39 (owner 2026-11-08, coloured monograms): clearance relaxed 30/15 -> 12/9 (175 is 9° from dev 184) for the 8-hue palette; chroma caps unchanged,
 * so an identity tint still reads quieter than any state colour. */
export const STATUS_CLEARANCE = 12;
export const ENV_CLEARANCE = 9;
/** @deprecated the env clearance; kept for callers of the old name. */
export const MIN_CLEARANCE = ENV_CLEARANCE;
/** The closed set of 8 (r39 kit tokens .glyph.id0..id7). Order is the hash's order; never reorder. The neutral identity is retired. */
export const APP_HUES = [203, 345, 308, 130, 245, 175, 110, 280] as const;
export const APP_INK_CHROMA = { light: 0.1, dark: 0.085 } as const;
export const APP_FIELD_CHROMA = { light: 0.04, dark: 0.045 } as const;

export type AppIdentity = {
	/** One or two letters: `checkout-api` → `CA`, `orders` → `OR`, `hello-world` → `HW`. */
	monogram: string;
	/** null: the neutral identity (no hue). */
	hue: number | null;
};

/** FNV-1a, 32-bit. Stable across runtimes; the same name always lands on the same hue. */
function hash(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

export function monogramOf(name: string): string {
	const parts = name
		.split(/[\s._/-]+/)
		.map((p) => p.replace(/[^\p{L}\p{N}]/gu, ''))
		.filter(Boolean);
	if (parts.length === 0) return '?';
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[1][0]).toUpperCase();
}

const tokensOf = (name: string): string[] => name.split(/[\s._/-]+/).map((p) => p.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);

/**
 * QA2 #11: apps that share a default monogram ("hello-world-app" / "hello-world-manifests" are both `HW`) are told apart by the part of
 * the name that differs. A pure function of the SET of names (never of their order): for a group sharing a default monogram, the mark is
 * the initial of the last token the group's names have in common + the initial of the first token where they differ
 * (`WA` / `WM`; `hello-second-*` gives `SA` / `SM`, so the two families do not collide either). With no common token the first token's
 * first two letters, then its first letter + the differing token's initial; a name that is still not unique keeps the default.
 */
export function monogramsFor(names: readonly string[]): Map<string, string> {
	const uniq = [...new Set(names)].sort();
	const out = new Map<string, string>();
	const groups = new Map<string, string[]>();
	for (const n of uniq) { const m = monogramOf(n); out.set(n, m); (groups.get(m) ?? groups.set(m, []).get(m)!).push(n); }
	const taken = new Set([...groups.keys()].filter((k) => groups.get(k)!.length === 1));
	for (const [, g] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
		if (g.length < 2) continue;
		const toks = g.map(tokensOf);
		let c = 0;
		while (toks.every((t) => t[c] !== undefined && t[c] === toks[0][c])) c++;
		const cand = (t: string[]): string[] => {
			const d = t[c] ?? '';
			const common = c > 0 ? t[c - 1] : '';
			return [
				common && d ? common[0] + d[0] : '',
				t[0] && d ? t[0][0] + d[0] : '',
				d.slice(0, 2),
				(t[0] ?? '').slice(0, 2)
			].map((x) => x.toUpperCase()).filter((x) => x.length === 2);
		};
		const marks = toks.map(cand);
		for (let k = 0; k < 4; k++) {
			const pick = marks.map((m) => m[k]);
			if (pick.every((p) => p && !taken.has(p)) && new Set(pick).size === pick.length) {
				g.forEach((n, i) => { out.set(n, pick[i]); taken.add(pick[i]); });
				break;
			}
		}
	}
	return out;
}

export function appIdentity(name: string): AppIdentity {
	return { monogram: monogramOf(name), hue: APP_HUES[hash(name) % APP_HUES.length] };
}

/** Index into APP_HUES (0-7) = the `.app-glyph.id{n}` class in language.css. */
export function appHueIndex(name: string): number {
	return hash(name) % APP_HUES.length;
}

/** Angular distance between two hues, 0–180. */
export function hueDistance(a: number, b: number): number {
	const d = Math.abs(((a - b) % 360) + 360) % 360;
	return d > 180 ? 360 - d : d;
}
