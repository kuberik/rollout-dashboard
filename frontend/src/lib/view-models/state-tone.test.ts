import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { TONE, toneOf, toneInk, hueInk, type ToneState } from './state-tone';

const ROOT = join(__dirname, '..');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const SOURCES = [...walk(ROOT), ...walk(join(ROOT, '../routes'))].filter((f) => /\.(svelte|ts)$/.test(f) && !/\.test\.|\.svelte\.test\./.test(f) && !f.includes('/paraglide/'));
const src = (f: string) => readFileSync(f, 'utf8');
const rel = (f: string) => relative(ROOT, f);
const SKIP = (f: string) => f.includes('/paraglide/');

const STATES = Object.keys(TONE) as ToneState[];

describe('the state-tone table', () => {
	it('gives every state one hue, one ink and one chip', () => {
		for (const s of STATES) {
			expect(TONE[s].solid).toMatch(/^var\(--k-/);
			expect(TONE[s].ink).toMatch(/^text-/);
			expect(TONE[s].chip.length).toBeGreaterThan(0);
		}
	});
	it('approval and held are one orange; stuck is warning; failed is danger; healthy is a calm green', () => {
		expect(TONE.approval.solid).toBe(TONE.held.solid);
		expect(TONE['approval-yours'].solid).toBe(TONE.approval.solid);
		expect(TONE['approval-yours'].ring).not.toBeNull();
		expect(TONE.approval.ring).toBeNull();
		expect(TONE.stuck.hue).toBe('warning');
		expect(TONE.failed.hue).toBe('danger');
		expect(TONE.done.solid).toBe('var(--k-success-solid)');
		expect(TONE.notreached.shape).toBe('ring');
	});
	it('folds the product spellings into the keys and knows nothing else', () => {
		expect(toneOf('failing')).toBe('failed');
		expect(toneOf('awaiting-approval')).toBe('approval');
		expect(toneOf('approval-yours')).toBe('approval-yours');
		expect(toneOf('deployed')).toBe('done');
		expect(toneOf('baking')).toBe('checking');
		expect(toneOf('mystery')).toBeNull();
		expect(toneInk('mystery')).toBe('text-fg-muted');
		expect(toneInk('deploying')).toBe('text-active');
		expect(toneInk('checking')).toBe('text-progress');
		expect(hueInk('danger')).toBe('text-danger');
	});
});

describe('the strand dots (.st-*) read the table', () => {
	const css = readFileSync(join(ROOT, '../styles/language.css'), 'utf8') + readFileSync(join(ROOT, 'components/new/MiniPipeline.svelte'), 'utf8');
	const rule = (name: string) => new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
	it.each([
		['st-done', TONE.done.solid],
		['st-todo', TONE.notreached.solid],
		['st-active', TONE.deploying.solid],
		['st-check', TONE.checking.solid],
		['st-hold', TONE.held.solid],
		['st-fail', TONE.failed.solid],
		// the rollouts-list strand (MiniPipeline) draws done / not-started / approval with its own classes
		['mp-done', TONE.done.solid],
		['mp-ring-off', TONE.notreached.solid],
		['mp-ask', TONE.approval.solid]
	])('.%s paints with the table colour', (name, solid) => {
		expect(rule(name)).toContain(solid);
	});
});

describe('one table, no local maps', () => {
	// a map that spells the state inks out again; none is left outside state-tone.ts
	/* hue- or bakeStatus-keyed maps the table does not own yet (the 2026-11-13 pass 3 moved the state-keyed ones): each is a leftover, not a pattern to copy */
	const PENDING = new Set<string>([
		'components/LogsViewer.svelte', // liveMark tone -> dot
		'components/SectionHeader.svelte', // Tone (hue) -> dot, rollup ink
		'components/Toast.svelte', // toast tone -> ink
		'components/atoms/RegionMeter.svelte', // CSS vars per hue
		'components/new/EnvStateBar.svelte', // CSS vars for the bar
		'components/new/Slipway.svelte', // sub-row tone -> ink
		'../routes/rollouts/[cluster]/[namespace]/[name]/+page.svelte',
		'../routes/rollouts/[cluster]/[namespace]/[name]/diff/[version]/+page.svelte'
	]);
	const INKS = ['text-danger', 'text-held', 'text-active', 'text-progress'];
	it('no file outside state-tone.ts spells out 3 of the 4 state inks inside a 6-line window', () => {
		const bad: string[] = [];
		for (const f of SOURCES) {
			if (rel(f) === 'view-models/state-tone.ts' || PENDING.has(rel(f))) continue;
			const lines = src(f).split('\n');
			for (let i = 0; i < lines.length; i++) {
				const win = lines.slice(i, i + 6).join('\n');
				if (INKS.filter((k) => new RegExp(`['"\`]${k}['"\`]`).test(win)).length >= 3) { bad.push(`${rel(f)}:${i + 1}`); break; }
			}
		}
		expect(bad).toEqual([]);
	});
	it('no file outside state-tone.ts keeps a second map of the state SOLIDS (bg-*-solid / var(--k-*-solid)) inside a 6-line window', () => {
		const SOL = ['danger', 'progress', 'active', 'success', 'held', 'warning'];
		const bad: string[] = [];
		for (const f of SOURCES) {
			if (rel(f) === 'view-models/state-tone.ts' || PENDING.has(rel(f))) continue;
			const lines = src(f).split('\n');
			for (let i = 0; i < lines.length; i++) {
				const win = lines.slice(i, i + 6).join('\n');
				if (SOL.filter((k) => win.includes(`bg-${k}-solid`) || win.includes(`--k-${k}-solid`)).length >= 3) { bad.push(`${rel(f)}:${i + 1}`); break; }
			}
		}
		expect(bad).toEqual([]);
	});
	it('no file outside state-tone.ts keeps a second map of the state inks (text-*) over 2 of the hues in one switch/record', () => {
		const bad: string[] = [];
		for (const f of SOURCES) {
			if (rel(f) === 'view-models/state-tone.ts' || PENDING.has(rel(f))) continue;
			const lines = src(f).split('\n');
			for (let i = 0; i < lines.length; i++) {
				if (!/(switch \(|Record<|: \{$|= \{$)/.test(lines[i])) continue;
				const win = lines.slice(i, i + 12).join('\n');
				if (['danger', 'progress', 'active', 'success'].filter((k) => new RegExp(`['"\`](?:text|bg|ring)-${k}(?:-solid)?['"\`]`).test(win)).length >= 2) { bad.push(`${rel(f)}:${i + 1}`); break; }
			}
		}
		expect(bad).toEqual([]);
	});
	it('no strip surface imports StatusMark (icons never sit in a strip box)', () => {
		for (const f of ['components/EnvRow.svelte', 'components/ChangeDot.svelte', 'components/SiteMark.svelte', 'components/PromotionLane.svelte', 'components/RepoCells.svelte', 'components/EnvSitePicker.svelte', 'components/new/env/GangwayTile.svelte']) {
			expect(src(join(ROOT, f)), f).not.toMatch(/import StatusMark|<StatusMark/);
		}
	});
	it('the palette change row and the strip surfaces draw WaveMark', () => {
		expect(src(join(ROOT, 'CommandPalette.svelte'))).toMatch(/<WaveMark/);
		expect(src(join(ROOT, 'components/EnvRow.svelte'))).toMatch(/<WaveMark/);
		expect(src(join(ROOT, 'components/ChangeDot.svelte'))).toMatch(/<WaveMark/);
		expect(src(join(ROOT, 'components/SiteMark.svelte'))).toMatch(/<WaveMark/);
	});
});
