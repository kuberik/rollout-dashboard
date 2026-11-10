/**
 * SITES AND WAVES — the dashboard's read of environment-controller's
 * `feat/sites-and-waves` model. Pure: no Svelte, no I/O, never throws.
 *
 * Vocabulary (controller README "Sites and waves"):
 *  - tier   dev < test < staging < prod. `spec.environment` accepts nine names
 *           (dev/development, test/qa, staging/stage/preprod, prod/production);
 *           aliases of one tier are the same environment.
 *  - site   one cluster's instance of a tier (`spec.site`, default "default").
 *  - wave   ordering of sites WITHIN a tier, 1-based (`spec.wave`).
 *  - leader the site that selects the wave's version; the others follow it.
 *
 * Every Environment of one app shares `spec.name` (with a `kuberik-` prefix the
 * controller adds on its own), which is the join key of `buildTopology`.
 *
 * A "place" is what the old UI called an environment: the tier while it has at
 * most one live site, `${tier}-${site}` once it has several. That keeps
 * `prod-us-east`-style keys, URLs and fixtures stable while a tier is one site.
 *
 * WaveReady messages are parsed from the controller's text (internal/wave
 * wave.go + fleet.go + controller/ownership.go). The message is a human string
 * with no structured twin, so every parser has an `unparsed` fallback that
 * carries the raw text: a changed message degrades to showing it, never to
 * a wrong claim.
 */
import type { Environment } from '../../types';
import type { TierName, WaveMember, WaveRole } from '../../types/environment-types';
import { getEnvironmentRank } from '../env-order';

/** Canonical tiers, earliest first. */
export const TIERS = ['dev', 'test', 'staging', 'prod'] as const;
export type Tier = (typeof TIERS)[number];

const ALIASES: Record<string, Tier> = {
	dev: 'dev',
	development: 'dev',
	test: 'test',
	qa: 'test',
	staging: 'staging',
	stage: 'staging',
	preprod: 'staging',
	prod: 'prod',
	production: 'prod'
};

export const DEFAULT_SITE = 'default';

/**
 * The canonical tier of an environment name. The nine accepted names map
 * exactly; anything else falls back to the substring heuristic that
 * `getEnvironmentRank` uses for legacy names (`prod-us-east` is prod). A name
 * neither can place gives null.
 */
export function canonicalTier(name: string | undefined | null): Tier | null {
	if (!name) return null;
	const exact = ALIASES[name];
	if (exact) return exact;
	const r = getEnvironmentRank(name);
	if (r <= 1) return 'dev';
	if (r <= 3) return 'test';
	if (r <= 5) return 'staging';
	if (r === 6) return null;
	return 'prod';
}

// ── field readers ─────────────────────────────────────────────────────────

/** The site an Environment runs at: spec, else what the controller reports, else "default". */
export function siteOf(env: Environment): string {
	return env.spec?.site || env.status?.wave?.site || DEFAULT_SITE;
}

/** The wave (1-based) of an Environment. */
export function waveOf(env: Environment): number {
	return env.spec?.wave ?? env.status?.wave?.wave ?? 1;
}

/** Leader or Follower as the controller last reported it; null before the first reconcile. */
export function roleOf(env: Environment): WaveRole | null {
	return env.status?.wave?.role ?? null;
}

export function lockstepOf(env: Environment): boolean {
	return !!env.spec?.lockstep;
}

/** The deployment name both sides agree on: `spec.name` with the `kuberik-` prefix. */
export function deployNameOf(env: Environment): string {
	const n = env.spec?.name || env.metadata?.name || '';
	return n.startsWith('kuberik-') ? n : `kuberik-${n}`;
}

// ── WaveReady ─────────────────────────────────────────────────────────────

export type DuplicateOwner = { cluster: string; namespace: string; name: string };

/** Why a site is not progressing, parsed from the WaveReady message. */
export type WaveBlocker =
	/** Waiting for another site: its selection (what 'selection'), or its bake of a revision. */
	| {
			kind: 'member';
			tier: string;
			site: string;
			what: 'selection' | 'bake';
			outcome?: 'failed' | 'cancelled';
			rev?: string;
	  }
	/** The tier it waits on has no registered site. */
	| { kind: 'noSites'; tier: string }
	/** The wave selected a revision this cluster has no release candidate for yet. */
	| { kind: 'candidate'; rev: string }
	/** The local Rollout is pinned to something the wave did not select. */
	| { kind: 'pinned'; pinned: string; selected: string }
	/** A wave is missing (`waves 1,3 (missing 2)`) or the numbering does not start at 1. */
	| { kind: 'gap'; tier: string; waves: number[]; missing: number[]; startsAtOne: boolean }
	/** Lockstep holds the wave-1 leader until this site baked the selection. */
	| { kind: 'lockstep'; tier: string; site: string; rev: string }
	/** Another Environment owns this (name, tier, site). */
	| { kind: 'duplicate'; site: string; tier: string; name: string; owner: DuplicateOwner }
	/** A tier that names itself as its own upstream. */
	| { kind: 'selfUpstream'; tier: string }
	/** Two or more live alias names for one tier (`staging and preprod are the same tier (staging)`). */
	| { kind: 'aliasTier'; names: string[]; tier: string }
	/** The Environment's name is none of the nine tier names (reason UnknownTier). */
	| { kind: 'unknownTier'; name: string }
	/** The message did not match any known format; show `raw`. */
	| { kind: 'unparsed'; reason: string; raw: string };

export type WaveReady = {
	/** True/false from the condition; null when the controller reported no WaveReady condition. */
	ready: boolean | null;
	reason: string;
	raw: string;
	/** Null while ready (or unknown). */
	blocker: WaveBlocker | null;
};

const tierOfMsg = (t: string): string => canonicalTier(t) ?? t;

const RE = {
	selection: /^([^/\s]+)\/(\S+) selection$/,
	bake: /^([^/\s]+)\/(\S+) bake$/,
	bakeOn: /^([^/\s]+)\/(\S+) bake on (\S+)$/,
	bakeEnded: /^([^/\s]+)\/(\S+) bake (failed|cancelled) on (\S+)$/,
	noSites: /^(\S+) has no registered sites$/,
	gap: /^(\S+) has waves ([\d,-]+) \(missing ([\d,]+)\)$/,
	start: /^(\S+) has waves ([\d,-]+) \(waves start at 1\)$/,
	selfUp: /^(\S+) is its own upstream$/,
	alias: /^(.+) are the same tier \((\S+)\)/,
	unknownTier: /^environment "([^"]+)" is not a known tier/,
	pinned: /^pinned to (.+), wave selected (\S+)$/,
	lockstep: /^([^/\s]+)\/(\S+) bake on (\S+)$/,
	duplicate: /^site (\S+) of (\S+) for (\S+) is owned by cluster (\S*) namespace (\S*) name (\S+)$/
};

const nums = (s: string): number[] =>
	s
		.split(',')
		.map((x) => Number(x))
		.filter((n) => Number.isFinite(n));

/** Parse one WaveReady (reason, message) pair. Never throws. */
export function parseWaveBlocker(reason: string, message: string): WaveBlocker {
	const unparsed: WaveBlocker = { kind: 'unparsed', reason, raw: message };
	try {
		let m: RegExpMatchArray | null;
		switch (reason) {
			case 'WaitingFor':
				if ((m = message.match(RE.bakeEnded)))
					return {
						kind: 'member',
						tier: tierOfMsg(m[1]),
						site: m[2],
						what: 'bake',
						outcome: m[3] as 'failed' | 'cancelled',
						rev: m[4]
					};
				if ((m = message.match(RE.bakeOn)))
					return { kind: 'member', tier: tierOfMsg(m[1]), site: m[2], what: 'bake', rev: m[3] };
				if ((m = message.match(RE.bake)))
					return { kind: 'member', tier: tierOfMsg(m[1]), site: m[2], what: 'bake' };
				if ((m = message.match(RE.selection)))
					return { kind: 'member', tier: tierOfMsg(m[1]), site: m[2], what: 'selection' };
				if ((m = message.match(RE.noSites))) return { kind: 'noSites', tier: tierOfMsg(m[1]) };
				return unparsed;
			case 'WaitingForCandidate':
				return message.trim() ? { kind: 'candidate', rev: message.trim() } : unparsed;
			case 'Pinned':
				if ((m = message.match(RE.pinned)))
					return { kind: 'pinned', pinned: m[1], selected: m[2] };
				return unparsed;
			case 'InvalidTopology':
				if ((m = message.match(RE.gap)))
					return {
						kind: 'gap',
						tier: tierOfMsg(m[1]),
						waves: nums(m[2]),
						missing: nums(m[3]),
						startsAtOne: true
					};
				if ((m = message.match(RE.start)))
					return {
						kind: 'gap',
						tier: tierOfMsg(m[1]),
						waves: nums(m[2]),
						missing: [],
						startsAtOne: false
					};
				if ((m = message.match(RE.selfUp))) return { kind: 'selfUpstream', tier: tierOfMsg(m[1]) };
				if ((m = message.match(RE.alias)))
					return {
						kind: 'aliasTier',
						names: m[1].split(/, | and /).map((x) => x.trim()).filter(Boolean),
						tier: tierOfMsg(m[2])
					};
				return unparsed;
			case 'UnknownTier':
				if ((m = message.match(RE.unknownTier))) return { kind: 'unknownTier', name: m[1] };
				return unparsed;
			case 'LockstepWaiting':
				if ((m = message.match(RE.lockstep)))
					return { kind: 'lockstep', tier: tierOfMsg(m[1]), site: m[2], rev: m[3] };
				return unparsed;
			case 'DuplicateSite':
				if ((m = message.match(RE.duplicate)))
					return {
						kind: 'duplicate',
						site: m[1],
						tier: tierOfMsg(m[2]),
						name: m[3],
						owner: { cluster: m[4], namespace: m[5], name: m[6] }
					};
				return unparsed;
			default:
				return unparsed;
		}
	} catch {
		return unparsed;
	}
}

/** `wave-1 leader prod/eu has lockstep=true; disagreeing sites: prod/us, prod/ap` */
export type LockstepMismatch = {
	tier: string;
	leader: string;
	lockstep: boolean;
	sites: { tier: string; site: string }[];
	raw: string;
};

const MISMATCH = /^wave-1 leader ([^/\s]+)\/(\S+) has lockstep=(true|false); disagreeing sites: (.*)$/;

/** The LockstepConsistent=False condition, parsed; null when consistent or unreported. */
export function lockstepMismatch(env: Environment): LockstepMismatch | null {
	try {
		const c = env.status?.conditions?.find((x) => x.type === 'LockstepConsistent');
		if (!c || c.status !== 'False') return null;
		const raw = c.message ?? '';
		const m = raw.match(MISMATCH);
		if (!m) return { tier: '', leader: '', lockstep: false, sites: [], raw };
		return {
			tier: tierOfMsg(m[1]),
			leader: m[2],
			lockstep: m[3] === 'true',
			sites: m[4]
				.split(', ')
				.filter(Boolean)
				.map((s) => {
					const i = s.indexOf('/');
					return i < 0 ? { tier: '', site: s } : { tier: tierOfMsg(s.slice(0, i)), site: s.slice(i + 1) };
				}),
			raw
		};
	} catch {
		return null;
	}
}

/** True while the deprecated `spec.relationship` is still set on the manifest (Deprecated / RelationshipIgnored). */
export function relationshipIgnored(env: Environment): boolean {
	return !!env.status?.conditions?.some(
		(c) => c.type === 'Deprecated' && c.status === 'True' && c.reason === 'RelationshipIgnored'
	);
}

/** The WaveReady condition, structured. Never throws. */
type StatusBlocker = NonNullable<NonNullable<NonNullable<Environment['status']>['wave']>['blocker']>;

/**
 * The controller's structured blocker (status.wave.blocker) as a WaveBlocker.
 * Null when the reason/shape is not one we map; the caller then parses the message.
 */
export function blockerFromStatus(b: StatusBlocker | undefined, reason: string): WaveBlocker | null {
	if (!b) return null;
	const r = b.reason || reason;
	const tier = b.environment ? tierOfMsg(b.environment) : '';
	switch (r) {
		case 'WaitingFor':
			if (b.site && b.waitingOn === 'Selection') return { kind: 'member', tier, site: b.site, what: 'selection' };
			if (b.waitingOn === 'Sites' && tier) return { kind: 'noSites', tier };
			// No site on a Bake wait: the tier has sites but none has baked yet — name the tier.
			if (b.waitingOn === 'Bake' && tier)
				return {
					kind: 'member',
					tier,
					site: b.site || DEFAULT_SITE,
					what: 'bake',
					...(b.outcome ? { outcome: b.outcome === 'Failed' ? 'failed' : 'cancelled' } : {}),
					...(b.revision ? { rev: b.revision } : {})
				};
			return null;
		case 'WaitingForCandidate':
			return b.revision ? { kind: 'candidate', rev: b.revision } : null;
		case 'Pinned':
			return b.pinnedVersion && b.selectedVersion
				? { kind: 'pinned', pinned: b.pinnedVersion, selected: b.selectedVersion }
				: null;
		case 'LockstepWaiting':
			return b.site && b.revision ? { kind: 'lockstep', tier, site: b.site, rev: b.revision } : null;
		case 'DuplicateSite':
			return b.site && b.owner?.name
				? {
						kind: 'duplicate',
						site: b.site,
						tier,
						name: b.names?.[0] ?? '',
						owner: { cluster: b.owner.cluster ?? '', namespace: b.owner.namespace ?? '', name: b.owner.name }
					}
				: null;
		case 'UnknownTier':
			return b.names?.[0] ? { kind: 'unknownTier', name: b.names[0] } : null;
		case 'InvalidTopology':
			if (b.names && b.names.length > 1) return { kind: 'aliasTier', names: b.names, tier };
			if (b.waves && b.waves.length)
				return {
					kind: 'gap',
					tier,
					waves: b.waves,
					missing: b.missingWaves ?? [],
					startsAtOne: (b.missingWaves?.length ?? 0) > 0 || Math.min(...b.waves) === 1
				};
			if (tier) return { kind: 'selfUpstream', tier };
			return null;
		default:
			return null;
	}
}

export function waveReady(env: Environment): WaveReady {
	try {
		const c = env.status?.conditions?.find((x) => x.type === 'WaveReady');
		if (!c) return { ready: null, reason: '', raw: '', blocker: null };
		const raw = c.message ?? '';
		const reason = c.reason ?? '';
		if (c.status === 'True') return { ready: true, reason, raw, blocker: null };
		return {
			ready: c.status === 'False' ? false : null,
			reason,
			raw,
			blocker:
				c.status === 'False'
					? (blockerFromStatus(env.status?.wave?.blocker, reason) ?? parseWaveBlocker(reason, raw))
					: null
		};
	} catch {
		return { ready: null, reason: '', raw: '', blocker: null };
	}
}

// ── topology ──────────────────────────────────────────────────────────────

export type SiteNode = {
	tier: Tier;
	site: string;
	wave: number;
	/** Reported role, else derived from the leader. */
	role: WaveRole;
	isLeader: boolean;
	/** The Environment object, when it is visible to this dashboard. Remote sites have none. */
	env?: Environment;
	/** The member report for this site (its own report wins over other envs' view of it). */
	member?: WaveMember;
	revision?: string;
	bakeStatus?: string;
	deregistered: boolean;
	/** Environments that claim this (name, tier, site) but lost to the owner. */
	duplicates: Environment[];
	ready?: WaveReady;
};

export type WaveNode = {
	wave: number;
	leader: string | null;
	selectedRevision?: string;
	/** Leader first, then by site. Deregistered sites are included. */
	sites: SiteNode[];
};

export type TierNode = {
	tier: Tier;
	waves: WaveNode[];
	/** Every site, in `comparePlaces` order. */
	sites: SiteNode[];
	/** Sites that are not deregistered. */
	liveCount: number;
};

export type AppTopology = {
	deployName: string;
	/** In TIERS order; tiers without sites are omitted. */
	tiers: TierNode[];
	/** Environments whose tier could not be placed. */
	unplaced: Environment[];
};

/** Tier, then wave, then leader first, then site. */
export function comparePlaces(a: SiteNode, b: SiteNode): number {
	const t = TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier);
	if (t) return t;
	if (a.wave !== b.wave) return a.wave - b.wave;
	if (a.isLeader !== b.isLeader) return a.isLeader ? -1 : 1;
	return a.site < b.site ? -1 : a.site > b.site ? 1 : 0;
}

const isDuplicate = (env: Environment): boolean =>
	env.status?.conditions?.some(
		(c) => c.type === 'WaveReady' && c.status === 'False' && c.reason === 'DuplicateSite'
	) ?? false;

type Draft = {
	tier: Tier;
	site: string;
	env?: Environment;
	member?: WaveMember;
	memberOwn: boolean;
	duplicates: Environment[];
};

function buildApp(deployName: string, envs: Environment[]): AppTopology {
	const unplaced: Environment[] = [];
	const drafts = new Map<string, Draft>();
	const draft = (tier: Tier, site: string): Draft => {
		const k = `${tier}\u0000${site}`;
		let d = drafts.get(k);
		if (!d) drafts.set(k, (d = { tier, site, memberOwn: false, duplicates: [] }));
		return d;
	};

	// Owners first, so duplicates can attach to them wherever they appear.
	const dups: { env: Environment; tier: Tier }[] = [];
	for (const env of envs) {
		const tier = canonicalTier(env.spec?.environment);
		if (!tier) {
			unplaced.push(env);
			continue;
		}
		if (isDuplicate(env)) dups.push({ env, tier });
		else draft(tier, siteOf(env)).env ??= env;
	}
	for (const { env, tier } of dups) draft(tier, siteOf(env)).duplicates.push(env);

	// Members: union over every visible env. A site's own report wins.
	for (const env of envs) {
		const ownTier = canonicalTier(env.spec?.environment);
		const ownSite = siteOf(env);
		const ownOk = !isDuplicate(env);
		for (const m of env.status?.wave?.members ?? []) {
			const tier = canonicalTier(m.environment);
			if (!tier) continue;
			const d = draft(tier, m.site);
			const own = ownOk && tier === ownTier && m.site === ownSite;
			if (!d.member || (own && !d.memberOwn)) {
				d.member = m;
				d.memberOwn = own;
			}
		}
	}

	// Leader / selection per (tier, wave).
	const waveOfDraft = (d: Draft): number => (d.env ? waveOf(d.env) : (d.member?.wave ?? 1));
	const byWave = new Map<string, Draft[]>();
	for (const d of drafts.values()) {
		const k = `${d.tier}\u0000${waveOfDraft(d)}`;
		const l = byWave.get(k);
		if (l) l.push(d);
		else byWave.set(k, [d]);
	}
	const dereg = (d: Draft) => !!d.member?.deregistered;

	const tiers: TierNode[] = [];
	for (const tier of TIERS) {
		const waves = new Map<number, WaveNode>();
		const sites: SiteNode[] = [];
		for (const [k, ds] of byWave) {
			if (!k.startsWith(tier + '\u0000')) continue;
			const w = Number(k.slice(tier.length + 1));
			const live = ds.filter((d) => !dereg(d)).map((d) => d.site);
			const reported = ds.map((d) => d.env?.status?.wave).filter((x) => !!x);
			const reportedLeader = reported.find((x) => x?.leader)?.leader;
			const leader =
				reportedLeader ?? (live.length ? live.reduce((a, b) => (b < a ? b : a)) : null);
			const selectedRevision =
				reported.find((x) => x?.site === leader && x?.selectedRevision)?.selectedRevision ??
				reported.find((x) => x?.selectedRevision)?.selectedRevision;
			const nodes: SiteNode[] = ds.map((d) => {
				const deregistered = dereg(d);
				const isLeader = !deregistered && d.site === leader;
				return {
					tier,
					site: d.site,
					wave: w,
					role: (d.env && roleOf(d.env)) || (isLeader ? 'Leader' : 'Follower'),
					isLeader,
					env: d.env,
					member: d.member,
					revision: d.member?.revision,
					bakeStatus: d.member?.bakeStatus,
					deregistered,
					duplicates: d.duplicates,
					ready: d.env ? waveReady(d.env) : undefined
				};
			});
			nodes.sort(comparePlaces);
			waves.set(w, { wave: w, leader, selectedRevision, sites: nodes });
			sites.push(...nodes);
		}
		if (!sites.length) continue;
		sites.sort(comparePlaces);
		tiers.push({
			tier,
			waves: [...waves.values()].sort((a, b) => a.wave - b.wave),
			sites,
			liveCount: sites.filter((s) => !s.deregistered).length
		});
	}
	return { deployName, tiers, unplaced };
}

/** App topology per deployment name (`spec.name`, `kuberik-` prefixed). */
export function buildTopology(environments: Environment[]): Map<string, AppTopology> {
	const groups = new Map<string, Environment[]>();
	for (const env of environments ?? []) {
		if (!env) continue;
		const k = deployNameOf(env);
		const l = groups.get(k);
		if (l) l.push(env);
		else groups.set(k, [env]);
	}
	const out = new Map<string, AppTopology>();
	for (const [k, envs] of groups) out.set(k, buildApp(k, envs));
	return out;
}

const live = (s: SiteNode) => !s.deregistered;

/**
 * Where a site's version comes from.
 *  - a follower: its wave leader
 *  - a wave-N leader (N > 1): the live sites of the nearest lower wave
 *  - a wave-1 leader: the live sites of the last wave of the nearest earlier tier that has any
 */
export function upstreamOf(topo: AppTopology, site: SiteNode): SiteNode[] {
	const tierNode = topo.tiers.find((t) => t.tier === site.tier);
	if (!tierNode) return [];
	const wave = tierNode.waves.find((w) => w.wave === site.wave);
	if (!site.isLeader) {
		const leader = wave?.sites.find((s) => s.isLeader);
		return leader && leader !== site ? [leader] : [];
	}
	for (let n = site.wave - 1; n >= 1; n--) {
		const prev = tierNode.waves.find((w) => w.wave === n)?.sites.filter(live) ?? [];
		if (prev.length) return prev;
	}
	for (let i = TIERS.indexOf(site.tier) - 1; i >= 0; i--) {
		const t = topo.tiers.find((x) => x.tier === TIERS[i]);
		if (!t) continue;
		for (let j = t.waves.length - 1; j >= 0; j--) {
			const ss = t.waves[j].sites.filter(live);
			if (ss.length) return ss;
		}
	}
	return [];
}

/** The inverse of `upstreamOf`: every site that takes its version from `site`. */
export function downstreamOf(topo: AppTopology, site: SiteNode): SiteNode[] {
	const out: SiteNode[] = [];
	for (const t of topo.tiers)
		for (const s of t.sites) if (s !== site && upstreamOf(topo, s).includes(site)) out.push(s);
	return out;
}

/** The SiteNode of an Environment in its app's topology, or undefined (unplaced tier, not in the list). */
export function siteNodeOf(topo: AppTopology | undefined, env: Environment): SiteNode | undefined {
	if (!topo) return undefined;
	const tier = canonicalTier(env.spec?.environment);
	if (!tier) return undefined;
	const site = siteOf(env);
	return topo.tiers.find((t) => t.tier === tier)?.sites.find((s) => s.env === env || s.site === site);
}

/** `placeKey` for a topology node (remote sites included, which have no Environment object). */
export function placeKeyOfSite(topo: AppTopology | undefined, site: SiteNode): string {
	const t = topo?.tiers.find((x) => x.tier === site.tier);
	return t && t.liveCount > 1 ? `${site.tier}-${site.site}` : site.tier;
}

// ── places ────────────────────────────────────────────────────────────────

/**
 * The identity of an Environment as a place: the tier while the tier has at
 * most one live site, `${tier}-${site}` once it has several. An Environment
 * whose tier cannot be placed keeps its raw `spec.environment`.
 */
export function placeKey(env: Environment, topo?: AppTopology): string {
	const tier = canonicalTier(env.spec?.environment);
	if (!tier) return env.spec?.environment ?? '';
	const t = topo?.tiers.find((x) => x.tier === tier);
	return t && t.liveCount > 1 ? `${tier}-${siteOf(env)}` : tier;
}

/** The short label of a place. Same shape as the key; kept separate so the label can diverge from the URL key. */
export function placeLabel(env: Environment, topo?: AppTopology): string {
	return placeKey(env, topo);
}

const topoCache = new WeakMap<Environment[], Map<string, AppTopology>>();

/** `placeKey` for callers that hold the whole Environment list; the topology is built once per array. */
export function placeKeyOf(env: Environment, environments: Environment[]): string {
	let topos = topoCache.get(environments);
	if (!topos) topoCache.set(environments, (topos = buildTopology(environments)));
	return placeKey(env, topos.get(deployNameOf(env)));
}

/** Convenience for the type export. */
export type { TierName };
