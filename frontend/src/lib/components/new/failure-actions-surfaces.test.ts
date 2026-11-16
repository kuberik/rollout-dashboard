/**
 * A recovered failure leads with Retry on every surface that offers an action for a failed place; a failure still failing keeps
 * Roll back first. The order is decided once (view-models/failure-actions.ts); each surface must route its actions through it.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { respond } from '../../demo/respond';
import { resetDemoState } from '../../demo/state';
import { install } from '../../demo/health-failures-fixtures';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { rolloutsPage, bannerOf } from './rollouts-page';

const src = (f: string) => readFileSync(resolve(__dirname, '..', '..', f), 'utf8');

describe('the banner and card models carry the recovered flag the action order reads', () => {
	beforeAll(() => install(true));
	afterEach(() => installLiveSource(null));
	it('bannerOf and the failed attention cards agree with the row', () => {
		resetDemoState('calm');
		const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
		const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
		const hc = JSON.parse(respond('GET', '/api/health-checks').body ?? 'null');
		installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: hc?.rolloutHealthChecks?.items ?? null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as never);
		const failed = rolloutsPage('calm').attention.filter((a) => a.model.state === 'failed');
		expect(failed.some((a) => a.model.recovered)).toBe(true);
		expect(failed.some((a) => !a.model.recovered)).toBe(true);
		for (const a of failed) expect(bannerOf(a.row).recovered).toBe(!!a.row.failure?.recovered);
	});
});

describe('every surface routes its failure actions through the one order', () => {
	it.each([
		['components/new/app/AppDetail.svelte', /failureActs<Act>\(failureRecovered\(/],
		['components/new/change/ChangeDetail.svelte', /failureActs<Act>\(!!lead\?\.row\?\.failure\?\.recovered/],
		['components/new/FailureBanner.svelte', /failureActs<Act>\(!!b\.recovered/],
		['components/new/Facia.svelte', /failureActs<Act>\(recoveredFail/],
		['CommandPalette.svelte', /failedRowAction\(failureRecovered\(/]
	])('%s', (f, re) => {
		expect(src(f)).toMatch(re);
	});
	it('AttentionCard offers Retry first only for a recovered failure, as the primary', () => {
		const s = src('components/AttentionCard.svelte');
		expect(s).toMatch(/retryLead = \$derived\(failed && model\.recovered && !!retryHref\)/);
		expect(s.indexOf('data-action="retry"')).toBeGreaterThan(0);
		expect(s.indexOf('data-action="retry"')).toBeLessThan(s.indexOf('data-action="rollback"'));
		expect(s).toMatch(/class="btn btn-primary" data-action="retry"/);
	});
	it('every AttentionCard caller hands it the rollout Retry goes to', () => {
		for (const f of ['components/new/Home.svelte', 'components/new/Rollouts.svelte', 'components/new/Changes.svelte', 'components/new/env/EnvPage.svelte']) expect(src(f), f).toMatch(/retryHref=\{a\.(href|retryHref)\}/);
	});
	it('the History and Gates tab header leads with Retry when the failure recovered', () => {
		const s = src('components/RolloutTabHeader.svelte');
		expect(s).toMatch(/const recovered = \$derived\(isFailed && failureRecovered\(/);
		expect(s.indexOf('data-action="retry"')).toBeLessThan(s.indexOf('Roll back to {rollbackDisplay}'));
	});
});
