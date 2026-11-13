/**
 * ONE APP'S STAIRCASE, AS PLATES — Home direction K (2026-10-12), ported
 * from direction C's `stairs.ts`.
 *
 * Pure, and it decides nothing: every place's state is the shared lane
 * state (`nodeState`, which applies the shared held rule), every "is this an
 * approval" is the caller's shared `isHeldByApproval`. This only shapes the
 * app's OWN chain into plates — the stages it has, in promotion order (so a
 * chain never shows a gap for a tier another app has), then production as
 * ONE plate whose regions are a set — and words the few plates that are
 * adverse or moving.
 */
import type { RolloutCard } from '$lib/rollout-cards';
import { shortenVersion } from '$lib/utils';
import { regionsPhrase, siteCount } from '$lib/view-models/regions';
import { severityRank } from '$lib/view-models/severity';
import { type Lane, type LaneNode, type NodeState } from '$lib/view-models/promotion-lanes';
import { promotionHoldBreakdown } from '$lib/view-models/blocking-story';

export type KPlateModel = {
	key: string;
	/** `staging`, or `prod` for a set of regions (a single region keeps its name). */
	label: string;
	set: boolean;
	nodes: LaneNode[];
	/** One state per place, the order the plate draws its cubes. */
	/** Per place; an approval wait is its own mark ('approval'), never held orange. */
	states: (NodeState | 'approval')[];
	/** Regions not failing or stuck (blast radius: health before adoption). */
	healthy: number;
	/** The worst place (worst-wins, the product order). */
	worst: LaneNode;
	/** Regions on their newest build, for a set's "3/5". */
	onNewest: number;
	/** Only for an adverse or moving plate: what it is doing, and the build. */
	tag: { word: string; state: NodeState; sha: string | null } | null;
};

export type KApp = {
	app: string;
	plates: KPlateModel[];
	/** The app's worst state across its chain. */
	state: NodeState;
	/** The one short phrase for the title row, only when something is off. */
	/** `verb` is inked alone (the state word); `rest` names the place. */
	phrase: { text: string; verb: string; rest: string; state: NodeState } | null;
	/** The place the phrase and the card's action are about. */
	lead: LaneNode | null;
	approval: boolean;
	/** Every place on the newest build (the tiny-tile population). */
	newestEverywhere: boolean;
	lane: Lane;
};

const rank = (s: NodeState) => severityRank(s);
const OFF: NodeState[] = ['failed', 'stuck', 'held', 'deploying', 'checking'];

function word(s: NodeState, approval: boolean): string {
	if (s === 'held') return approval ? 'waits for approval' : 'held';
	return s;
}

export function kApp(lane: Lane, isApproval: (c: RolloutCard) => boolean): KApp {
	const groups: { key: string; label: string; set: boolean; nodes: LaneNode[] }[] = lane.stages.map((n) => ({
		key: n.env,
		label: n.env,
		set: false,
		nodes: [n]
	}));
	if (lane.prod.length) {
		groups.push({
			key: 'prod',
			label: lane.prod.length === 1 ? lane.prod[0].env : 'prod',
			set: lane.prod.length > 1,
			nodes: [...lane.prod].sort((a, b) => a.env.localeCompare(b.env))
		});
	}
	const plates: KPlateModel[] = groups.map((g) => {
		const worst = g.nodes.reduce((w, n) => (rank(n.state) < rank(w.state) ? n : w));
		const offCount = g.nodes.filter((n) => n.state === worst.state).length;
		const approval = worst.state === 'held' && isApproval(worst.card);
		let tag: KPlateModel['tag'] = null;
		if (OFF.includes(worst.state)) {
			const w = word(worst.state, approval);
			const sha =
				g.set && offCount > 1
					? null
					: worst.state === 'held'
						? // the build the hold keeps out, never the one running
							((b) => (b ? shortenVersion(b) : null))(promotionHoldBreakdown(worst.card.rollout).held[0]?.build ?? null)
						: worst.card.version
							? shortenVersion(worst.card.version)
							: null;
			tag = { word: g.set && offCount > 1 ? `${offCount} ${w}` : w, state: worst.state, sha };
		}
		return {
			...g,
			states: g.nodes.map((n) => (n.state === 'held' && isApproval(n.card) ? 'approval' : n.state)),
			healthy: g.nodes.filter((n) => n.state !== 'failed' && n.state !== 'stuck').length,
			worst,
			onNewest: g.nodes.filter((n) => n.state === 'newest').length,
			tag
		};
	});
	const leadPlate = plates.reduce<KPlateModel | null>((w, p) => (!w || rank(p.worst.state) < rank(w.worst.state) ? p : w), null);
	const state = leadPlate?.worst.state ?? 'none';
	const lead = leadPlate?.worst ?? null;
	const approval = !!lead && state === 'held' && isApproval(lead.card);
	let phrase: KApp['phrase'] = null;
	if (lead && OFF.includes(state)) {
		const offInPlate = leadPlate!.nodes.filter((n) => n.state === state).length;
		// QA2: "N prod regions" only when more than one SITE is involved (regions.ts), never because several entries are off
		const offEnvs = leadPlate!.nodes.filter((n) => n.state === state).map((n) => n.env);
		const where = (leadPlate!.set && offInPlate > 1 ? regionsPhrase(siteCount(offEnvs), 'prod') : null) ?? lead.env;
		const prep = state === 'deploying' ? 'to' : 'in';
		phrase = { text: `${word(state, approval)} ${prep} ${where}`, verb: word(state, approval), rest: ` ${prep} ${where}`, state };
	} else if (state === 'behind') {
		// Nothing wrong, nothing moving: say where it lags, once, neutrally.
		const first = plates.find((p) => p.nodes.some((n) => n.state === 'behind'))!;
		const n = first.nodes.find((x) => x.state === 'behind')!;
		const place = first.set ? 'prod' : n.env;
		const v = n.behind > 0 ? `${n.behind} behind` : 'behind';
		phrase = { text: `${v} in ${place} · ${place} next`, verb: v, rest: ` in ${place} · ${place} next`, state };
	}
	return {
		app: lane.app,
		plates,
		state,
		phrase,
		lead,
		approval,
		newestEverywhere: plates.length > 0 && plates.every((p) => p.nodes.every((n) => n.state === 'newest')),
		lane
	};
}
