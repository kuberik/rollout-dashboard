import { it, expect } from 'vitest';
import { laneOf } from './Footprint.svelte';
import { settledSentence } from '$lib/view-models/promotion-lanes';

/* QA #11: an env-less rollout (hello-world-manifests) has a blank place label; its lane node is named by its tier, never an empty box. */
it('laneOf names an unlabelled place by its tier', () => {
	const pl = (tier: string, label: string) => ({ env: label, label, tier, state: 'healthy', href: `/${tier}`, version: 'e7c1b60', onNewest: true, onBuild: true });
	const { lane } = laneOf({ app: 'x', newest: 'e7c1b60', placeList: [pl('dev', 'dev'), pl('staging', ''), pl('prod', '')] } as never, { apps: [] } as never, [] as never);
	expect([...lane.stages, ...lane.prod].map((n) => n.env)).toEqual(['dev', 'staging', 'prod']);
});

/* a place with no releases is drawn neutral (health only): never a "newest" node, never counted as on the newest */
const place = (tier: string, label: string, over: Record<string, unknown> = {}) => ({ env: label, label, tier, state: 'healthy', href: `/${label}`, version: 'aaa', onNewest: false, onBuild: true, currency: 'behind', ...over });
const lane2 = (placeList: unknown[], newest = 'bbb') => laneOf({ app: 'x', newest, placeList } as never, { apps: [] } as never, [{ t: 1, app: 'x', sha: 'aaa' }, { t: 2, app: 'x', sha: 'bbb' }] as never).lane;
const names = (l: ReturnType<typeof lane2>) => Object.fromEntries([...l.stages, ...l.prod].map((n) => [n.env, n.state]));

it('laneOf draws a no-release place neutral beside newest and behind places', () => {
	const l = lane2([place('dev', 'dev', { version: 'bbb', onNewest: true, currency: 'newest' }), place('staging', 'staging'), place('prod', 'prod', { version: null, currency: 'none' })]);
	expect(names(l)).toEqual({ dev: 'newest', staging: 'behind', prod: 'none' });
	expect([...l.stages, ...l.prod].find((n) => n.env === 'prod')?.noReleases).toBe(true);
});

it('laneOf lets health win over a no-release place', () => {
	const l = lane2([place('prod', 'prod', { state: 'failed', currency: 'none' })]);
	expect(names(l)).toEqual({ prod: 'failed' });
});

it('an all-no-release lane leads with none and reads "No releases yet"', () => {
	const l = lane2([place('dev', 'dev', { currency: 'none', version: 'bbb' }), place('prod', 'prod', { currency: 'none', version: 'bbb' })]);
	expect(l.state).toBe('none');
	expect(settledSentence(l, 'none')).toBe('No releases yet');
});

it('a pending lane (no flag) still reads "Nothing deployed yet"', () => {
	const l = lane2([place('dev', 'dev', { currency: 'newest', state: 'healthy', version: null, onNewest: false })]);
	expect(settledSentence({ ...l, state: 'none', lead: { ...l.lead!, state: 'none', noReleases: undefined } }, 'none')).toBe('Nothing deployed yet');
});

it('newest-everywhere is not claimed while a place has no releases', () => {
	const l = lane2([place('dev', 'dev', { version: 'bbb', onNewest: true, currency: 'newest' }), place('prod', 'prod', { currency: 'none', version: null })]);
	expect(settledSentence(l, 'newest')).not.toMatch(/everywhere/);
	const all = lane2([place('dev', 'dev', { version: 'bbb', onNewest: true, currency: 'newest' })]);
	expect(settledSentence(all, 'newest')).toBe('On the newest everywhere');
});
