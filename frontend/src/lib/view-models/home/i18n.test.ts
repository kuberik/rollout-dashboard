import { afterEach, describe, expect, it } from 'vitest';
import { setDisplayTimeZone } from '$lib/timezone.svelte';
import { holdPhrase, type HoldReason } from '../home-model';
import { signalEvidence } from '../fleet-signals';
import { formatWhen } from './field-model';
import { watchSub } from './lumen';
import type { Watch } from './tarn-model';

/**
 * Home words every model fact through paraglide from structured data
 * (`Signal.facts`, `NeedsYouEntry.facts`, `Watch.facts`); nothing on the
 * Home path parses an English sentence. These pin the cases the incident
 * fixture does not reach.
 */
afterEach(() => setDisplayTimeZone('local'));

const watch = (facts: Watch['facts'], over: Partial<Watch> = {}): Watch => ({
	key: 'k',
	kind: 'held',
	app: 'shop-api',
	appHref: '/apps/shop-api',
	places: ['dev'],
	place: 'dev',
	evidence: '',
	facts,
	age: '',
	ageMs: 0,
	href: '/',
	sev: 3,
	...over
});

describe('holdPhrase', () => {
	it('words every hold reason', () => {
		const all: HoldReason[] = [
			'failed-healthcheck',
			'failed-deploy',
			'stuck',
			'approval',
			'dependency',
			'order',
			'clock',
			'check',
			'pinned',
			'rule'
		];
		expect(all.map(holdPhrase)).toEqual([
			'failed its health check',
			'failed to deploy',
			'is stuck',
			'waits for approval',
			'waits on a dependency',
			'waits on promotion order',
			'waits for a deploy window',
			'waits on a check',
			'is pinned',
			'waits on a rule'
		]);
	});
});

describe('watchSub from facts', () => {
	it('a held line drops "waits" only where the clause is "waits on …"', () => {
		expect(watchSub(watch({ kind: 'held', reason: 'dependency' }, { age: '6h' }))).toBe(
			' · on a dependency · 6h'
		);
		expect(watchSub(watch({ kind: 'held', reason: null }))).toBe(' · on a rule');
		expect(watchSub(watch({ kind: 'held', reason: 'pinned' }))).toBe(' · is pinned');
		expect(watchSub(watch({ kind: 'held', reason: 'clock' }))).toBe(' · waits for a deploy window');
	});

	it('a failing check is named without the app prefix; no name reads "health check"', () => {
		const sig = (check: string | null) =>
			watch(
				{ kind: 'signal', signal: { kind: 'check-failing', check } },
				{ kind: 'failed', age: '30m' }
			);
		expect(watchSub(sig('shop-api-latency'))).toBe(' · latency check · 30m');
		expect(watchSub(sig('p99-latency'))).toBe(' · p99-latency check · 30m');
		expect(watchSub(sig(null))).toBe(' · health check · 30m');
	});

	it('a failed place with no signal says what failed, once', () => {
		expect(watchSub(watch({ kind: 'failed-env' }, { kind: 'failed', age: '2m' }))).toBe(
			' · failed its health check · 2m'
		);
	});

	it('the other signals print their own evidence', () => {
		const sub = (signal: Parameters<typeof signalEvidence>[0]) =>
			watchSub(watch({ kind: 'signal', signal }, { kind: 'checking' }));
		expect(sub({ kind: 'slow-bake', spanMs: 75 * 60e3, bakeTimeMs: 60 * 60e3 })).toBe(
			' · 75m, set to 60m'
		);
		expect(sub({ kind: 'long-wait', waitedMs: 2 * 3600e3, usualMs: 20 * 60e3 })).toBe(
			' · waiting 2h, usually 20m'
		);
		expect(sub({ kind: 'check-flapping', check: 'latency', failures: 2, spanMs: 40 * 60e3 })).toBe(
			' · latency 2× in 40m, expected 0'
		);
		expect(sub({ kind: 'check-recovered', failedAgoMs: 3 * 60e3 })).toBe(
			' · failed 3m ago, recovered'
		);
		expect(sub({ kind: 'failed', failure: 'deploy' })).toBe(' · failed to deploy');
	});
});

describe('formatWhen', () => {
	const now = new Date('2026-10-24T18:00:00Z');
	it('reads today, yesterday, this week and older in the display zone', () => {
		setDisplayTimeZone('utc');
		expect(formatWhen('2026-10-24T15:17:00Z', now)).toBe('15:17');
		expect(formatWhen('2026-10-23T15:17:00Z', now)).toBe('yesterday 15:17');
		expect(formatWhen('2026-10-20T15:17:00Z', now)).toBe('Tue 15:17');
		expect(formatWhen('2026-10-12T15:17:00Z', now)).toBe('12 Oct 15:17');
	});

	it('follows the display-zone toggle across a day boundary', () => {
		setDisplayTimeZone('utc');
		expect(formatWhen('2026-10-23T23:30:00Z', new Date('2026-10-24T00:10:00Z'))).toBe(
			'yesterday 23:30'
		);
	});
});
