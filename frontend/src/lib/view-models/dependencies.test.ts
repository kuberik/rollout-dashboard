import { describe, it, expect } from 'vitest';
import {
	buildOrder,
	chain,
	chainOrder,
	contractBlocks,
	currentEntry,
	displayOfTag,
	hopBetween,
	isReady,
	isSatisfied,
	rankOfTag,
	splitBlocked,
	type EnvInfo
} from './dependencies';
import type { RolloutDependency } from '../../types';

/**
 * The live hub's own numbers, so the fixtures below are not invented.
 * `hello-frontend-app` publishes its releases OLDEST-FIRST, which is the
 * assumption the page this replaces got wrong.
 */
const LIVE_RELEASES = [
	{ tag: 'rel-2', version: '2.1.0-2', created: '2026-07-29T15:20:18Z' },
	{ tag: 'rel-63', version: '2.63.0-63', created: '2026-07-29T16:53:38Z' },
	{ tag: 'rel-64', version: '2.64.0-64', created: '2026-07-29T16:54:14Z' },
	{ tag: 'rel-66', version: '2.66.0-66', created: '2026-07-29T16:58:53Z' }
];

function dep(over: Partial<RolloutDependency> & { ns: string }): RolloutDependency {
	const { ns, ...rest } = over;
	return {
		metadata: { name: 'hello-frontend-needs-api', namespace: ns },
		// EXACTLY THE SHAPE THE API SERVES. `spec.contract` and
		// `spec.providerRef.namespace` are resolved server-side, so they are
		// non-optional here and the view-model never re-derives them.
		spec: {
			rolloutRef: { name: 'hello-frontend-app' },
			providerRef: { name: 'hello-api-app', namespace: ns },
			contract: 'api'
		},
		status: {
			providedVersion: '1.66.0',
			providedTag: 'rel-66',
			admittedVersions: ['rel-63', 'rel-64', 'rel-66'],
			blockedReleases: [
				{ tag: 'rel-2', requiredVersion: '1.1.0', reason: 'ConstraintNotSatisfied' }
			],
			conditions: [
				{ type: 'Ready', status: 'True', reason: 'GateSynced' },
				{ type: 'Satisfied', status: 'True', reason: 'DependencySatisfied' }
			],
			gateName: 'dependency-hello-frontend-needs-api'
		},
		...rest
	} as RolloutDependency;
}

describe('conditions', () => {
	it('reads Satisfied and Ready', () => {
		expect(isSatisfied(dep({ ns: 'a' }))).toBe(true);
		expect(isReady(dep({ ns: 'a' }))).toBe(true);
	});

	it('an absent condition is not True', () => {
		const d = dep({ ns: 'a' });
		d.status!.conditions = [];
		expect(isSatisfied(d)).toBe(false);
		expect(isReady(d)).toBe(false);
	});
});

describe('buildOrder - derived from `created`, never from array order', () => {
	it('reverses the live cluster, which serves oldest-first', () => {
		expect(buildOrder(LIVE_RELEASES).map((b) => b.tag)).toEqual([
			'rel-66',
			'rel-64',
			'rel-63',
			'rel-2'
		]);
	});

	it('ranks newest at 0', () => {
		const o = buildOrder(LIVE_RELEASES);
		expect(rankOfTag(o, 'rel-66')).toBe(0);
		expect(rankOfTag(o, 'rel-2')).toBe(3);
	});

	it('prints the version, not the tag, when the release carries one', () => {
		const o = buildOrder(LIVE_RELEASES);
		expect(displayOfTag(o, 'rel-66')).toBe('2.66.0-66');
	});

	it('falls back to the tag for a build it has never seen', () => {
		expect(displayOfTag(buildOrder(LIVE_RELEASES), 'rel-999')).toBe('rel-999');
	});

	it('returns -1 rather than a fabricated rank for an unknown tag', () => {
		expect(rankOfTag(buildOrder(LIVE_RELEASES), 'rel-999')).toBe(-1);
		expect(rankOfTag(buildOrder(LIVE_RELEASES), null)).toBe(-1);
	});

	it('keeps a stable order when no release carries a created time', () => {
		const o = buildOrder([{ tag: 'a' }, { tag: 'b' }, { tag: 'c' }]);
		expect(o.map((b) => b.tag)).toEqual(['c', 'b', 'a']);
	});

	it('sorts dated releases ahead of undated ones', () => {
		const o = buildOrder([{ tag: 'x' }, { tag: 'y', created: '2026-01-01T00:00:00Z' }]);
		expect(o.map((b) => b.tag)).toEqual(['y', 'x']);
	});

	it('is empty and does not throw with no releases', () => {
		expect(buildOrder(null)).toEqual([]);
		expect(buildOrder(undefined)).toEqual([]);
	});
});

describe('splitBlocked - only a build someone WANTS is adverse', () => {
	const order = buildOrder(LIVE_RELEASES);

	it('the live case is NOT adverse: rel-2 is older than the deployed rel-66', () => {
		const s = splitBlocked(
			[{ tag: 'rel-2', requiredVersion: '1.1.0' }],
			order,
			'rel-66'
		);
		expect(s.wanted).toEqual([]);
		expect(s.past).toHaveLength(1);
	});

	it('a blocked build NEWER than what is deployed is adverse', () => {
		const s = splitBlocked([{ tag: 'rel-66', requiredVersion: '^2.0.0' }], order, 'rel-63');
		expect(s.wanted.map((b) => b.tag)).toEqual(['rel-66']);
		expect(s.past).toEqual([]);
	});

	it('the build currently deployed is never "wanted"', () => {
		const s = splitBlocked([{ tag: 'rel-66' }], order, 'rel-66');
		expect(s.wanted).toEqual([]);
		expect(s.past.map((b) => b.tag)).toEqual(['rel-66']);
	});

	it('everything is wanted when the environment has never deployed', () => {
		const s = splitBlocked([{ tag: 'rel-2' }, { tag: 'rel-66' }], order, null);
		expect(s.wanted).toHaveLength(2);
		expect(s.past).toEqual([]);
	});

	it('a blocked tag off the ladder is WANTED, never silently dropped', () => {
		const s = splitBlocked([{ tag: 'rel-999' }], order, 'rel-66');
		expect(s.wanted.map((b) => b.tag)).toEqual(['rel-999']);
	});

	it('orders wanted builds newest-first', () => {
		const s = splitBlocked([{ tag: 'rel-63' }, { tag: 'rel-66' }, { tag: 'rel-64' }], order, 'rel-2');
		expect(s.wanted.map((b) => b.tag)).toEqual(['rel-66', 'rel-64', 'rel-63']);
	});

	it('handles an absent blockedReleases list', () => {
		expect(splitBlocked(undefined, order, 'rel-66')).toEqual({ wanted: [], past: [] });
	});
});

describe('contractBlocks', () => {
	const order = buildOrder(LIVE_RELEASES);
	const envOf = (ns: string) =>
		({ 'hello-dep-dev': 'dev', 'hello-dep-staging': 'staging', 'hello-dep-prod': 'prod' })[ns] ??
		null;
	const envOrder = ['dev', 'staging', 'prod'];

	it('groups the live three-environment case into ONE contract, in promotion order', () => {
		const blocks = contractBlocks({
			deps: [dep({ ns: 'hello-dep-prod' }), dep({ ns: 'hello-dep-dev' }), dep({ ns: 'hello-dep-staging' })],
			envOf,
			envOrder,
			order,
			currentTagOf: () => 'rel-66'
		});
		expect(blocks).toHaveLength(1);
		expect(blocks[0].contract).toBe('api');
		expect(blocks[0].entries.map((e) => e.env)).toEqual(['dev', 'staging', 'prod']);
		expect(blocks[0].providedVersion).toBe('1.66.0');
		expect(blocks[0].providedTag).toBe('rel-66');
	});

	it('reports NO asymmetry and NO adversity for the live data', () => {
		const blocks = contractBlocks({
			deps: [dep({ ns: 'hello-dep-dev' }), dep({ ns: 'hello-dep-staging' }), dep({ ns: 'hello-dep-prod' })],
			envOf,
			envOrder,
			order,
			currentTagOf: () => 'rel-66'
		});
		expect(blocks[0].ungated).toBe(0);
		expect(blocks[0].adverse).toBe(false);
	});

	it('COUNTS THE ASYMMETRY when an environment carries no gate', () => {
		const blocks = contractBlocks({
			deps: [dep({ ns: 'hello-dep-dev' }), dep({ ns: 'hello-dep-staging' })],
			envOf,
			envOrder,
			order,
			currentTagOf: () => 'rel-66'
		});
		expect(blocks[0].ungated).toBe(1);
		expect(blocks[0].entries.map((e) => e.env)).toEqual(['dev', 'staging']);
	});

	it('marks a block adverse when any environment wants a blocked build', () => {
		const d = dep({ ns: 'hello-dep-staging' });
		d.status!.blockedReleases = [{ tag: 'rel-66', requiredVersion: '^2.0.0' }];
		const blocks = contractBlocks({
			deps: [dep({ ns: 'hello-dep-dev' }), d],
			envOf,
			envOrder,
			order,
			currentTagOf: (e) => (e === 'staging' ? 'rel-63' : 'rel-66')
		});
		expect(blocks[0].adverse).toBe(true);
		expect(blocks[0].entries.find((e) => e.env === 'staging')!.wanted.map((b) => b.tag)).toEqual([
			'rel-66'
		]);
		expect(blocks[0].entries.find((e) => e.env === 'dev')!.wanted).toEqual([]);
	});

	it('counts past blocks without drawing them', () => {
		const blocks = contractBlocks({
			deps: [dep({ ns: 'hello-dep-dev' })],
			envOf,
			envOrder,
			order,
			currentTagOf: () => 'rel-66'
		});
		expect(blocks[0].pastTags).toEqual(['rel-2']);
		expect(blocks[0].entries[0].wanted).toEqual([]);
	});

	it('DE-DUPLICATES the past-blocked count across environments', () => {
		// The live shape: ONE build blocked by ONE contract in three
		// namespaces. Counted per environment this read `1 older build blocked`
		// three times on the quietest page state in the product.
		const blocks = contractBlocks({
			deps: [
				dep({ ns: 'hello-dep-dev' }),
				dep({ ns: 'hello-dep-staging' }),
				dep({ ns: 'hello-dep-prod' })
			],
			envOf,
			envOrder,
			order,
			currentTagOf: () => 'rel-66'
		});
		expect(blocks[0].pastTags).toEqual(['rel-2']);
	});

	it('separates two contracts on the same rollout, adverse first', () => {
		const quiet = dep({ ns: 'hello-dep-dev' });
		const loud = dep({ ns: 'hello-dep-dev' });
		loud.spec.contract = 'zzz-payments';
		loud.spec.providerRef = { name: 'payments-api', namespace: 'hello-dep-dev' };
		loud.status!.blockedReleases = [{ tag: 'rel-66', requiredVersion: '>=3.0.0' }];
		const blocks = contractBlocks({
			deps: [quiet, loud],
			envOf,
			envOrder,
			order,
			currentTagOf: () => 'rel-63'
		});
		expect(blocks).toHaveLength(2);
		expect(blocks[0].contract).toBe('zzz-payments');
		expect(blocks[0].adverse).toBe(true);
		expect(blocks[1].contract).toBe('api');
	});

	it('drops a dependency whose namespace is not one of this app environments', () => {
		const blocks = contractBlocks({
			deps: [dep({ ns: 'some-other-app-dev' })],
			envOf,
			envOrder,
			order,
			currentTagOf: () => 'rel-66'
		});
		expect(blocks).toEqual([]);
	});

	it('keeps a cross-namespace provider reference', () => {
		const d = dep({ ns: 'hello-dep-dev' });
		d.spec.providerRef = { name: 'hello-api-app', namespace: 'platform-prod' };
		// The server resolves the default, so the view-model reads it straight.
		const blocks = contractBlocks({
			deps: [d],
			envOf,
			envOrder,
			order,
			currentTagOf: () => 'rel-66'
		});
		expect(blocks[0].providerNamespace).toBe('platform-prod');
	});

	it('leaves providedVersion null when no gate has evaluated one', () => {
		const d = dep({ ns: 'hello-dep-dev' });
		// The served type is `string | undefined`, never null: an absent
		// providedVersion means the gate has not read one, and the page states
		// that observable rather than naming a cause it cannot evidence.
		delete d.status!.providedVersion;
		delete d.status!.providedTag;
		const blocks = contractBlocks({
			deps: [d],
			envOf,
			envOrder,
			order,
			currentTagOf: () => 'rel-66'
		});
		expect(blocks[0].providedVersion).toBeNull();
	});
});

describe('chainOrder - walks the After edges', () => {
	const infos: EnvInfo[] = [
		{ environment: 'prod', relationship: { environment: 'staging', type: 'After' } },
		{ environment: 'dev' },
		{ environment: 'staging', relationship: { environment: 'dev', type: 'After' } }
	];

	it('orders the live chain upstream-first regardless of arrival order', () => {
		expect(chainOrder(infos)).toEqual(['dev', 'staging', 'prod']);
	});

	it('keeps a fan-out under its shared parent', () => {
		const order = chainOrder([
			{ environment: 'dev' },
			{ environment: 'prod-eu', relationship: { environment: 'dev', type: 'After' } },
			{ environment: 'prod-us', relationship: { environment: 'dev', type: 'After' } }
		]);
		expect(order[0]).toBe('dev');
		expect(order.slice(1).sort()).toEqual(['prod-eu', 'prod-us']);
	});

	it('never drops an environment caught in a cycle', () => {
		const order = chainOrder([
			{ environment: 'a', relationship: { environment: 'b', type: 'After' } },
			{ environment: 'b', relationship: { environment: 'a', type: 'After' } }
		]);
		expect(order.slice().sort()).toEqual(['a', 'b']);
	});

	it('treats a dangling After as a head rather than losing the node', () => {
		expect(chainOrder([{ environment: 'x', relationship: { environment: 'gone', type: 'After' } }])).toEqual(
			['x']
		);
	});

	it('ignores a relationship whose type is not After', () => {
		expect(
			chainOrder([
				{ environment: 'a' },
				{ environment: 'b', relationship: { environment: 'a', type: 'Before' } }
			])
		).toEqual(['a', 'b']);
	});
});

describe('currentEntry / chain', () => {
	const order = buildOrder(LIVE_RELEASES);
	const hist = (tag: string, version: string, id: number, bake = 'Succeeded') => ({
		id,
		version: { tag, version },
		timestamp: '2026-08-11T08:30:34Z',
		bakeStatus: bake
	});
	const infos: EnvInfo[] = [
		{
			environment: 'dev',
			history: [hist('rel-63', '2.63.0-63', 2), hist('rel-66', '2.66.0-66', 4)]
		},
		{
			environment: 'staging',
			relationship: { environment: 'dev', type: 'After' },
			history: [hist('rel-63', '2.63.0-63', 2)]
		},
		{ environment: 'prod', relationship: { environment: 'staging', type: 'After' } }
	];

	it('takes the highest history id, not the array order', () => {
		expect(currentEntry(infos[0])!.version.tag).toBe('rel-66');
	});

	it('returns null for an environment that has never deployed', () => {
		expect(currentEntry(infos[2])).toBeNull();
	});

	it('builds the chain upstream-first with ranks off the one ladder', () => {
		const rows = chain(infos, order);
		expect(rows.map((r) => r.env)).toEqual(['dev', 'staging', 'prod']);
		expect(rows[0].rank).toBe(0);
		expect(rows[0].display).toBe('2.66.0-66');
		expect(rows[1].rank).toBe(2);
		expect(rows[2].tag).toBeNull();
		expect(rows[2].rank).toBe(-1);
	});
});

describe('hopBetween - a count or nothing, never a fabricated zero', () => {
	const order = buildOrder(LIVE_RELEASES);
	const rows = chain(
		[
			{ environment: 'dev', history: [{ id: 1, version: { tag: 'rel-66', version: '2.66.0-66' } }] },
			{
				environment: 'staging',
				relationship: { environment: 'dev', type: 'After' },
				history: [{ id: 1, version: { tag: 'rel-63', version: '2.63.0-63' } }]
			},
			{ environment: 'prod', relationship: { environment: 'staging', type: 'After' } }
		],
		order
	);

	it('counts the builds waiting on an edge', () => {
		expect(hopBetween(rows[0], rows[1])).toEqual({ waiting: 2, label: '2 waiting' });
	});

	it('prints nothing when the edge is in sync', () => {
		expect(hopBetween(rows[0], rows[0])).toEqual({ waiting: 0, label: '' });
	});

	it('prints nothing when either side has never deployed', () => {
		expect(hopBetween(rows[1], rows[2])).toEqual({ waiting: 0, label: '' });
		expect(hopBetween(null, rows[0])).toEqual({ waiting: 0, label: '' });
	});

	it('reports a downstream that is AHEAD without calling it waiting', () => {
		expect(hopBetween(rows[1], rows[0])).toEqual({ waiting: 0, label: '2 ahead' });
	});
});

describe('blocked builds group by BUILD, not by environment', () => {
	const order = buildOrder(LIVE_RELEASES);
	const envOf = (ns: string) =>
		({ 'hello-dep-dev': 'dev', 'hello-dep-staging': 'staging', 'hello-dep-prod': 'prod' })[ns] ??
		null;
	const envOrder = ['dev', 'staging', 'prod'];

	function held(ns: string, blocked: { tag: string; requiredVersion?: string; reason?: string }[]) {
		const d = dep({ ns });
		d.status!.blockedReleases = blocked;
		return d;
	}

	it('collapses one build held in three environments into ONE row', () => {
		const b = [{ tag: 'rel-66', requiredVersion: '^2.0.0', reason: 'ConstraintNotSatisfied' }];
		const blocks = contractBlocks({
			deps: [held('hello-dep-dev', b), held('hello-dep-staging', b), held('hello-dep-prod', b)],
			envOf,
			envOrder,
			order,
			currentTagOf: () => 'rel-63'
		});
		expect(blocks[0].blocked).toHaveLength(1);
		expect(blocks[0].blocked[0].tag).toBe('rel-66');
		expect(blocks[0].blocked[0].display).toBe('2.66.0-66');
		expect(blocks[0].blocked[0].envs).toEqual(['dev', 'staging', 'prod']);
	});

	it('SPLITS one build whose environments disagree about the reason', () => {
		// The live cluster does exactly this: the spoke reports
		// `ConstraintNotSatisfied` and the hub `ProviderVersionTooOld` for one
		// build. Folding them would have to pick one and print it as the truth.
		const blocks = contractBlocks({
			deps: [
				held('hello-dep-dev', [
					{ tag: 'rel-66', requiredVersion: '1.1.0', reason: 'ConstraintNotSatisfied' }
				]),
				held('hello-dep-prod', [
					{ tag: 'rel-66', requiredVersion: '1.1.0', reason: 'ProviderVersionTooOld' }
				])
			],
			envOf,
			envOrder,
			order,
			currentTagOf: () => 'rel-63'
		});
		expect(blocks[0].blocked).toHaveLength(2);
		expect(blocks[0].blocked.map((r) => r.reason).sort()).toEqual([
			'ConstraintNotSatisfied',
			'ProviderVersionTooOld'
		]);
	});

	it('orders blocked builds newest first', () => {
		const blocks = contractBlocks({
			deps: [
				held('hello-dep-dev', [
					{ tag: 'rel-64', requiredVersion: 'a' },
					{ tag: 'rel-66', requiredVersion: 'b' }
				])
			],
			envOf,
			envOrder,
			order,
			currentTagOf: () => 'rel-63'
		});
		expect(blocks[0].blocked.map((r) => r.tag)).toEqual(['rel-66', 'rel-64']);
	});

	it('draws nothing at all when every blocked build is already past', () => {
		const blocks = contractBlocks({
			deps: [dep({ ns: 'hello-dep-dev' })],
			envOf,
			envOrder,
			order,
			currentTagOf: () => 'rel-66'
		});
		expect(blocks[0].blocked).toEqual([]);
		expect(blocks[0].adverse).toBe(false);
	});

	it('names the ungated environments in promotion order', () => {
		const blocks = contractBlocks({
			deps: [dep({ ns: 'hello-dep-dev' })],
			envOf,
			envOrder,
			order,
			currentTagOf: () => 'rel-66'
		});
		expect(blocks[0].ungatedEnvs).toEqual(['staging', 'prod']);
		expect(blocks[0].ungated).toBe(2);
	});
});
