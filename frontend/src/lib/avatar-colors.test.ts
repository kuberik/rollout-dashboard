import { describe, expect, it } from 'vitest';
import {
	ENV_CLEARANCE,
	ENV_HUES,
	STATUS_CLEARANCE,
	STATUS_HUES,
	hueDistance
} from './app-identity';
import { AVATAR_PALETTE, avatarColor } from './avatar-colors';
import { respondGithub } from './demo/github-data';
import { DEMO_LOGIN } from './demo/github-data';

// ── sRGB <-> OKLCH, pure math, no deps — mirrors the conversion used to pick
// the palette (see avatar-colors.ts's own doc comment) so the test measures
// the SAME space the design constraints are stated in, not CSS hex by eye.

function hexToSrgb(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	return [
		parseInt(h.slice(0, 2), 16) / 255,
		parseInt(h.slice(2, 4), 16) / 255,
		parseInt(h.slice(4, 6), 16) / 255
	];
}

function srgbToLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
	const x = Math.max(0, Math.min(1, c));
	return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** Relative luminance, WCAG's own formula — used for the white-contrast check. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
	const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function wcagContrast(l1: number, l2: number): number {
	const a = Math.max(l1, l2) + 0.05;
	const b = Math.min(l1, l2) + 0.05;
	return a / b;
}

/** sRGB hex -> OKLCH, via OKLab (Björn Ottosson's matrices). */
function hexToOklch(hex: string): { l: number; c: number; h: number } {
	const [r, g, b] = hexToSrgb(hex).map(srgbToLinear);
	const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
	const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
	const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
	const C = Math.sqrt(a * a + bb * bb);
	let H = (Math.atan2(bb, a) * 180) / Math.PI;
	if (H < 0) H += 360;
	return { l: L, c: C, h: H };
}

// `--k-surface` in dark mode (styles/language.css): oklch(0.236 0.016 222).
const DARK_SURFACE_L = 0.236;
const WHITE: [number, number, number] = [1, 1, 1];

describe('AVATAR_PALETTE — hue clearance', () => {
	it.each(AVATAR_PALETTE.map((hex) => [hex]))(
		'%s clears every status hue by >= %i° and every env hue by >= %i°',
		(hex) => {
			const { h } = hexToOklch(hex);
			for (const r of Object.values(STATUS_HUES)) {
				expect(hueDistance(h, r)).toBeGreaterThanOrEqual(STATUS_CLEARANCE);
			}
			for (const r of Object.values(ENV_HUES)) {
				expect(hueDistance(h, r)).toBeGreaterThanOrEqual(ENV_CLEARANCE);
			}
		}
	);
});

describe('AVATAR_PALETTE — legibility', () => {
	it.each(AVATAR_PALETTE.map((hex) => [hex]))(
		'%s separates from the dark card (ΔL >= 0.2) and holds a white monogram (>= 3:1)',
		(hex) => {
			const { l } = hexToOklch(hex);
			expect(l - DARK_SURFACE_L).toBeGreaterThanOrEqual(0.2);

			const lum = relativeLuminance(hexToSrgb(hex));
			const contrast = wcagContrast(relativeLuminance(WHITE), lum);
			expect(contrast).toBeGreaterThanOrEqual(3);
		}
	);

	it('never repeats the old, rejected colour (#261386 — too dark, too close to staging)', () => {
		expect(AVATAR_PALETTE).not.toContain('#261386');
	});
});

describe('avatarColor', () => {
	it('is stable: the same name always lands on the same colour', () => {
		expect(avatarColor('jmatthews')).toBe(avatarColor('jmatthews'));
		expect(avatarColor('danielreed')).toBe(avatarColor('danielreed'));
	});

	it('only ever answers from the closed palette', () => {
		for (const n of ['jmatthews', 'sam-oliver', 'mark-collins', 'paul-stevens', 'nick-keller', 'anna-ward', 'tom-becker', 'danielreed', 'a-real-user-with-no-picture']) {
			expect(AVATAR_PALETTE).toContain(avatarColor(n));
		}
	});

	it('spreads a small roster over more than one colour', () => {
		const names = ['sam-oliver', 'jmatthews', 'mark-collins', 'paul-stevens', 'nick-keller', 'anna-ward', 'tom-becker'];
		expect(new Set(names.map(avatarColor)).size).toBeGreaterThanOrEqual(2);
	});
});

describe('avatarColor matches the demo', () => {
	it("every demo author's generated SVG fill is exactly avatarColor(author)", () => {
		const res = respondGithub(
			'GET',
			'/api/rollouts/default/hello-world/commits',
			new URLSearchParams({ base: 'a1b2c3d', head: 'f68d0ac' })
		);
		expect(res).not.toBeNull();
		const body = JSON.parse(res!.body) as { commits: { author: string; avatarUrl: string }[] };
		expect(body.commits.length).toBeGreaterThan(0);
		let checkedAGeneratedOne = false;
		for (const c of body.commits) {
			// The signed-in person's commits carry their real photo (a JPEG data
			// URI), never the generated SVG — see github-data.ts's `avatarFor`.
			if (c.author === DEMO_LOGIN) continue;
			const svg = decodeURIComponent(c.avatarUrl.replace('data:image/svg+xml;utf8,', ''));
			const fill = svg.match(/fill="(#[0-9a-fA-F]{6})"/)?.[1];
			expect(fill).toBe(avatarColor(c.author));
			checkedAGeneratedOne = true;
		}
		expect(checkedAGeneratedOne).toBe(true);
	});
});
