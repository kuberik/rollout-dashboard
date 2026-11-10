import { afterEach, describe, expect, it } from 'vitest';
import { setDisplayTimeZone } from '$lib/timezone.svelte';
import { holdPhrase, type HoldReason } from '../home-model';
import { signalEvidence } from '../fleet-signals';

/**
 * Home words every model fact through paraglide from structured data
 * (`Signal.facts`, `NeedsYouEntry.facts`); nothing on the
 * Home path parses an English sentence. These pin the cases the incident
 * fixture does not reach.
 */
afterEach(() => setDisplayTimeZone('local'));


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

