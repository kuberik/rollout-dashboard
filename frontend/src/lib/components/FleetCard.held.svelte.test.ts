import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import FleetCard from './FleetCard.svelte';
import { TONE } from '$lib/view-models/state-tone';

describe('Home fleet draws a held / paused row with the /rollouts held mark', () => {
	test.each(['Held', 'Paused'] as const)('%s: StatusMark held ring (held ink on the held tint), not a neutral glyph', (word) => {
		render(FleetCard, {
			props: { trouble: [{ key: 'a', app: 'inventory-api', failing: false, mark: 'held', word, href: '/x', places: [{ tier: 'prod', place: '' }] }], deploys: [] }
		});
		const mark = document.querySelector('[data-fleet-row="trouble"] span.rounded-full');
		expect(mark).not.toBeNull();
		for (const c of TONE.held.chip.split(' ')) expect(mark!.className).toContain(c);
		expect(document.querySelector('[data-fleet-row="trouble"] svg.text-fg-muted')).toBeNull();
	});
});

describe('Home fleet draws a recovered failure as the ring', () => {
	const cls = (sel: string) => document.querySelector(`${sel} span.rounded-full`)!.className;
	test('trouble row and recent deploy: recovered = ring, failing now = solid disc', () => {
		const trouble = (key: string, recovered: boolean) => ({ key, app: key, failing: true, mark: 'failed' as const, word: recovered ? ('Failed' as const) : ('Failing' as const), href: '/x', places: [{ tier: 'prod', place: '' }], recovered });
		const deploy = (key: string, recovered: boolean) => ({ key, app: key, tier: 'prod', place: '', at: '', age: '1h', failing: true, href: '/x', recovered });
		render(FleetCard, { props: { trouble: [trouble('a', true), trouble('b', false)], deploys: [deploy('c', true), deploy('d', false)] } });
		expect(cls('[data-truth-app="a"]')).toContain('ring-[1.5px]');
		expect(cls('[data-truth-app="b"]')).toContain('bg-danger-solid');
		expect(cls('[data-truth-app="c"]')).toContain('ring-[1.5px]');
		expect(cls('[data-truth-app="d"]')).toContain('bg-danger-solid');
	});
});

describe('Home fleet words a failure by the rule', () => {
	test('Failing in danger ink, Failed in neutral ink', () => {
		const trouble = (key: string, recovered: boolean) => ({ key, app: key, failing: true, mark: 'failed' as const, word: recovered ? ('Failed' as const) : ('Failing' as const), href: '/x', places: [{ tier: 'prod', place: '' }], recovered });
		render(FleetCard, { props: { trouble: [trouble('a', true), trouble('b', false)], deploys: [] } });
		const w = (app: string) => document.querySelector(`[data-truth-app="${app}"] [data-fleet-word]`)!;
		expect(w('a').className).toContain('text-fg-muted');
		expect(w('b').className).toContain('text-danger');
		expect(w('b').className).not.toContain('text-fg-muted');
	});
});

describe('Home fleet: two places of one tier with no region (the same app in two namespaces)', () => {
	test('both chips draw (a keyed each would throw on the repeated tier+place)', () => {
		render(FleetCard, {
			props: { trouble: [{ key: 'a', app: 'api', failing: false, mark: 'held', word: 'Held', href: '/x', places: [{ tier: 'staging', place: '' }, { tier: 'staging', place: '' }] }], deploys: [] }
		});
		expect(document.querySelectorAll('[data-fleet-row="trouble"] [data-chip], [data-fleet-row="trouble"] .flex.shrink-0 > *').length).toBeGreaterThanOrEqual(2);
	});
});
