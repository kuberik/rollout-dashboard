/**
 * AVATAR COLOUR — one hashed, filled identity colour per person, shared by
 * the product (`Avatar.svelte`'s no-`src` fallback) and the demo
 * (`demo/github-data.ts`'s generated author pictures), so a demo author
 * drawn from a `data:image/svg+xml` URI and a real person who simply has no
 * GitHub picture render as the SAME thing: a filled disc, same hash, same
 * palette, same hue for the same name on either path.
 *
 * ⭐ WHY THIS MOVED OUT OF `github-data.ts` (dialogs AD round 7, composite
 * `AD-dialogs-r7-C4-initial-avatar.png`, 2026-10-11). Before this file, the
 * demo's commit/change authors (an `avatarDataUri` SVG) were FILLED discs in
 * a hashed colour, while every other no-photo person in the product
 * (`Avatar.svelte`'s own monogram, used whenever a caller has no picture to
 * pass — e.g. an activity row's actor, `ControlCenter.svelte`'s
 * `avatarForLogin` deliberately answers `undefined` for everyone but the
 * signed-in user) drew an UNFILLED neutral outline disc instead. Same
 * person, two different fallback styles depending on which code path drew
 * them — `jmatthews` read as a photo-less stranger next to `P`/`A`/`M`'s
 * confident filled discs in the same dialog tile row, purely because of
 * which renderer happened to draw that particular avatar. `jmatthews` was
 * never missing a colour on purpose — it was always going through the
 * component's own fallback, which simply had no colour to give. One shared
 * module, one hash, one palette: now every no-photo person — demo or real —
 * gets the identical filled disc.
 *
 * ⛔ PLAIN NODE, NO FRAMEWORK IMPORT. `github-data.ts` is bundled into the
 * browser for the static demo build exactly like the rest of `demo/*.ts`
 * (no `$lib` alias resolution guaranteed there — see that file's own
 * "nothing node-specific" note) and is also loaded directly from plain Node
 * by non-Vite scripts. It imports this file by a RELATIVE path
 * (`../avatar-colors`), not `$lib/avatar-colors` — so this module must never
 * import `$lib/*` either, or that chain breaks. `Avatar.svelte` is free to
 * import it via `$lib/avatar-colors` instead.
 *
 * ── THE PALETTE'S TWO CONSTRAINTS (both enforced by `avatar-colors.test.ts`)
 *
 * (a) HUE CLEARANCE — identity never reads as state. `app-identity.ts` owns
 *     the product's hue budget: `STATUS_HUES`/`ENV_HUES`, cleared by
 *     `STATUS_CLEARANCE` (30°) / `ENV_CLEARANCE` (15°) respectively, both
 *     measured in OKLCH hue (not CSS HSL — see that file's own comment for
 *     why hue math has to happen in OKLCH at all: the two disagree by tens
 *     of degrees in the blues/violets). Solving both clearances at once
 *     leaves almost nothing on the wheel: `app-identity.ts`'s own comment
 *     already names the surviving bands (199–207, 308, 338–355) for its app
 *     glyphs, and with a safety margin against sRGB round-off the single
 *     point at 308 disappears entirely — leaving two usable bands, ~201–205
 *     and ~340–353. Every colour below sits inside one of those two.
 *
 * (b) LIGHTNESS / CONTRAST — separate from the dark card, hold the white
 *     monogram. The old palette's `#261386` (navy violet, OKLCH L≈0.33) sat
 *     only ~0.1 above the dark surface token's own L (`--k-surface` in dark
 *     mode is `oklch(0.236 0.016 222)`) and gave its white initial barely
 *     2.6:1 contrast — both found live on `AD-dialogs-r7`'s dark-mode shot.
 *     Every entry below keeps OKLCH L − 0.236 ≥ 0.2 (clears the dark
 *     surface) and White-vs-disc WCAG contrast ≥ 3:1 (keeps the monogram
 *     legible); both are asserted in the test, not just eyeballed.
 *
 * `avatarColor(name)` is the ONLY way either renderer picks a colour — never
 * reorder `PALETTE` (it would recolour every person already on screen).
 */

/** FNV-1a, 32-bit. The same algorithm `app-identity.ts`'s own app hash uses
 *  (kept independent rather than imported, since the two hash different
 *  kinds of name and must never be forced to collide by sharing a function
 *  whose rounding or seed could drift between the two call sites). Stable
 *  across runtimes: the same name always lands on the same colour. */
function hash(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/**
 * Seven filled discs, two hue families (a cool "sky" pair near 203°, five
 * warmer "rose/plum" entries near 346°) — the only hue bands that clear both
 * `STATUS_HUES` and `ENV_HUES` with a safety margin (see the module doc).
 * Varying lightness/chroma within each family is what keeps the seven
 * perceptually distinct, since the hue itself has almost no room to move.
 */
export const AVATAR_PALETTE = [
	'#007680', // sky, deep teal — h203 L0.50 C0.12
	'#0e919c', // sky, lighter teal — h204 L0.60 C0.10
	'#9e427c', // plum — h344 L0.52 C0.14
	'#a85e88', // dusty rose — h346 L0.58 C0.11
	'#96286a', // deep magenta — h348 L0.47 C0.16
	'#b37291', // light mauve — h350 L0.63 C0.09
	'#a34f87' // medium mauve — h342 L0.55 C0.13
] as const;

/** The one function either renderer calls: same name, same colour, always. */
export function avatarColor(name: string): string {
	return AVATAR_PALETTE[hash(name) % AVATAR_PALETTE.length];
}
