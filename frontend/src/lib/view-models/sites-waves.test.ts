import { describe, it, expect } from 'vitest';
import type { Environment } from '../../types';
import {
	blockerFromStatus,
	TIERS,
	canonicalTier,
	siteOf,
	waveOf,
	roleOf,
	lockstepOf,
	waveReady,
	parseWaveBlocker,
	lockstepMismatch,
	relationshipIgnored,
	buildTopology,
	upstreamOf,
	downstreamOf,
	placeKey,
	placeKeyOf,
	placeLabel,
	comparePlaces,
	type AppTopology,
	type SiteNode
} from './sites-waves';

type Cond = { type: string; status: string; reason?: string; message?: string };
type Opts = {
	tier?: string;
	site?: string;
	wave?: number;
	name?: string;
	lockstep?: boolean;
	conditions?: Cond[];
	status?: Record<string, unknown>;
};
const env = (o: Opts = {}): Environment =>
	({
		metadata: { name: `env-${o.site ?? 'x'}`, namespace: 'ns' },
		spec: {
			environment: o.tier ?? 'prod',
			name: o.name ?? 'app',
			site: o.site,
			wave: o.wave,
			lockstep: o.lockstep,
			rolloutRef: { name: 'app' }
		},
		status: { conditions: o.conditions ?? [], ...(o.status ?? {}) }
	}) as unknown as Environment;

const mem = (tier: string, site: string, wave: number, extra: Record<string, unknown> = {}) => ({
	environment: tier,
	site,
	wave,
	...extra
});
const withWave = (o: Opts, wave: Record<string, unknown>): Environment =>
	env({ ...o, status: { wave } });

const topoOf = (envs: Environment[], name = 'kuberik-app'): AppTopology =>
	buildTopology(envs).get(name)!;
const site = (t: AppTopology, tier: string, s: string): SiteNode =>
	t.tiers.find((x) => x.tier === tier)!.sites.find((x) => x.site === s)!;

describe('canonicalTier', () => {
	it.each([
		['dev', 'dev'],
		['development', 'dev'],
		['test', 'test'],
		['qa', 'test'],
		['staging', 'staging'],
		['stage', 'staging'],
		['preprod', 'staging'],
		['prod', 'prod'],
		['production', 'prod']
	])('%s -> %s', (name, tier) => expect(canonicalTier(name)).toBe(tier));

	it('falls back to the heuristic for legacy names', () => {
		expect(canonicalTier('prod-us-east')).toBe('prod');
		expect(canonicalTier('prod-test-1')).toBe('prod');
		expect(canonicalTier('my-qa-box')).toBe('test');
	});

	it('gives null for unknown names', () => {
		expect(canonicalTier('sandbox')).toBeNull();
		expect(canonicalTier('')).toBeNull();
		expect(canonicalTier(undefined)).toBeNull();
	});

	it('TIERS is the fixed order', () => expect([...TIERS]).toEqual(['dev', 'test', 'staging', 'prod']));
});

describe('field readers', () => {
	it('default site and wave, legacy `default` site included', () => {
		const e = env();
		expect(siteOf(e)).toBe('default');
		expect(waveOf(e)).toBe(1);
		expect(roleOf(e)).toBeNull();
		expect(lockstepOf(e)).toBe(false);
	});
	it('reads spec, then status', () => {
		expect(siteOf(env({ site: 'eu' }))).toBe('eu');
		expect(siteOf(withWave({}, { site: 'us', wave: 3, role: 'Follower' }))).toBe('us');
		expect(waveOf(withWave({}, { site: 'us', wave: 3 }))).toBe(3);
		expect(waveOf(env({ wave: 2 }))).toBe(2);
		expect(roleOf(withWave({}, { site: 'us', wave: 3, role: 'Follower' }))).toBe('Follower');
		expect(lockstepOf(env({ lockstep: true }))).toBe(true);
	});
});

// Every message format in environment-controller internal/wave + controller/ownership.go.
describe('parseWaveBlocker — controller message formats', () => {
	const cases: [string, string, unknown][] = [
		['WaitingFor', 'prod/eu-west-1 selection', { kind: 'member', tier: 'prod', site: 'eu-west-1', what: 'selection' }],
		['WaitingFor', 'prod/eu bake', { kind: 'member', tier: 'prod', site: 'eu', what: 'bake' }],
		['WaitingFor', 'dev/default bake on 1a2b3c4', { kind: 'member', tier: 'dev', site: 'default', what: 'bake', rev: '1a2b3c4' }],
		['WaitingFor', 'staging/us bake failed on 1a2b3c4', { kind: 'member', tier: 'staging', site: 'us', what: 'bake', outcome: 'failed', rev: '1a2b3c4' }],
		['WaitingFor', 'staging/us bake cancelled on 1a2b3c4', { kind: 'member', tier: 'staging', site: 'us', what: 'bake', outcome: 'cancelled', rev: '1a2b3c4' }],
		['WaitingFor', 'production/us bake on abc1234', { kind: 'member', tier: 'prod', site: 'us', what: 'bake', rev: 'abc1234' }],
		['WaitingFor', 'staging has no registered sites', { kind: 'noSites', tier: 'staging' }],
		['WaitingForCandidate', '1a2b3c4', { kind: 'candidate', rev: '1a2b3c4' }],
		['Pinned', 'pinned to v1.0.0, wave selected v1.2.0', { kind: 'pinned', pinned: 'v1.0.0', selected: 'v1.2.0' }],
		['InvalidTopology', 'prod has waves 1,3 (missing 2)', { kind: 'gap', tier: 'prod', waves: [1, 3], missing: [2], startsAtOne: true }],
		['InvalidTopology', 'prod has waves 1,4 (missing 2,3)', { kind: 'gap', tier: 'prod', waves: [1, 4], missing: [2, 3], startsAtOne: true }],
		['InvalidTopology', 'prod has waves 0,1 (waves start at 1)', { kind: 'gap', tier: 'prod', waves: [0, 1], missing: [], startsAtOne: false }],
		['InvalidTopology', 'prod is its own upstream', { kind: 'selfUpstream', tier: 'prod' }],
		['LockstepWaiting', 'prod/ap-south-1 bake on 1a2b3c4', { kind: 'lockstep', tier: 'prod', site: 'ap-south-1', rev: '1a2b3c4' }],
		[
			'DuplicateSite',
			'site eu of prod for kuberik-app is owned by cluster 7f3a namespace apps name app-prod',
			{ kind: 'duplicate', site: 'eu', tier: 'prod', name: 'kuberik-app', owner: { cluster: '7f3a', namespace: 'apps', name: 'app-prod' } }
		]
	];
	it.each(cases)('%s: %s', (reason, message, want) => {
		expect(parseWaveBlocker(reason, message)).toEqual(want);
	});

	it('falls back to unparsed with the raw text', () => {
		expect(parseWaveBlocker('WaitingFor', 'something new happened')).toEqual({
			kind: 'unparsed',
			reason: 'WaitingFor',
			raw: 'something new happened'
		});
		expect(parseWaveBlocker('BrandNewReason', 'x')).toMatchObject({ kind: 'unparsed', raw: 'x' });
		expect(parseWaveBlocker('Pinned', 'pinned')).toMatchObject({ kind: 'unparsed' });
		expect(parseWaveBlocker('DuplicateSite', '')).toMatchObject({ kind: 'unparsed' });
	});
});

describe('waveReady', () => {
	it('true condition', () => {
		const e = env({ conditions: [{ type: 'WaveReady', status: 'True', reason: 'Ready', message: 'site may deploy the allowed versions' }] });
		expect(waveReady(e)).toEqual({ ready: true, reason: 'Ready', raw: 'site may deploy the allowed versions', blocker: null });
	});
	it('false condition is parsed', () => {
		const e = env({ conditions: [{ type: 'WaveReady', status: 'False', reason: 'WaitingFor', message: 'prod/eu bake on abc1234' }] });
		const r = waveReady(e);
		expect(r.ready).toBe(false);
		expect(r.reason).toBe('WaitingFor');
		expect(r.blocker).toMatchObject({ kind: 'member', site: 'eu', rev: 'abc1234' });
	});
	it('no condition is unknown, not blocked', () => {
		expect(waveReady(env())).toEqual({ ready: null, reason: '', raw: '', blocker: null });
	});
	it('never throws on junk', () => {
		expect(() => waveReady(null as unknown as Environment)).not.toThrow();
		expect(() => waveReady({} as Environment)).not.toThrow();
		expect(() => waveReady({ status: { conditions: [{ type: 'WaveReady', status: 'False' }] } } as unknown as Environment)).not.toThrow();
		expect(waveReady({ status: { conditions: [{ type: 'WaveReady', status: 'False' }] } } as unknown as Environment).blocker).toMatchObject({ kind: 'unparsed' });
	});
});

describe('lockstepMismatch / relationshipIgnored', () => {
	it('parses the mismatch message', () => {
		const e = env({
			conditions: [
				{
					type: 'LockstepConsistent',
					status: 'False',
					reason: 'LockstepMismatch',
					message: 'wave-1 leader prod/eu has lockstep=true; disagreeing sites: prod/ap, prod/us'
				}
			]
		});
		expect(lockstepMismatch(e)).toMatchObject({
			tier: 'prod',
			leader: 'eu',
			lockstep: true,
			sites: [
				{ tier: 'prod', site: 'ap' },
				{ tier: 'prod', site: 'us' }
			]
		});
	});
	it('consistent is null', () => {
		expect(lockstepMismatch(env({ conditions: [{ type: 'LockstepConsistent', status: 'True', reason: 'Consistent' }] }))).toBeNull();
	});
	it('unparseable mismatch keeps raw', () => {
		const e = env({ conditions: [{ type: 'LockstepConsistent', status: 'False', message: 'huh' }] });
		expect(lockstepMismatch(e)?.raw).toBe('huh');
	});
	it('Deprecated / RelationshipIgnored', () => {
		expect(relationshipIgnored(env({ conditions: [{ type: 'Deprecated', status: 'True', reason: 'RelationshipIgnored' }] }))).toBe(true);
		expect(relationshipIgnored(env())).toBe(false);
	});
});

describe('buildTopology', () => {
	it('joins on spec.name with the kuberik- prefix', () => {
		const m = buildTopology([env({ name: 'app' }), env({ name: 'kuberik-app', tier: 'dev' }), env({ name: 'other' })]);
		expect([...m.keys()].sort()).toEqual(['kuberik-app', 'kuberik-other']);
		expect(m.get('kuberik-app')!.tiers.map((t) => t.tier)).toEqual(['dev', 'prod']);
	});

	it('orders tiers by TIERS and skips empty ones; aliases share a tier', () => {
		const t = topoOf([env({ tier: 'production' }), env({ tier: 'dev' }), env({ tier: 'preprod' })]);
		expect(t.tiers.map((x) => x.tier)).toEqual(['dev', 'staging', 'prod']);
	});

	it('legacy single env: site default, wave 1, leader by derivation', () => {
		const t = topoOf([env({})]);
		const s = t.tiers[0].sites[0];
		expect(s).toMatchObject({ site: 'default', wave: 1, isLeader: true, role: 'Leader' });
		expect(t.tiers[0].waves[0].leader).toBe('default');
	});

	it('leader: reported status.wave.leader wins, else lowest non-deregistered site', () => {
		const reported = topoOf([
			withWave({ site: 'b', wave: 1 }, { site: 'b', wave: 1, role: 'Follower', leader: 'c', selectedRevision: 'abc' }),
			env({ site: 'c', wave: 1 }),
			env({ site: 'a', wave: 1 })
		]);
		expect(reported.tiers[0].waves[0].leader).toBe('c');
		expect(reported.tiers[0].waves[0].selectedRevision).toBe('abc');
		expect(site(reported, 'prod', 'c').isLeader).toBe(true);
		expect(site(reported, 'prod', 'a').isLeader).toBe(false);

		const derived = topoOf([env({ site: 'b' }), env({ site: 'c' }), env({ site: 'a' })]);
		expect(derived.tiers[0].waves[0].leader).toBe('a');
		// leader sorts first
		expect(derived.tiers[0].sites.map((s) => s.site)).toEqual(['a', 'b', 'c']);
	});

	it('members from any env fill in remote sites; a site\'s own report wins', () => {
		const t = topoOf([
			withWave(
				{ site: 'eu', wave: 1 },
				{
					site: 'eu',
					wave: 1,
					leader: 'eu',
					members: [
						mem('prod', 'eu', 1, { revision: 'own1111', bakeStatus: 'Succeeded' }),
						mem('prod', 'us', 2, { revision: 'abc1234', bakeStatus: 'InProgress' })
					]
				}
			),
			withWave(
				{ site: 'us', wave: 2 },
				{
					site: 'us',
					wave: 2,
					leader: 'us',
					members: [mem('prod', 'eu', 1, { revision: 'stale00', bakeStatus: 'Failed' }), mem('prod', 'us', 2, { revision: 'own2222', bakeStatus: 'Deploying' })]
				}
			),
			withWave({ site: 'ap', wave: 3 }, { site: 'ap', wave: 3, members: [] })
		]);
		expect(site(t, 'prod', 'eu')).toMatchObject({ revision: 'own1111', bakeStatus: 'Succeeded' });
		expect(site(t, 'prod', 'us')).toMatchObject({ revision: 'own2222', bakeStatus: 'Deploying' });
		expect(t.tiers[0].waves.map((w) => w.wave)).toEqual([1, 2, 3]);
	});

	it('a remote site with no visible env still appears via members', () => {
		const t = topoOf([withWave({ site: 'eu' }, { site: 'eu', wave: 1, members: [mem('prod', 'ap', 1, { revision: 'r' })] })]);
		const ap = site(t, 'prod', 'ap');
		expect(ap.env).toBeUndefined();
		expect(ap.revision).toBe('r');
	});

	it('deregistered sites are kept but excluded from counts and leadership', () => {
		const t = topoOf([
			withWave(
				{ site: 'b', wave: 1 },
				{ site: 'b', wave: 1, members: [mem('prod', 'a', 1, { deregistered: true }), mem('prod', 'b', 1)] }
			)
		]);
		const p = t.tiers[0];
		expect(p.sites.map((s) => s.site).sort()).toEqual(['a', 'b']);
		expect(p.liveCount).toBe(1);
		expect(site(t, 'prod', 'a')).toMatchObject({ deregistered: true, isLeader: false });
		expect(p.waves[0].leader).toBe('b');
	});

	it('DuplicateSite envs go into the owner\'s duplicates, never into sites', () => {
		const owner = env({ site: 'eu' });
		const dup = env({
			site: 'eu',
			conditions: [
				{
					type: 'WaveReady',
					status: 'False',
					reason: 'DuplicateSite',
					message: 'site eu of prod for kuberik-app is owned by cluster c1 namespace n name app'
				}
			]
		});
		const t = topoOf([dup, owner]);
		expect(t.tiers[0].sites).toHaveLength(1);
		expect(site(t, 'prod', 'eu').env).toBe(owner);
		expect(site(t, 'prod', 'eu').duplicates).toEqual([dup]);
	});

	it('a duplicate whose owner is remote still attaches to a placeholder site', () => {
		const dup = env({
			site: 'eu',
			conditions: [{ type: 'WaveReady', status: 'False', reason: 'DuplicateSite', message: 'x' }]
		});
		const t = topoOf([dup]);
		expect(t.tiers[0].sites).toHaveLength(1);
		expect(t.tiers[0].sites[0].env).toBeUndefined();
		expect(t.tiers[0].sites[0].duplicates).toEqual([dup]);
	});

	it('unknown tiers are reported, not dropped', () => {
		const t = topoOf([env({ tier: 'sandbox' }), env({ tier: 'dev' })]);
		expect(t.unplaced).toHaveLength(1);
		expect(t.tiers.map((x) => x.tier)).toEqual(['dev']);
	});
});

describe('upstreamOf / downstreamOf', () => {
	const t = topoOf([
		env({ tier: 'dev', site: 'd' }),
		env({ tier: 'staging', site: 's' }),
		env({ tier: 'prod', site: 'a', wave: 1 }),
		env({ tier: 'prod', site: 'b', wave: 1 }),
		env({ tier: 'prod', site: 'c', wave: 2 }),
		env({ tier: 'prod', site: 'd2', wave: 2 })
	]);
	const names = (xs: SiteNode[]) => xs.map((s) => s.site);

	it('a follower follows its wave leader', () => {
		expect(names(upstreamOf(t, site(t, 'prod', 'b')))).toEqual(['a']);
		expect(names(upstreamOf(t, site(t, 'prod', 'd2')))).toEqual(['c']);
	});
	it('a wave-N leader waits for the live sites of wave N-1', () => {
		expect(names(upstreamOf(t, site(t, 'prod', 'c')))).toEqual(['a', 'b']);
	});
	it('a wave-1 leader waits for the last wave of the nearest earlier tier with sites', () => {
		expect(names(upstreamOf(t, site(t, 'prod', 'a')))).toEqual(['s']);
		expect(names(upstreamOf(t, site(t, 'staging', 's')))).toEqual(['d']);
		expect(upstreamOf(t, site(t, 'dev', 'd'))).toEqual([]);
	});
	it('skips tiers without sites and deregistered sites', () => {
		const t2 = topoOf([
			env({ tier: 'dev', site: 'd' }),
			withWave({ tier: 'prod', site: 'p' }, { site: 'p', wave: 1, members: [mem('dev', 'd', 1, { deregistered: true }), mem('prod', 'p', 1)] })
		]);
		expect(upstreamOf(t2, site(t2, 'prod', 'p'))).toEqual([]);
	});
	it('downstreamOf is the inverse', () => {
		expect(names(downstreamOf(t, site(t, 'prod', 'a')))).toEqual(['b', 'c']);
		expect(names(downstreamOf(t, site(t, 'staging', 's')))).toEqual(['a']);
		expect(downstreamOf(t, site(t, 'prod', 'd2'))).toEqual([]);
	});
});

describe('places', () => {
	it('one site: the key is the tier', () => {
		const e = env({ tier: 'production' });
		expect(placeKey(e, topoOf([e]))).toBe('prod');
		expect(placeLabel(e, topoOf([e]))).toBe('prod');
	});
	it('the legacy default site is just the tier', () => {
		const e = env({ tier: 'staging' });
		expect(placeKey(e, topoOf([e]))).toBe('staging');
	});
	it('three sites: tier-site', () => {
		const es = [env({ site: 'eu' }), env({ site: 'us' }), env({ site: 'ap', wave: 2 })];
		const t = topoOf(es);
		expect(placeKey(es[0], t)).toBe('prod-eu');
		expect(placeKey(es[2], t)).toBe('prod-ap');
		expect(placeLabel(es[1], t)).toBe('prod-us');
	});
	it('deregistered sites do not count', () => {
		const e = env({ site: 'eu' });
		const t = topoOf([withWave({ site: 'eu' }, { site: 'eu', wave: 1, members: [mem('prod', 'old', 1, { deregistered: true })] })]);
		expect(placeKey(e, t)).toBe('prod');
	});
	it('another tier growing does not change this tier\'s key', () => {
		const dev = env({ tier: 'dev' });
		const t = topoOf([dev, env({ site: 'a' }), env({ site: 'b' })]);
		expect(placeKey(dev, t)).toBe('dev');
	});
	it('no topology: tier; unknown tier: raw', () => {
		expect(placeKey(env({ tier: 'qa', site: 'x' }))).toBe('test');
		expect(placeKey(env({ tier: 'sandbox' }))).toBe('sandbox');
	});
	it('placeKeyOf memoises per array and joins by app', () => {
		const a = env({ site: 'eu' });
		const b = env({ site: 'us' });
		const other = env({ name: 'other', site: 'eu' });
		const list = [a, b, other];
		expect(placeKeyOf(a, list)).toBe('prod-eu');
		expect(placeKeyOf(other, list)).toBe('prod');
		expect(placeKeyOf(b, list)).toBe('prod-us');
	});
});

describe('comparePlaces', () => {
	it('tier, then wave, then leader first, then site', () => {
		const t = topoOf([
			env({ tier: 'prod', site: 'z', wave: 1 }),
			env({ tier: 'prod', site: 'a', wave: 2 }),
			env({ tier: 'prod', site: 'm', wave: 1 }),
			env({ tier: 'dev', site: 'q' }),
			withWave({ tier: 'prod', site: 'b', wave: 1 }, { site: 'b', wave: 1, leader: 'z' })
		]);
		const all = t.tiers.flatMap((x) => x.sites).sort(comparePlaces);
		expect(all.map((s) => `${s.tier}/${s.site}`)).toEqual(['dev/q', 'prod/z', 'prod/b', 'prod/m', 'prod/a']);
	});
});

describe('parseWaveBlocker — controller 9eef3ca additions', () => {
	it('parses UnknownTier', () => {
		expect(
			parseWaveBlocker(
				'UnknownTier',
				'environment "qa-old" is not a known tier; use one of dev, test, staging, prod (aliases: development, qa, stage, preprod, production)'
			)
		).toEqual({ kind: 'unknownTier', name: 'qa-old' });
	});
	it('parses two alias names in one tier', () => {
		expect(
			parseWaveBlocker('InvalidTopology', 'staging and preprod are the same tier (staging); use one name per tier, sites/waves to split')
		).toEqual({ kind: 'aliasTier', names: ['staging', 'preprod'], tier: 'staging' });
	});
	it('parses three alias names', () => {
		expect(
			parseWaveBlocker('InvalidTopology', 'prod, production and preprod are the same tier (prod); use one name per tier, sites/waves to split')
		).toMatchObject({ kind: 'aliasTier', names: ['prod', 'production', 'preprod'] });
	});
	it('keeps the gap format', () => {
		expect(parseWaveBlocker('InvalidTopology', 'prod has waves 1,3 (missing 2)')).toMatchObject({ kind: 'gap', missing: [2] });
	});
});

describe('waveReady — structured status.wave.blocker wins over the message', () => {
	const env = (blocker: object, reason: string, message = 'free text the parser cannot read') =>
		({
			spec: { name: 'app', environment: 'prod', site: 'ap-south-1' },
			status: {
				wave: { blocker },
				conditions: [{ type: 'WaveReady', status: 'False', reason, message }]
			}
		}) as unknown as Environment;
	it('member bake from fields', () => {
		expect(
			waveReady(env({ reason: 'WaitingFor', environment: 'production', site: 'us-east-1', waitingOn: 'Bake', revision: 'c6f19d2' }, 'WaitingFor')).blocker
		).toEqual({ kind: 'member', tier: 'prod', site: 'us-east-1', what: 'bake', rev: 'c6f19d2' });
	});
	it('duplicate owner from fields', () => {
		expect(
			waveReady(env({ reason: 'DuplicateSite', environment: 'prod', site: 'us-east-1', owner: { cluster: 'c1', namespace: 'ns', name: 'other' } }, 'DuplicateSite')).blocker
		).toMatchObject({ kind: 'duplicate', site: 'us-east-1', owner: { cluster: 'c1', namespace: 'ns', name: 'other' } });
	});
	it('falls back to the message when the fields are incomplete', () => {
		expect(waveReady(env({ reason: 'WaitingFor' }, 'WaitingFor', 'prod/us-east-1 selection')).blocker).toMatchObject({
			kind: 'member',
			what: 'selection'
		});
	});
	it('gap and alias from fields', () => {
		expect(blockerFromStatus({ environment: 'prod', waves: [1, 3], missingWaves: [2] }, 'InvalidTopology')).toMatchObject({ kind: 'gap', missing: [2] });
		expect(blockerFromStatus({ environment: 'staging', names: ['staging', 'preprod'] }, 'InvalidTopology')).toEqual({
			kind: 'aliasTier',
			names: ['staging', 'preprod'],
			tier: 'staging'
		});
	});
});

describe('blockerFromStatus — Sites marker and tier-level bake', () => {
	it('waitingOn Sites is noSites', () => {
		expect(blockerFromStatus({ environment: 'staging', waitingOn: 'Sites' }, 'WaitingFor')).toEqual({ kind: 'noSites', tier: 'staging' });
	});
	it('Bake with no site waits on the tier', () => {
		expect(blockerFromStatus({ environment: 'staging', waitingOn: 'Bake', revision: 'abc1234' }, 'WaitingFor')).toMatchObject({
			kind: 'member',
			tier: 'staging',
			what: 'bake',
			rev: 'abc1234'
		});
	});
});
