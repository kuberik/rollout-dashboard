/**
 * HOME'S STATUS FACTS — the counts and words Home's status line, header badge
 * and change headers print. (Home round O, 2026-10-13: "every count goes
 * through a shared, tested helper; never count in a component".)
 *
 * Pure. It decides no state: places are RolloutCards with the shared lane
 * state (`nodeState`, the shared held rule), held/approval membership is
 * fleet-facts' (`facts.held.appIds` / `approvalAppIds`), approvals the
 * caller's shared `isHeldByApproval`. What it adds is the
 * UNIT and the WORDS:
 *   - prod is counted in TARGETS (one app in one prod region), a unit that
 *     cannot be read as apps ("19 apps" beside "19 regions" was misread);
 *   - line 1 is prod health with its full arithmetic, line 2 only motion;
 *   - a pending prod approval is named;
 *   - a held app is named with where it is held, or — when it has no
 *     Environment — with what it runs and what the newer build waits on;
 *   - the change header summarises the WHOLE change, every app it touches.
 */
import type { RolloutCard } from '$lib/rollout-cards';
import type { FleetFacts } from '$lib/view-models/fleet-facts';
import { nodeState, tierOf, TIER_ORDER, type NodeState, type Tier } from '$lib/view-models/promotion-lanes';
import { promotionHoldBreakdown } from '$lib/view-models/blocking-story';
import { journeyFromCells, pickFrontier, type JourneyStop } from '$lib/view-models/journey';
import type { ChangeRowVM } from '$lib/view-models/changes';
import { shortenVersion } from '$lib/utils';
import { ruleOf } from './wait-cause';

const isProd = (c: RolloutCard) => !!c.envName && tierOf(c.envName) === 'prod';

/**
 * EVERY WAIT IS CLAMPED TO THE CHANGE'S AGE (round Q). A change cannot have
 * waited at a step longer than it has existed: the instant a wait started is
 * never earlier than the change's merge. One helper for every path — the
 * held chip, the Needs-you row, a behind app's "waiting …".
 */
export function clampToMerge(at: string | null | undefined, mergedAt: string | null | undefined, ...floors: (string | null | undefined)[]): string | null {
	if (!at) return null;
	// The latest floor wins: a change cannot wait anywhere before it merged,
	// nor at a step before it reached the step upstream of it.
	let best = at;
	for (const f of [mergedAt, ...floors]) if (f && Date.parse(f) > Date.parse(best)) best = f;
	return best;
}
const isBad = (s: NodeState) => s === 'failed' || s === 'stuck';

export type ProdTargets = {
	/** One app in one prod region. */
	total: number;
	failing: number;
	failingApps: string[];
	notDeployed: number;
	/** Prod targets waiting on a person's approval. */
	approvals: { app: string; env: string; card: RolloutCard }[];
};

export function prodTargets(cards: readonly RolloutCard[], isApproval: (c: RolloutCard) => boolean): ProdTargets {
	const prod = cards.filter(isProd);
	const failing = prod.filter((c) => isBad(nodeState(c)));
	return {
		total: prod.length,
		failing: failing.length,
		failingApps: [...new Set(failing.map((c) => c.name))].sort(),
		notDeployed: prod.filter((c) => nodeState(c) === 'none').length,
		approvals: prod.filter((c) => nodeState(c) === 'held' && isApproval(c)).map((c) => ({ app: c.name, env: c.envName, card: c }))
	};
}

export type HeldApp = {
	app: string;
	card: RolloutCard | null;
	/** Where it is held; null when the app has no Environment. */
	env: string | null;
	blocker: string | null;
	/** The blocker is an app with no Environment — no card on Home to find. */
	blockerNoEnv: boolean;
	/** No Environment: the build it runs, and the build that waits. */
	running: string | null;
	waiting: string | null;
};

/** Apps held by a RULE (never an approval), from fleet-facts' membership. */
export function heldByRule(facts: Pick<FleetFacts, 'held'>, cards: readonly RolloutCard[]): HeldApp[] {
	const ask = new Set(facts.held.approvalAppIds);
	return facts.held.appIds
		.filter((app) => !ask.has(app))
		.map((app) => {
			const c = cards.find((x) => x.name === app && nodeState(x) === 'held') ?? cards.find((x) => x.name === app && x.held) ?? null;
			const env = c ? c.envName || null : null;
			const waiting = c ? (promotionHoldBreakdown(c.rollout).held[0]?.build ?? null) : null;
			const rule = c ? ruleOf(c) : null;
			const blocker = rule?.name ?? c?.heldCauseLabel ?? null;
			return {
				app,
				card: c,
				env,
				blocker,
				blockerNoEnv: !!rule?.app && !cards.some((x) => x.name === rule.app && x.envName),
				running: c?.version ? shortenVersion(c.version) : null,
				waiting: waiting ? shortenVersion(waiting) : null
			};
		})
		.sort((a, b) => Number(b.env != null) - Number(a.env != null) || a.app.localeCompare(b.app));
}

/**
 * The change header: where the WHOLE change is, across every app it touches.
 * "in prod on telemetry-collector, telemetry-forwarder · 1 waits for approval ·
 * 1 checking in dev". From the
 * change-row journey (`journeyFromCells` + `pickFrontier`) per app.
 */
export function changeSummary(row: Pick<ChangeRowVM, 'services' | 'sha'>): { text: string; inProd: string | null; rest: string; tone: 'failed' | 'approval' | 'held' | 'active' | 'live' } {
	const services = row.services ?? [];
	const prodApps: string[] = [];
	const parts = new Map<string, number>();
	let tone: 'failed' | 'approval' | 'held' | 'active' | 'live' = 'live';
	const rank = { failed: 0, approval: 1, held: 2, active: 3, live: 4 } as const;
	const bump = (k: string, t: keyof typeof rank) => {
		parts.set(k, (parts.get(k) ?? 0) + 1);
		if (rank[t] < rank[tone]) tone = t;
	};
	for (const svc of services) {
		const tiers = TIER_ORDER.filter((t: Tier) => svc.cells.some((c) => tierOf(c.envName) === t));
		const stops = journeyFromCells(svc, { tiers, revision: row.sha });
		const prod = stops.find((s) => s.tier === 'prod');
		if (prod && prod.state === 'newest') {
			prodApps.push(svc.appName);
			continue;
		}
		const f: JourneyStop | null = pickFrontier(stops, tiers);
		const where = (s: JourneyStop) => (s.tier === 'prod' ? 'prod' : s.env);
		if (!f) bump('not deployed yet', 'live');
		else if (f.state === 'failed' || f.state === 'stuck') bump(`${f.state} in ${where(f)}`, 'failed');
		else if (f.state === 'held' && f.action?.kind === 'review') bump('waits for approval', 'approval');
		else if (f.state === 'held') bump(`held in ${where(f)}`, 'held');
		else if (f.state === 'deploying' || f.state === 'checking') bump(`${f.state} in ${where(f)}`, 'active');
		else bump(`in ${where(f)}`, 'live');
	}
	// Round T: the apps it is already in prod on, by name — "2 of 4 in prod"
	// was read as 2 failing. None in prod yet: the header says only what is on its way.
	const head = prodApps.length ? `in prod on ${prodApps.join(', ')}` : null;
	const tail = [...parts.entries()].map(([k, n]) => `${n} ${k}`);
	const rest = tail.join(' · ');
	return { text: [head, ...tail].filter(Boolean).join(' · '), inProd: head, rest, tone };
}

/** "6 apps: checkout-api, orders-api, recommender-svc and 3 without an environment". */
export function heldSentence(held: readonly HeldApp[]): string {
	const withEnv = held.filter((h) => h.env).map((h) => h.app);
	const envless = held.length - withEnv.length;
	const named = withEnv.slice(0, 3);
	const more = withEnv.length - named.length;
	const tail = [more ? `${more} more` : '', envless ? `${envless} without an environment` : ''].filter(Boolean);
	const list = !named.length
		? tail.join(' and ')
		: tail.length
			? `${named.join(', ')} and ${tail.join(' and ')}`
			: named.length > 1
				? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`
				: named[0];
	return `${held.length} app${held.length === 1 ? '' : 's'}: ${list}`;
}

// ── Round S: a prod set's tally accounts for every target. ─────────────────

/** One bucket of a prod set: how many targets, and what they are doing. */
export type RegionBucket = { count: number; word: 'failing on' | 'checking' | 'deploying' | 'on' | 'not deployed'; id: string | null };
export type RegionTally = { total: number; buckets: RegionBucket[]; heldBefore: string | null };

/**
 * Every target of a prod set in exactly one bucket, so the tally always sums
 * to the region count (SRE read, round S: "6 regions" over a split of 5).
 * Failing first, then what is moving (checking, deploying — the same word the
 * Prod cell counts), then the builds the rest run, most first, then the
 * targets running nothing. `heldBefore` is the build a hold keeps out.
 */
export function regionTally(
	nodes: readonly { state: NodeState; card: RolloutCard }[],
	idOf: (v: string | null | undefined) => string,
	heldBefore: string | null = null
): RegionTally {
	const keyed = new Map<string, RegionBucket>();
	const add = (word: RegionBucket['word'], id: string | null) => {
		const k = `${word}|${id ?? ''}`;
		const b = keyed.get(k) ?? { count: 0, word, id };
		b.count++;
		keyed.set(k, b);
	};
	for (const n of nodes) {
		const id = n.card.version ? idOf(n.card.version) : '';
		if (n.state === 'none' || !id) add('not deployed', null);
		else if (n.state === 'failed' || n.state === 'stuck') add('failing on', id);
		else if (n.state === 'checking') add('checking', id);
		else if (n.state === 'deploying') add('deploying', id);
		else add('on', id);
	}
	const order: RegionBucket['word'][] = ['failing on', 'deploying', 'checking', 'on', 'not deployed'];
	const buckets = [...keyed.values()].sort((a, b) => order.indexOf(a.word) - order.indexOf(b.word) || b.count - a.count);
	return { total: nodes.length, buckets, heldBefore };
}
