import { describe, expect, it } from 'vitest';
import { diffLinkNeeds, diffResolves } from './diff-link';
import { respond } from '$lib/demo/respond';
import { historyAtLimit } from '$lib/history-marks';
import type { Rollout } from '../../types';

const h = (...tags: string[]) => tags.map((tag) => ({ version: { tag } }));

describe('diffLinkNeeds', () => {
	it('needs both builds for a change (newest first)', () => {
		expect(diffLinkNeeds({ history: h('b', 'a'), index: 0, atLimit: false })).toEqual(['a', 'b']);
	});
	it('needs only this build for a first deploy', () => {
		expect(diffLinkNeeds({ history: h('b', 'a'), index: 1, atLimit: false })).toEqual(['a']);
	});
	it('has nothing to diff for the oldest kept entry, a redeploy or an unknown index', () => {
		expect(diffLinkNeeds({ history: h('b', 'a'), index: 1, atLimit: true })).toBeNull();
		expect(diffLinkNeeds({ history: h('a', 'a'), index: 0, atLimit: false })).toBeNull();
		expect(diffLinkNeeds({ history: h('a'), index: 3, atLimit: false })).toBeNull();
	});
});

describe('diffResolves', () => {
	it('is true only when every needed manifest has files', () => {
		expect(diffResolves(['a', 'b'], [{ x: '1' }, { y: '2' }])).toBe(true);
		expect(diffResolves(['a', 'b'], [{ x: '1' }, null])).toBe(false);
		expect(diffResolves(['a', 'b'], [{ x: '1' }])).toBe(false);
		expect(diffResolves(null, [])).toBe(false);
	});
});

/**
 * qa11 B3: History never linked to a diff in the demo, because the link was
 * gated on `status.artifactType`. Walk every mock rollout's History and check
 * that each entry whose diff resolves against the mock's own manifest route
 * gets a link, and that at least one does (the demo must show the feature).
 */
describe('qa11 B3: every History entry with a resolvable diff links to it', () => {
	const body = (r: ReturnType<typeof respond>) => JSON.parse(r.body ?? '{}');
	const manifest = (ns: string, name: string, tag: string) =>
		(body(respond('GET', `/api/rollouts/${ns}/${name}/manifest/${encodeURIComponent(tag)}`))
			.files ?? null) as Record<string, string> | null;

	const rollouts: Rollout[] = body(respond('GET', '/api/rollouts')).rollouts?.items ?? [];

	it('finds rollouts with history in the mock', () => {
		expect(rollouts.some((r) => (r.status?.history?.length ?? 0) > 1)).toBe(true);
	});

	it('links exactly the entries whose manifests resolve, and some do', () => {
		let linked = 0;
		for (const r of rollouts) {
			const ns = r.metadata?.namespace ?? '';
			const name = r.metadata?.name ?? '';
			const history = r.status?.history ?? [];
			const atLimit = historyAtLimit(r);
			history.forEach((_, index) => {
				const needs = diffLinkNeeds({ history, index, atLimit });
				const files = (needs ?? []).map((t) => manifest(ns, name, t));
				const shown = diffResolves(needs, files);
				const expected = !!needs && files.length > 0 && files.every((f) => f != null);
				expect(shown, `${ns}/${name} #${index}`).toBe(expected);
				if (shown) linked++;
			});
		}
		expect(linked).toBeGreaterThan(0);
	});
});
