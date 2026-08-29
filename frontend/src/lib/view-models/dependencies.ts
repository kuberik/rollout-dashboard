import { getDisplayVersion } from '$lib/utils';
import type { BlockedRelease, RolloutDependency } from '../../types';
import { dependencyCondition } from '../../types/rollout-dependency-types';

/**
 * THE TWO DEPENDENCY AXES OF ONE ROLLOUT - derived once, here, so the page
 * renders and does not compute.
 *
 * A rollout is held back by two genuinely different things and this module
 * keeps them apart on purpose. They are NEVER folded into one list:
 *
 *   1. ENVIRONMENT DEPENDENCY - promotion order INSIDE one service.
 *      `Environment.status.environmentInfos[].relationship` is an `After`
 *      edge: staging runs after dev, prod after staging. The question is
 *      "HOW FAR HAVE I GOT" and the answer is a position on this app's own
 *      line. Rendered as the promotion chain.
 *
 *   2. CONTRACT GATE (`RolloutDependency`) - a CROSS-SERVICE contract.
 *      A consumer release declares `com.kuberik.rollout.requires.<contract>`
 *      as a semver constraint; the controller holds that release until the
 *      PROVIDER Rollout has deployed something satisfying it. The question is
 *      "AM I ALLOWED TO GO AT ALL" and the answer is about ANOTHER SERVICE.
 *      Rendered as the contract blocks.
 *
 * One is a distance, the other is a permission. A single list of
 * "dependencies" holding `prod depends on staging` beside `frontend depends
 * on api` would be two different relations in one geometry, which is the
 * defect `env-rank.ts` was written to stop one level down.
 */

/**
 * `Satisfied=True` - no release the consumer could deploy next is held back.
 *
 * IT IS THE NORM AND ALMOST ALWAYS TRUE, so NOTHING IN THE UI MAY DRAW IT.
 * This predicate exists for the negative case and for tooltips. Three
 * components were cut from this product for painting the norm; a green
 * "satisfied" mark on every contract on every page would be the fourth.
 *
 * A MISSING CONDITION IS NOT `false`. `dependencyCondition` returns undefined
 * for a gate that has not been evaluated, and this returns false for it - but
 * callers must not read that as "unsatisfied", which is why nothing on the page
 * renders on this predicate alone. `blockedReleases` is what the page draws.
 */
export function isSatisfied(dep: RolloutDependency): boolean {
	return dependencyCondition(dep, 'Satisfied')?.status === 'True';
}

/** `Ready=False` means the gate could not be evaluated - a different fact. */
export function isReady(dep: RolloutDependency): boolean {
	return dependencyCondition(dep, 'Ready')?.status === 'True';
}

/** The `Satisfied` condition's message, for a tooltip. Never rendered as prose. */
export function satisfiedMessage(dep: RolloutDependency): string {
	return dependencyCondition(dep, 'Satisfied')?.message ?? '';
}

// -------------------------------------------------------------------------
// THE BUILD ORDER
// -------------------------------------------------------------------------

export type Release = {
	tag: string;
	version?: string;
	revision?: string;
	created?: string;
};

/** One build of this rollout: its tag, what to print for it, and its rank. */
export type Build = {
	tag: string;
	/** What the UI prints - `version` if the release carries one, else the tag. */
	display: string;
	/** 0 = newest. */
	rank: number;
};

/**
 * This rollout's builds, NEWEST FIRST, keyed by tag.
 *
 * `status.availableReleases` IS NOT SORTED NEWEST-FIRST AND THE PAGE THIS
 * REPLACES ASSUMED IT WAS. Measured on the live hub, `hello-frontend-app`
 * returns `rel-2, rel-63, rel-64, rel-66` - OLDEST first - while the old
 * `environments/+page.svelte` carried the comment *"availableReleases are
 * already sorted newest first"* and indexed straight into it, so every rank
 * it derived from that array had its sign inverted. It never surfaced because
 * the only consumer that could show it (the version/environment dot table)
 * was behind `{#if false}`.
 *
 * So the order is DERIVED, from `created`, which is a property of the build.
 * Ties fall back to the array's own order, which keeps the sort stable.
 */
export function buildOrder(releases: Release[] | null | undefined): Build[] {
	const list = releases ?? [];
	const withIdx = list.map((r, i) => ({ r, i }));
	withIdx.sort((a, b) => {
		const ta = a.r.created ? new Date(a.r.created).getTime() : NaN;
		const tb = b.r.created ? new Date(b.r.created).getTime() : NaN;
		const va = Number.isFinite(ta) ? ta : null;
		const vb = Number.isFinite(tb) ? tb : null;
		if (va !== null && vb !== null && va !== vb) return vb - va;
		if (va !== null && vb === null) return -1;
		if (va === null && vb !== null) return 1;
		return b.i - a.i;
	});
	const out: Build[] = [];
	const seen = new Set<string>();
	for (const { r } of withIdx) {
		if (!r.tag || seen.has(r.tag)) continue;
		seen.add(r.tag);
		out.push({ tag: r.tag, display: getDisplayVersion(r), rank: out.length });
	}
	return out;
}

/** Rank of a tag on this rollout's ladder. `-1` when it is not on it. */
export function rankOfTag(order: Build[], tag: string | null | undefined): number {
	if (!tag) return -1;
	const b = order.find((x) => x.tag === tag);
	return b ? b.rank : -1;
}

/** What to print for a tag. Falls back to the tag when the build is unknown. */
export function displayOfTag(order: Build[], tag: string): string {
	return order.find((x) => x.tag === tag)?.display ?? tag;
}

// -------------------------------------------------------------------------
// THE ADVERSE CASE
// -------------------------------------------------------------------------

export type BlockedSplit = {
	/**
	 * Blocked builds that are NEWER than what this environment is running -
	 * builds a person WANTS and cannot have. This is the adverse set and the
	 * only one the page draws.
	 */
	wanted: BlockedRelease[];
	/** Blocked builds at or behind what is already running. Counted, not drawn. */
	past: BlockedRelease[];
};

/**
 * SPLIT `blockedReleases` BY WHETHER ANYONE WANTS THE BUILD.
 *
 * THIS IS THE DESIGN DECISION THAT KEEPS THE PAGE HONEST, and the live
 * cluster is the reason it exists. `hello-frontend-app` is running `rel-66`
 * and its contract gate blocks `rel-2` - the app's OLDEST build, which wanted
 * an ancient contract version. Drawing an alarm for that would be marking the
 * gate WORKING as a problem: nobody is going to deploy `rel-2`, and no action
 * follows from knowing it is blocked.
 *
 * A blocked build is adverse exactly when it is NEWER than what is deployed:
 * then it is the build the pipeline would have moved to, and a contract is
 * why it did not. That is the one case that needs a person.
 *
 * When the environment has never deployed, everything blocked is wanted -
 * there is no "already past it".
 *
 * A blocked tag that is not on this rollout's ladder at all is treated as
 * WANTED. Silence there would hide a real block behind a retention window;
 * `everIn()` on `/apps/[name]` records the same rule - an empty set proves
 * nothing, so never turn a missing entry into a claim that it does not matter.
 */
export function splitBlocked(
	blocked: BlockedRelease[] | null | undefined,
	order: Build[],
	currentTag: string | null | undefined
): BlockedSplit {
	const all = blocked ?? [];
	const cur = rankOfTag(order, currentTag);
	if (cur < 0) return { wanted: [...all], past: [] };
	const wanted: BlockedRelease[] = [];
	const past: BlockedRelease[] = [];
	for (const b of all) {
		const r = rankOfTag(order, b.tag);
		// rank 0 is newest, so a SMALLER rank is a NEWER build.
		if (r < 0 || r < cur) wanted.push(b);
		else past.push(b);
	}
	// Newest first, so the build closest to shipping reads first.
	wanted.sort((a, b) => rankOfTag(order, a.tag) - rankOfTag(order, b.tag));
	return { wanted, past };
}

// -------------------------------------------------------------------------
// AXIS 2 - THE CONTRACT BLOCKS
// -------------------------------------------------------------------------

/** One environment's row inside a contract block. */
export type ContractEnvEntry = {
	/** Environment tier name - `dev`, `prod-eu-central`. */
	env: string;
	namespace: string;
	dep: RolloutDependency;
	/** Blocked builds this environment wants and cannot have. */
	wanted: BlockedRelease[];
	/** Blocked builds already behind it. Counted at BLOCK scope, not per row. */
	pastTags: string[];
	satisfied: boolean;
	ready: boolean;
};

/**
 * ONE BLOCKED BUILD, AND EVERY ENVIRONMENT HOLDING IT.
 *
 * THE SUBJECT IS THE BUILD, NOT THE ENVIRONMENT, and that is not a layout
 * preference - it is where the fact lives. The constraint comes from the
 * BUILD's own `com.kuberik.rollout.requires.<contract>` OCI annotation, so
 * the same tag asks the same thing of the same contract in every
 * environment. Keyed by environment instead, a fleet held on two builds
 * printed EIGHT rows for four environments and repeated
 * `requires payments ^3.0.0` four times; keyed by build it is two rows and
 * the environments wrap as chips after them. Same grouping `/versions`'
 * bucket cards use, for the same reason.
 *
 * `reason` IS PART OF THE KEY. It is an open string written per gate, and
 * the live cluster proves it varies for one build across clusters
 * (`ConstraintNotSatisfied` on the spoke, `ProviderVersionTooOld` on the
 * hub). Two environments that disagree about WHY get two rows, because
 * folding them would have to pick one and print it as the truth.
 */
export type BlockedBuild = {
	key: string;
	tag: string;
	/** What to print for the build. */
	display: string;
	requiredVersion: string | null;
	reason: string | null;
	/** Environments held on this build, in promotion order. */
	envs: string[];
};

/** One contract, across every environment of this app that is gated on it. */
export type ContractBlock = {
	key: string;
	contract: string;
	providerName: string;
	providerNamespace: string;
	/** Contract version the provider has deployed. Null when it has none. */
	providedVersion: string | null;
	providedTag: string | null;
	/** Environments gated on this contract, in promotion order. */
	entries: ContractEnvEntry[];
	/** The adverse rows: one per blocked build, newest first. */
	blocked: BlockedBuild[];
	/**
	 * DISTINCT tags this contract blocks that are already behind every
	 * environment that would take them - the gate working on candidates nobody
	 * will deploy.
	 *
	 * IT IS DE-DUPLICATED ACROSS ENVIRONMENTS ON PURPOSE. Per-environment it
	 * printed `1 older build blocked in dev · 1 older build blocked in staging
	 * · 1 older build blocked in prod` for what is ONE build blocked by ONE
	 * contract - three restatements of a fact that needs no action, on the
	 * quietest page state there is. The count is the number of BUILDS, because
	 * that is what a reader would go looking for.
	 */
	pastTags: string[];
	/** Environments of this app this contract does NOT gate, in order. */
	ungatedEnvs: string[];
	/**
	 * How many of the app's environments this contract does NOT gate.
	 *
	 * THE ASYMMETRY, AS A NUMBER. A contract that gates dev and staging but
	 * not prod is the most interesting thing this page can say, and it is
	 * invisible in any per-environment mark: an ungated environment has no
	 * row to put a mark on. It is 0 whenever the contract gates every
	 * environment, and the UI prints NOTHING at 0 - mark the deviation, never
	 * the norm, applied to the asymmetry itself.
	 */
	ungated: number;
	/** True when at least one environment wants a build this contract blocks. */
	adverse: boolean;
};

/**
 * Group every dependency of this app by contract.
 *
 * `envOf` maps a dependency's namespace to the environment tier it belongs
 * to, and `envOrder` gives the environments' promotion order - both come from
 * the page, which is the only place that knows this app's environment
 * bindings.
 */
export function contractBlocks(args: {
	deps: RolloutDependency[];
	/** Environment tier for a dependency's namespace, or null if unknown. */
	envOf: (namespace: string) => string | null;
	/** Promotion order of the app's environments, upstream first. */
	envOrder: string[];
	/** This rollout's build ladder, for ranking blocked tags. */
	order: Build[];
	/** Tag currently deployed in each environment. */
	currentTagOf: (env: string) => string | null;
}): ContractBlock[] {
	const { deps, envOf, envOrder, order, currentTagOf } = args;
	const byContract = new Map<string, ContractBlock>();

	for (const dep of deps) {
		const ns = dep.metadata?.namespace ?? '';
		const env = envOf(ns);
		if (!env) continue;
		const contract = dep.spec?.contract ?? '';
		if (!contract) continue;
		const provider = dep.spec?.providerRef?.name ?? '';
		const key = `${contract} ${provider}`;
		let block = byContract.get(key);
		if (!block) {
			block = {
				key,
				contract,
				providerName: provider,
				providerNamespace: dep.spec?.providerRef?.namespace ?? dep.metadata?.namespace ?? '',
				providedVersion: null,
				providedTag: null,
				ungatedEnvs: [],
				entries: [],
				blocked: [],
				pastTags: [],
				ungated: 0,
				adverse: false
			};
			byContract.set(key, block);
		}
		// The provider's deployed contract version is a fact about the
		// PROVIDER, so every gate on this contract reports the same one. Take
		// the first non-null rather than re-stating it per environment.
		if (block.providedVersion === null && dep.status?.providedVersion) {
			block.providedVersion = dep.status.providedVersion;
			block.providedTag = dep.status.providedTag ?? null;
		}
		const split = splitBlocked(dep.status?.blockedReleases, order, currentTagOf(env));
		block.entries.push({
			env,
			namespace: ns,
			dep,
			wanted: split.wanted,
			pastTags: split.past.map((x) => x.tag),
			satisfied: isSatisfied(dep),
			ready: isReady(dep)
		});
	}

	const rank = new Map(envOrder.map((e, i) => [e, i] as const));
	const blocks = [...byContract.values()];
	for (const b of blocks) {
		b.entries.sort(
			(x, y) => (rank.get(x.env) ?? 999) - (rank.get(y.env) ?? 999) || x.env.localeCompare(y.env)
		);
		const gated = new Set(b.entries.map((e) => e.env));
		b.ungatedEnvs = envOrder.filter((e) => !gated.has(e));
		b.ungated = b.ungatedEnvs.length;
		b.adverse = b.entries.some((e) => e.wanted.length > 0);

		const past = new Set<string>();
		for (const e of b.entries) for (const t of e.pastTags) past.add(t);
		b.pastTags = [...past].sort((x, y) => rankOfTag(order, x) - rankOfTag(order, y));

		const byBuild = new Map<string, BlockedBuild>();
		for (const e of b.entries) {
			for (const w of e.wanted) {
				const req = w.requiredVersion ?? null;
				const reason = w.reason ?? null;
				const key = `${w.tag}|${req ?? ''}|${reason ?? ''}`;
				let row = byBuild.get(key);
				if (!row) {
					row = {
						key,
						tag: w.tag,
						display: displayOfTag(order, w.tag),
						requiredVersion: req,
						reason,
						envs: []
					};
					byBuild.set(key, row);
				}
				if (!row.envs.includes(e.env)) row.envs.push(e.env);
			}
		}
		b.blocked = [...byBuild.values()];
		for (const row of b.blocked) {
			row.envs.sort((x, y) => (rank.get(x) ?? 999) - (rank.get(y) ?? 999));
		}
		// Newest first: the build closest to shipping is the one to look at.
		b.blocked.sort(
			(x, y) => rankOfTag(order, x.tag) - rankOfTag(order, y.tag) || x.key.localeCompare(y.key)
		);
	}
	// Adverse contracts first - the page's one ordering decision, and it is
	// the standing "worst first" rule every list in this product already uses.
	blocks.sort(
		(a, b) =>
			Number(b.adverse) - Number(a.adverse) ||
			a.contract.localeCompare(b.contract) ||
			a.providerName.localeCompare(b.providerName)
	);
	return blocks;
}

// -------------------------------------------------------------------------
// AXIS 1 - THE PROMOTION CHAIN
// -------------------------------------------------------------------------

export type EnvHistoryEntry = {
	id?: number;
	version: Release;
	timestamp?: string;
	bakeStatus?: string;
};

export type EnvInfo = {
	environment: string;
	environmentUrl?: string;
	relationship?: { environment: string; type: string };
	history?: EnvHistoryEntry[];
};

export type ChainEnv = {
	env: string;
	/** Newest history entry, i.e. what this environment is running now. */
	tag: string | null;
	display: string | null;
	bakeStatus: string | null;
	timestamp: string | null;
	/** Rank on this rollout's ladder. -1 when unresolvable. */
	rank: number;
	/** The environment this one runs After, or null for the head of the line. */
	after: string | null;
};

/**
 * Order the environments by their `After` relationships, upstream first.
 *
 * `Environment.status.environmentInfos` arrives in no guaranteed order and
 * carries `relationship: { type: 'After', environment }` on every node but
 * the first. Walking the edges is the only ordering that is a FACT about the
 * pipeline; `compareEnvironmentNames` is a heuristic on the NAME and would
 * silently reorder a chain that does not use the conventional tier words.
 *
 * Anything the walk cannot place (a cycle, a dangling `After`, a second head)
 * is appended in the order it arrived rather than dropped - an environment
 * missing from this list cannot be located at all, which is the same reason
 * `/apps/[name]` marks a diverged environment instead of filtering it out.
 */
export function chainOrder(infos: EnvInfo[]): string[] {
	const names = infos.map((i) => i.environment);
	const after = new Map<string, string | null>();
	for (const i of infos) {
		after.set(
			i.environment,
			i.relationship?.type === 'After' ? (i.relationship.environment ?? null) : null
		);
	}
	const children = new Map<string, string[]>();
	const heads: string[] = [];
	for (const n of names) {
		const a = after.get(n) ?? null;
		if (a && names.includes(a)) {
			if (!children.has(a)) children.set(a, []);
			children.get(a)!.push(n);
		} else {
			heads.push(n);
		}
	}
	const out: string[] = [];
	const seen = new Set<string>();
	const walk = (n: string) => {
		if (seen.has(n)) return;
		seen.add(n);
		out.push(n);
		for (const c of children.get(n) ?? []) walk(c);
	};
	for (const h of heads) walk(h);
	for (const n of names) if (!seen.has(n)) out.push(n);
	return out;
}

/** Newest deploy in an environment's history - the one it is running now. */
export function currentEntry(info: EnvInfo | undefined): EnvHistoryEntry | null {
	const h = info?.history ?? [];
	if (h.length === 0) return null;
	return [...h].sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
}

/** The chain, as rows. One per environment, upstream first. */
export function chain(infos: EnvInfo[], order: Build[]): ChainEnv[] {
	const byName = new Map(infos.map((i) => [i.environment, i] as const));
	return chainOrder(infos).map((env) => {
		const info = byName.get(env);
		const cur = currentEntry(info);
		const tag = cur?.version?.tag ?? null;
		return {
			env,
			tag,
			display: cur ? getDisplayVersion(cur.version) : null,
			bakeStatus: cur?.bakeStatus ?? null,
			timestamp: cur?.timestamp ?? null,
			rank: rankOfTag(order, tag),
			after: info?.relationship?.type === 'After' ? (info.relationship.environment ?? null) : null
		};
	});
}

export type ChainHop = { waiting: number; label: string };

/**
 * The gap on one promotion edge - `rank(downstream) - rank(upstream)`, both
 * read off the ONE ladder, so it is the number of builds that must cross
 * this edge.
 *
 * IT PRINTS NOTHING WHEN IT CANNOT COUNT. When either side is off the ladder
 * or has never deployed, a `0` would read as "in sync", which is a claim the
 * data does not support. Same contract as `hopBetween` on `/apps/[name]` and
 * as `newerReleaseCount` returning null rather than 0.
 *
 * IT ALSO PRINTS NOTHING WHEN THE EDGE IS IN SYNC. The rail is SOLID in that
 * case and that is the mark; `in sync` on every hop of a healthy app is the
 * page marking the norm once per edge, in prose, which the human rejected on
 * `/apps/[name]` with *"Text doesn't cut it and just pollutes."*
 */
export function hopBetween(up: ChainEnv | null, down: ChainEnv | null): ChainHop {
	if (!up || !down) return { waiting: 0, label: '' };
	if (!up.tag || !down.tag) return { waiting: 0, label: '' };
	if (up.rank < 0 || down.rank < 0) return { waiting: 0, label: '' };
	const n = down.rank - up.rank;
	if (n > 0) return { waiting: n, label: `${n} waiting` };
	if (n < 0) return { waiting: 0, label: `${-n} ahead` };
	return { waiting: 0, label: '' };
}
