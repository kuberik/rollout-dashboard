/**
 * THE PROMOTION MAP's model — where every build is, as a staircase of
 * environments. (Home v2, CRAFT-STUDY §5(a): "one object with visual weight
 * per screen"; the object is the isometric environment staircase of the
 * landing film, brought into the product.)
 *
 * Pure. Built from the same `Lane`s Home's fleet list draws
 * (`promotion-lanes.ts`), so the map can never disagree with the rows under
 * it about a rollout's state.
 *
 * Shape (DESIGN-INTENT: stages are a LINE, production regions are a SET):
 *   - `steps` are the stages in promotion order, then ONE production step
 *     whose `regions` are the set (drawn as a fan of squares, never as more
 *     steps);
 *   - on every step, one `MapCube` per APP that runs there: its worst state
 *     in that step (an app in five prod regions is one cube, its regions
 *     summarised in the step's fan);
 *   - `packets` are builds in flight: a node that is DEPLOYING travels from
 *     the previous step of ITS OWN chain to the step it is deploying into
 *     (apps own their chains; one may skip staging). Checking is not a packet:
 *     the build has landed and is being watched, so it is a ring on the cube.
 *   - `gates` count held cubes per step — a build parked at that step's gate.
 *
 * Granularity: `tier` folds every stage environment into its tier (Home: the
 * fleet's shape at a glance); `environment` gives every stage environment its
 * own step (/environments).
 */
import type { RolloutCard } from '$lib/rollout-cards';
import { getEnvironmentRank } from '$lib/env-order';
import { shortenVersion } from '$lib/utils';
import { buildLanes, STATE_ORDER, type Lane, type LaneNode, type NodeState, type Tier } from './promotion-lanes';
import type { FleetFacts, StageFacts } from './fleet-facts';
import { waitsFor } from './held';

/** `tier`: Home (stages folded by tier). `environment`: /environments (one step
 *  per stage environment). `app`: /apps/[name] (one app's own chain). */
export type MapGranularity = 'tier' | 'environment' | 'app';

export type MapCube = {
	key: string;
	app: string;
	state: NodeState;
	/** The rollout this cube stands for (the worst node, for a set). */
	card: RolloutCard;
	/** Builds behind the newest (the worst node's), 0 when on it. */
	behind: number;
	version: string | null;
	/** Production at fleet granularity: how many regions this app runs in
	 *  (the block is the APP, its worst region). Absent elsewhere. */
	regions?: number;
	/** Fleet granularity: how many places (rollouts) this app has in the step,
	 *  and the ones a rule or a person refuses here (`card.held`, the frontier
	 *  rule) with their cause label, for the map's one held callout per app. */
	places?: number;
	heldPlaces?: { env: string; causeLabel: string | null }[];
};

export type MapRegion = {
	name: string;
	state: NodeState;
	apps: number;
	onNewest: number;
	/** App granularity: the build this region runs. */
	version?: string | null;
	card?: RolloutCard;
	/** App granularity exceptions only: WHY this region is one — held's own
	 *  cause ("held · payments-svc"), or "custom build" for a real
	 *  diverged/unreleased build (`rank.kind === 'diverged'`). Checking and
	 *  failed/stuck need no extra clause, their state word already says why
	 *  (AD app r6 #1). `undefined` on a non-exception row (the fold, "you
	 *  are here") — the component falls back to the plain state word there. */
	reason?: string;
};

/** One build's share of the prod set's healthy fold: AD app r6 #1 — a set
 *  that disagrees among its HEALTHY regions (edge-mesh: 10 on a92c6f4, 2 on
 *  16d8b70, neither is an exception) folds into ONE group per build, never a
 *  single "the same build" that is false for a mixed set. Sorted biggest
 *  first so the fold's own pressable line reads "10 on a92c6f4 · 2 on
 *  16d8b70", largest group named first. */
export type MapFoldGroup = {
	/** The build every region in this group runs; null when none has one. */
	version: string | null;
	regions: MapRegion[];
};

export type MapStep = {
	key: string;
	/** What the step is called: a tier (`staging`) or an environment name. */
	label: string;
	tier: Tier;
	prod: boolean;
	cubes: MapCube[];
	/** Apps with a rollout in this step. */
	apps: number;
	/** Apps whose every rollout in this step is on its newest build. */
	onNewest: number;
	counts: Partial<Record<NodeState, number>>;
	/** The most urgent cube state on this step. */
	lead: NodeState;
	/** Production only: the set of regions, worst state per region. */
	regions: MapRegion[];
	/** One environment name when the step is exactly one environment (for /envs/<name>). */
	env: string | null;
	/** That environment's identity theme (its 6px dot), when `env` is set. */
	theme: RolloutCard['theme'] | null;
	/** The step's own state (its StatusMark on the status line). Same as `lead`. */
	status: NodeState;
	/** App granularity: the build this step runs (the prod set's majority build). */
	version: string | null;
	/** Prod set only: the regions that need reading (held, checking, failing,
	 *  stuck, deploying, or running a real diverged/unreleased build). */
	exceptions: MapRegion[];
	/** Prod set only: the healthy rest, grouped by build, each group its own
	 *  pressable "Show N regions on <build>" line. */
	foldGroups: MapFoldGroup[];
};

export type MapPacket = {
	key: string;
	app: string;
	/** Step keys. `from` is null when the app has no earlier step (its first environment). */
	from: string | null;
	to: string;
	version: string | null;
	card: RolloutCard;
};

export type MapModel = {
	granularity: MapGranularity;
	steps: MapStep[];
	/** The first step (in promotion order) not on the newest build; null when all are. */
	frontier: string | null;
	/** The steps the newest build has reached, in order, up to the frontier. */
	path: string[];
	packets: MapPacket[];
	/** Held cubes per step key (a build parked at that step's gate). */
	gates: Record<string, number>;
	/** Totals across the map, for the header and the reduced/sr form. */
	moving: number;
	held: number;
	failing: number;
};

const rank = (s: NodeState) => STATE_ORDER.indexOf(s);
const worst = (a: NodeState, b: NodeState) => (rank(a) <= rank(b) ? a : b);

/** ⭐ shared/fleet-facts round 5 (QA r6 S6) — EXPORTED so a page's own
 *  filter can match the map's own step, instead of a second rank rule
 *  reimplementing "is this environment the `prod` step" (`/environments`'
 *  `env-step-filter.ts` used `getEnvironmentRank(env) >= 7` directly, which
 *  is `tierOf`'s own test restated — this is the ONE place that decision is
 *  made, for the map's own steps and for any filter matching them). Takes
 *  the tier/env pair directly (not a `LaneNode`) so a caller with only an
 *  environment NAME (no node in hand) can still ask. */
export function stepKeyOf(tier: Tier, env: string, granularity: MapGranularity): string {
	if (tier === 'prod') return 'prod';
	return granularity === 'tier' ? tier : env; // environment and app: one step per stage env
}

export function fleetMap(
	input: { cards?: RolloutCard[]; lanes?: Lane[] },
	opts: {
		granularity?: MapGranularity;
		/** ⭐ shared/fleet-facts (2026-10-10): when given, each step's
		 *  `counts` (what `stepFacts` below sums into the caption sentence)
		 *  are taken from `facts.byTier`/`facts.byEnv`'s `appsByState` — one per
		 *  APP, its worst place in the step — the same unit as the blocks drawn
		 *  and the "of N apps" figure (home-map, 2026-10-11; was PLACE counts,
		 *  which put "3 held" under two orange blocks). Omit it and a step
		 *  keeps its own cube-based tally. */
		facts?: FleetFacts;
	} = {}
): MapModel {
	const granularity = opts.granularity ?? 'tier';
	const lanes = input.lanes ?? buildLanes(input.cards ?? []);

	type Acc = { key: string; label: string; tier: Tier; order: number; envs: Set<string>; byApp: Map<string, LaneNode[]> };
	const acc = new Map<string, Acc>();
	const regionAcc = new Map<string, LaneNode[]>();

	for (const lane of lanes) {
		for (const n of [...lane.stages, ...lane.prod]) {
			const key = stepKeyOf(n.tier, n.env, granularity);
			let a = acc.get(key);
			if (!a) {
				a = {
					key,
					label: key === 'prod' ? 'prod' : key,
					tier: n.tier,
					order: n.tier === 'prod' ? 1000 : getEnvironmentRank(n.card.envName || n.env) * 10,
					envs: new Set(),
					byApp: new Map()
				};
				acc.set(key, a);
			}
			a.envs.add(n.env);
			const list = a.byApp.get(lane.app) ?? [];
			list.push(n);
			a.byApp.set(lane.app, list);
			if (n.tier === 'prod') {
				const r = regionAcc.get(n.env) ?? [];
				r.push(n);
				regionAcc.set(n.env, r);
				(regionAcc.get('__all') ?? regionAcc.set('__all', []).get('__all')!).push(n);
			}
		}
	}

	const ordered = [...acc.values()].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
	const stepIndex = new Map(ordered.map((a, i) => [a.key, i]));

	const steps: MapStep[] = ordered.map((a) => {
		const cubes: MapCube[] = [];
		let onNewest = 0;
		const counts: Partial<Record<NodeState, number>> = {};
		for (const [app, nodes] of [...a.byApp.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
			let lead = nodes[0];
			for (const n of nodes) if (rank(n.state) < rank(lead.state)) lead = n;
			if (nodes.every((n) => n.state === 'newest')) onNewest++;
			counts[lead.state] = (counts[lead.state] ?? 0) + 1;
			cubes.push({
				key: `${a.key}|${app}`,
				app,
				state: lead.state,
				card: lead.card,
				behind: lead.behind,
				version: lead.card.version ? shortenVersion(lead.card.version) : null,
				...(a.key === 'prod' ? { regions: nodes.length } : {}),
				places: nodes.length,
				heldPlaces: nodes
					// `card.held` (the frontier rule), not the node's lead state: a
					// region checking its running build while the NEWER one is refused
					// there is still a held place (checkout-api in prod-us-east-2).
					.filter((n) => n.card.held || n.state === 'held')
					.map((n) => ({ env: n.card.envDisplay || n.card.envName || n.env, causeLabel: n.card.heldCauseLabel ?? null }))
			});
		}
		// ⭐ shared/fleet-facts (2026-10-10): the caption's numbers come from
		// `facts.byTier`/`facts.byEnv` when given — PLACE counts, which for a
		// multi-region prod step differ from the cube tally above (one cube per
		// APP, worst region wins). `stepFacts` below reads `counts`, so this is
		// the one place that swap happens; the cubes themselves stay app-level.
		if (opts.facts) {
			// `prod` is always ONE step, in every granularity (`stepKeyOf`
			// below folds every prod-tier node into the key `'prod'` whether
			// `granularity` is `'tier'` or `'environment'`) — so its facts come
			// from `byTier.prod`, never `byEnv`, which has no `'prod'` entry.
			const stage: StageFacts | undefined =
				a.key === 'prod' ? opts.facts.byTier.prod : granularity === 'environment' ? opts.facts.byEnv[a.key] : opts.facts.byTier[a.tier];
			// home-map (round-6 read, "held 5 vs 4"): the caption counts the
			// BLOCKS drawn on the plate — fleet-facts' per-app `appsByState` tally —
			// so it never mixes regions into an "of N apps" line. Places stay
			// in fleet-facts for the surfaces that speak regions.
			if (stage) {
				const p = stage.appsByState;
				counts.held = p.held;
				counts.failed = p.failed;
				counts.stuck = p.stuck;
				counts.behind = p.behind;
				counts.deploying = p.deploying;
				counts.checking = p.checking;
			}
		}
		const lead = cubes.reduce<NodeState>((s, c) => worst(s, c.state), 'none');
		const regions: MapRegion[] =
			a.key === 'prod'
				? [...regionAcc.entries()]
						.filter(([name]) => name !== '__all')
						.map(([name, nodes]) => ({
							name,
							state: nodes.reduce<NodeState>((s, n) => worst(s, n.state), 'none'),
							apps: nodes.length,
							onNewest: nodes.filter((n) => n.state === 'newest').length
						}))
						.sort((x, y) => x.name.localeCompare(y.name))
				: [];
		return {
			key: a.key,
			// `other` is a bucket, not a name: print the environment when there is one.
			label: a.key === 'other' && a.envs.size === 1 ? [...a.envs][0] : a.label,
			tier: a.tier,
			prod: a.key === 'prod',
			cubes,
			apps: a.byApp.size,
			onNewest,
			counts,
			lead: cubes.length ? lead : 'none',
			regions,
			env: a.envs.size === 1 ? [...a.envs][0] : null,
			// Production is one identity (the prod preset) even as a set of regions.
			theme: a.envs.size === 1 || a.key === 'prod' ? (cubes[0]?.card.theme ?? null) : null,
			status: cubes.length ? lead : 'none',
			...setFacts(a.key === 'prod' ? (regionAcc.get('__all') ?? []) : [], granularity),
			version: null
		};
	});

	// Packets: every deploying node travels from the previous step of its OWN
	// chain. Several prod regions deploying the same build at once are one
	// packet per app, not one per region.
	const packets: MapPacket[] = [];
	const seen = new Set<string>();
	for (const lane of lanes) {
		const chainSteps = [...new Set([...lane.stages, ...lane.prod].map((n) => stepKeyOf(n.tier, n.env, granularity)))].sort(
			(x, y) => (stepIndex.get(x) ?? 0) - (stepIndex.get(y) ?? 0)
		);
		for (const n of [...lane.stages, ...lane.prod]) {
			if (n.state !== 'deploying') continue;
			const to = stepKeyOf(n.tier, n.env, granularity);
			const k = `${lane.app}|${to}`;
			if (seen.has(k)) continue;
			seen.add(k);
			const i = chainSteps.indexOf(to);
			packets.push({
				key: k,
				app: lane.app,
				from: i > 0 ? chainSteps[i - 1] : null,
				to,
				version: n.card.version ? shortenVersion(n.card.version) : null,
				card: n.card
			});
		}
	}

	const gates: Record<string, number> = {};
	let held = 0;
	let failing = 0;
	for (const s of steps) {
		const h = s.counts.held ?? 0;
		if (h) gates[s.key] = h;
		held += h;
		failing += (s.counts.failed ?? 0) + (s.counts.stuck ?? 0);
	}

	const checking = steps.reduce((n, s) => n + (s.counts.checking ?? 0), 0);
	return { granularity, steps, ...frontierOf(steps), packets, gates, moving: packets.length + checking, held, failing };
}

/** Frontier and path: the newest build's reach, in promotion order. */
function frontierOf(steps: MapStep[]): { frontier: string | null; path: string[] } {
	const path: string[] = [];
	for (const s of steps) {
		if (s.apps > 0 && s.onNewest === s.apps) path.push(s.key);
		else return { frontier: s.key, path };
	}
	return { frontier: null, path };
}

const EXCEPTION: NodeState[] = ['failed', 'stuck', 'held', 'deploying', 'checking'];

/** Prod-set facts for app granularity: exceptions, and the healthy rest folded.
 *
 * A region is an exception when it needs a person (`EXCEPTION`) or runs a
 * build off the normal release line (`rank.kind === 'diverged'` — a real
 * custom/pinned build, `env-rank.ts`'s own distinction from plain "behind").
 * It is NEVER an exception merely for running an older build than the set's
 * majority: that is `rank.kind === 'behind'`, on-track and green, and used to
 * be flagged "custom" just for disagreeing with the majority version — so a
 * healthy region one build behind (`prod-af-south-1`, AD r1 #2) printed as an
 * exception row beside HELD and CHECKING on a calm app. It folds like any
 * other healthy region. */
function setFacts(nodes: LaneNode[], granularity: MapGranularity): { exceptions: MapRegion[]; foldGroups: MapFoldGroup[] } {
	if (granularity !== 'app' || nodes.length === 0) return { exceptions: [], foldGroups: [] };
	const exceptions: MapRegion[] = [];
	const folded: LaneNode[] = [];
	for (const n of [...nodes].sort((a, b) => a.env.localeCompare(b.env))) {
		const custom = n.card.rank?.kind === 'diverged';
		if (EXCEPTION.includes(n.state) || custom) {
			// ⭐ AD app r6 #1: a real diverged/unreleased build is never "behind
			// the newest build" (that reads as a healthy app merely lagging); a
			// held row never prints the bare word "held" with no cause — both
			// say WHY, once, here (`help.ts`'s own `heldCauseLabel`, never
			// re-derived). Checking/failed/stuck need nothing extra: the state
			// word already is the reason.
			const reason = custom ? 'custom build' : n.state === 'held' ? `held · ${n.card.heldCauseLabel ?? 'a rule'}` : undefined;
			exceptions.push({
				name: n.env,
				state: n.state,
				apps: 1,
				onNewest: n.state === 'newest' ? 1 : 0,
				version: n.card.version ? shortenVersion(n.card.version) : null,
				card: n.card,
				reason
			});
		} else folded.push(n);
	}
	// ⭐ AD app r6 #1: the healthy rest, grouped by its OWN build — never
	// folded into one line that states "the same build" when two groups
	// disagree (edge-mesh: 10 on a92c6f4, 2 on 16d8b70, both healthy). One
	// `MapFoldGroup` per build, biggest first — `setBuildLine` groups the SAME
	// way for the plate's headline, so the two can never disagree.
	const byVersion = new Map<string | null, MapRegion[]>();
	for (const n of folded) {
		const v = n.card.version ? shortenVersion(n.card.version) : null;
		const list = byVersion.get(v) ?? [];
		list.push({ name: n.env, state: n.state, apps: 1, onNewest: n.state === 'newest' ? 1 : 0, version: v, card: n.card });
		byVersion.set(v, list);
	}
	const foldGroups: MapFoldGroup[] = [...byVersion.entries()]
		.map(([version, regions]) => ({ version, regions }))
		.sort((a, b) => b.regions.length - a.regions.length || (a.version ?? '').localeCompare(b.version ?? ''));
	return { exceptions, foldGroups };
}

/** The prod set's HEADLINE build line for one app: "<build> ×N" when every
 *  region runs one build, "N builds" when they disagree, null when none has
 *  a build. ⭐ squad-fleet lead (real-page read, m7 t2): this is the plate's
 *  one line of `t-code-lg` — the full per-build breakdown ("10 on a92c6f4 ·
 *  2 on 16d8b70") belongs ONLY to the fold's own rows below (`setFacts`'
 *  `foldGroups`, each already spelling "N on <build>"); printing the
 *  breakdown here too wrapped the headline over two or three lines and broke
 *  the plates' equal height. One build count up top, the breakdown once,
 *  lower down — never both in the same line. */
export function setBuildLine(nodes: readonly LaneNode[]): string | null {
	const builds = new Set(nodes.map((n) => n.card.version).filter((v): v is string => !!v));
	if (builds.size === 0) return null;
	if (builds.size === 1) {
		const [only] = builds;
		return nodes.length > 1 ? `${shortenVersion(only)} ×${nodes.length}` : shortenVersion(only);
	}
	return `${builds.size} builds`;
}

/**
 * ONE app's own chain (/apps/[name]): one step per environment the app has,
 * stages on the line, production one step whose regions are the set (one cube
 * per region). Each step carries the build it runs.
 */
export function appMap(lane: Lane): MapModel {
	const m = fleetMap({ lanes: [lane] }, { granularity: 'app' });
	for (const st of m.steps) {
		if (st.prod) {
			// One cube per region, so the set reads as a set on its plate.
			st.cubes = lane.prod.map((n) => ({
				key: `prod|${n.env}`,
				app: n.env,
				state: n.state,
				card: n.card,
				behind: n.behind,
				version: n.card.version ? shortenVersion(n.card.version) : null
			}));
			// The set's figure counts REGIONS for one app.
			st.apps = lane.prod.length;
			st.onNewest = lane.prod.filter((n) => n.state === 'newest').length;
			st.counts = {};
			for (const n of lane.prod) st.counts[n.state] = (st.counts[n.state] ?? 0) + 1;
			if (lane.prod.length === 1) {
				// ⭐ A ONE-REGION PROD IS A PLAIN STAGE (squad-fleet app AD r5 #1).
				// "0 of 1 regions on the newest" with a "—" build is a set drawn
				// around one thing: it reads like a stage, with its own build and
				// state, like every stage before it.
				const only = lane.prod[0];
				st.prod = false;
				st.regions = [];
				st.exceptions = [];
				st.foldGroups = [];
				st.env = only.env;
				st.status = only.state;
				st.lead = only.state;
				st.version = only.card.version ? shortenVersion(only.card.version) : null;
			} else {
				// ⭐ THE SET'S BUILD, NEVER A BLANK (squad-fleet app AD r5 #1). The
				// headline names what the regions run: "<build> ×N" when every
				// region runs one build, "N builds" when they disagree — counted
				// over ALL regions, the same population the region rows show.
				st.version = setBuildLine(lane.prod);
			}
		} else {
			st.version = st.cubes[0]?.version ?? null;
		}
	}
	Object.assign(m, frontierOf(m.steps));
	return m;
}

/** `appStageWord`'s own peers: one app's chain stages, keyed by raw env name
 *  (the shape `held.ts`'s `waitsFor` takes) — built once per model, not per
 *  step, so a chain of five stages costs one pass, not five. Prod is never a
 *  peer here: nothing downstream of it waits on it. */
export function appPeersByEnv(model: MapModel): Map<string, RolloutCard> {
	const m = new Map<string, RolloutCard>();
	for (const st of model.steps) {
		if (!st.prod && st.env && st.cubes[0]) m.set(st.env, st.cubes[0].card);
	}
	return m;
}

/** The prod SET's own representative card, for `appStageWord`'s shared
 *  "waits for <prev>" fact (squad-fleet lead, real-page read, m7 t2:
 *  checkout-api's prod plate stayed silent — "0 of 5 regions on the
 *  newest" with no word — while staging right above it read "held ·
 *  payments-svc"). A region that is plainly BEHIND (not its own exception)
 *  and still names an upstream stage carries the ONE cause every such
 *  region shares — the gate blocking the whole set is the same gate a
 *  plain chain stage would name. A region with its OWN reason (held,
 *  checking, a real diverged build) already names it on its own exception
 *  row; this never speaks for those, and returns `null` when no region is
 *  plainly waiting (prod is on track, nothing shared to add). */
function prodRepresentative(step: MapStep): RolloutCard | null {
	return step.cubes.find((c) => c.state === 'behind' && c.card.waitsForEnv)?.card ?? null;
}

/**
 * ⭐ THE PLATE WORD (HELD RULE FINAL, SPEC.md: "the frontier plate says
 * 'next'; every later stage says 'waits for <prev>'; when that prev stage
 * is held, '· <prev> held on <cause>'"). AD app r6 #3: every stage that had
 * not yet reached the newest build read "behind the newest build" — true of
 * the frontier (about to promote) and of a stage three behind an unrelated
 * hold alike, which is why `hello-world`'s dev frontier and `checkout-api`'s
 * prod (held two stages back) printed the identical word. Covers both a
 * linear stage (`step.cubes[0]`, one app) and the prod SET (`prodRepresentative`).
 *
 * Reads `card.held`/`heldCauseLabel`/`waitsForEnv` — all precomputed by
 * `rollout-cards.ts`'s `heldVerdict` — and `held.ts`'s own `waitsFor` helper
 * for the one-hop "stage X held on Y" clause; never re-derives either.
 *
 * Returns `null` when the step's own status/exceptions already carry the
 * word (a linear stage's `newest`/`checking`/`deploying`/`failed`/`stuck`,
 * or a prod set with nothing plainly waiting) — the caller's existing
 * `STATE_WORD` table and exception rows stay the single source for those.
 */
export function appStageWord(step: MapStep, model: MapModel, peersByEnv: Map<string, RolloutCard>): string | null {
	const card = step.prod ? prodRepresentative(step) : step.cubes[0]?.card;
	if (!card) return null;
	if (!step.prod) {
		if (step.status === 'held') return card.heldCauseLabel ? `held · ${card.heldCauseLabel}` : 'held';
		if (step.status !== 'behind') return null;
	}
	if (model.frontier === step.key) return step.prod ? null : 'next';
	const wf = waitsFor(card, { peersByEnv });
	if (!wf) return null;
	return wf.heldCause ? `waits for ${wf.stage} · ${wf.heldCause}` : `waits for ${wf.stage}`;
}

/** The sentence a step's meta line prints, adverse first, zeros dropped. */
export function stepFacts(s: MapStep): { state: NodeState; n: number; word: string }[] {
	const words: [NodeState, string][] = [
		['failed', 'failing'],
		['stuck', 'stuck'],
		['deploying', 'deploying'],
		['checking', 'checking'],
		['held', 'held'],
		// ⭐ shared/age-lag-total: `n` here counts APPS at this stage, never
		// builds — "not yet on the newest" rather than a bare "N behind" (the
		// caption renders `${n} ${word}`, so the word alone must carry the
		// unit, same reasoning as `revision-ledger.ts`'s service count).
		['behind', 'not yet on the newest']
	];
	return words.filter(([st]) => (s.counts[st] ?? 0) > 0).map(([state, word]) => ({ state, n: s.counts[state] ?? 0, word }));
}
