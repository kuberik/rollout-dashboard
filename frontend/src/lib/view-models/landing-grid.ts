/**
 * THE LANDING GRID — one drawn unit answering "where did this change land",
 * built ON TOP OF `pr-pipeline.ts`'s `PrPipelineVM`. Reads
 * CHANGES-2026-09-10.md §2, and is that section's precedence — nothing else
 * decides the family collapse or the service fold.
 *
 * ── WHY A SECOND VM RATHER THAN EXTENDING `PrPipelineVM` ─────────────────
 *
 * `pr-pipeline.ts` computes one `PrCell` per `cluster/env` — the full
 * form's own grain, and `PipelineCard`/`PipelineRow` (a later lane) render
 * it unchanged. The compact form collapses REGIONS (same family, e.g. three
 * `prod-*` environments) into one mark and, at the whole-grid scale, folds
 * SERVICES that agree into one label. Both foldings are lossy in a way the
 * full form must never be ("stages never collapse" — CHANGES-2026-09-10.md
 * §2a), so they live in their own module rather than mutating the shared
 * pipeline VM every other card reads.
 *
 * ── PRECEDENCE, STATED ONCE ───────────────────────────────────────────────
 *
 * Both foldings below — which cell wins a collapsed family mark, and which
 * services surface in the +N cap — use the SAME "worst-first" ordering
 * `PrPipelineVM.verdict` already uses (`STATE_PROGRESS` in `pr-pipeline.ts`,
 * inverted): failed, then held-like, then in-flight, then the pipeline's own
 * self-resolving/settled states, then not-built, then live. Restated here
 * rather than imported, because the two ties break differently — a family
 * mark keeps the WORST CELL (to draw its glyph/href/theme from), while the
 * service fold only needs the worst CLASSIFICATION (a closed five-word
 * vocabulary a service header can title itself with).
 */
import type { PrCell, PrPipelineVM, PrState } from './pr-pipeline';
import { cellStateSentence } from '../pr-cell-copy';
import { envFamilyWord } from '../version-utils';
import { rolloutPath } from '../source-dashboard';
import type { EnvironmentTheme } from '../environment-theme';

/** One collapsed mark — one family, worst state among the regions it holds. */
export type LandingMarkVM = {
	/** `DEV` / `STG` / `PRD` / `TEST`, or a 3-letter fallback. Never the raw env name. */
	family: string;
	/** Regions collapsed into this mark. 1 for an un-collapsed family. */
	count: number;
	state: PrState;
	/** The full sentence for hover/tap — every collapsed region, named. */
	sentence: string;
	/** The rollout page for the worst region in this mark. */
	href: string;
	/** Ring + word ink. `null` when no region in the mark carries a theme. */
	theme: EnvironmentTheme | null;
};

/** The closed vocabulary a service's own worst state folds to — used both
 *  to order the +N cap and as a stable, testable classification. */
export type LandingVerdictWord = 'failed' | 'held' | 'active' | 'not-built' | 'live';

export type LandingServiceVM = {
	appName: string;
	/** Family-collapsed marks, in env-rank order. */
	marks: LandingMarkVM[];
	verdictWord: LandingVerdictWord;
	/** Cells (pre-collapse) whose state is `live`. */
	landedCount: number;
	/** Total cells (pre-collapse) for this service. */
	total: number;
};

export type LandingGridVM = {
	/** Every service, unfolded, in `PrPipelineVM`'s own order. */
	services: LandingServiceVM[];
	/** Set when every service folds to the identical family/state sequence —
	 *  the whole grid collapses to this one label instead of listing rows. */
	allSameLabel: string | null;
	/** The rows to actually render: all of `services` when `allSameLabel` is
	 *  set (rendering the label instead is the caller's job), else the
	 *  worst-first top 3. */
	visible: LandingServiceVM[];
	/** The services folded into a `+N services` count, worst-first order
	 *  preserved in `title`, or `null` when nothing overflowed. */
	overflow: { count: number; title: string } | null;
};

/** Worst-first rank. Lower sorts first / wins a collapse. Held-like states
 *  (`gated`/`pinned`/`waiting-upstream`) and in-flight states
 *  (`deploying`/`baking`/`retrying`) are deliberately TIED within their own
 *  tier — see the module doc — so the winner among ties is whichever cell
 *  sorts first in `pr-pipeline.ts`'s own env-rank order (the array's own
 *  order, which callers already receive pre-sorted). */
const STATE_RANK: Record<PrState, number> = {
	failed: 0,
	gated: 1,
	pinned: 1,
	'waiting-upstream': 1,
	deploying: 2,
	baking: 2,
	retrying: 2,
	cancelled: 3,
	'rolled-back': 4,
	promoting: 5,
	'not-built': 6,
	live: 7
};

function worstCell(cells: readonly PrCell[]): PrCell {
	return cells.reduce((acc, c) => (STATE_RANK[c.state] < STATE_RANK[acc.state] ? c : acc));
}

/** Folds a `PrState` to the closed verdict-word vocabulary. `cancelled` /
 *  `rolled-back` / `promoting` land on `active` — none of the three is the
 *  settled `live` norm nor an unbuilt gap, and none needs its own row in a
 *  fold whose only job is ordering "needs a look" ahead of "quiet". */
function classify(state: PrState): LandingVerdictWord {
	switch (state) {
		case 'failed':
			return 'failed';
		case 'gated':
		case 'pinned':
		case 'waiting-upstream':
			return 'held';
		case 'not-built':
			return 'not-built';
		case 'live':
			return 'live';
		default:
			return 'active';
	}
}

/**
 * §2a: REGIONS COLLAPSE, STAGES DO NOT. Groups a service's cells by family
 * word (in the order the first region of each family appears — which is
 * `pr-pipeline.ts`'s own env-rank order, so DEV/TEST/STAGING/PROD sort
 * correctly without this module re-deriving rank), and folds each group to
 * one mark carrying the group's WORST state.
 */
function collapseFamilies(cells: readonly PrCell[], now: Date): LandingMarkVM[] {
	const order: string[] = [];
	const groups = new Map<string, PrCell[]>();
	for (const cell of cells) {
		const family = envFamilyWord(cell.envName);
		let group = groups.get(family);
		if (!group) {
			group = [];
			groups.set(family, group);
			order.push(family);
		}
		group.push(cell);
	}

	return order.map((family) => {
		const group = groups.get(family)!;
		const worst = worstCell(group);
		const sentence = group
			.map((c) => `${c.envName}: ${cellStateSentence(c, now)}`)
			.join('; ');
		return {
			family,
			count: group.length,
			state: worst.state,
			sentence,
			href: rolloutPath(worst.cluster, worst.namespace, worst.rolloutName),
			theme: worst.theme
		} satisfies LandingMarkVM;
	});
}

/** `family:state` for every mark, joined — the signature two services must
 *  share, in the same order, for the all-same fold to apply. Includes STATE
 *  deliberately: two services both fully live but one still not-built in a
 *  third env are not "the same", even though their family lists might
 *  otherwise line up. */
function marksSignature(marks: readonly LandingMarkVM[]): string {
	return marks.map((m) => `${m.family}:${m.state}`).join('|');
}

const VERDICT_RANK: Record<LandingVerdictWord, number> = {
	failed: 0,
	held: 1,
	active: 2,
	'not-built': 3,
	live: 4
};

/** THE ONE ENTRY POINT. Builds the compact grid's view-model off the pipeline
 *  VM `pr-pipeline.ts` already computed — invents no new pipeline facts,
 *  only folds the ones it is given. */
export function buildLandingGrid(vm: PrPipelineVM, now: Date = new Date()): LandingGridVM {
	const services: LandingServiceVM[] = vm.services.map((s) => {
		const worst = s.cells.length ? worstCell(s.cells) : null;
		return {
			appName: s.appName,
			marks: collapseFamilies(s.cells, now),
			verdictWord: worst ? classify(worst.state) : 'live',
			landedCount: s.cells.filter((c) => c.state === 'live').length,
			total: s.cells.length
		};
	});

	if (services.length === 0) {
		return { services, allSameLabel: null, visible: [], overflow: null };
	}

	// FOLD RULE 1: every service the identical family/state sequence — one
	// label, not N rows ("Today's PR page renders this case as 12 rows.").
	const firstSignature = marksSignature(services[0].marks);
	const allSame = services.every((s) => marksSignature(s.marks) === firstSignature);
	if (allSame) {
		return {
			services,
			allSameLabel: `all ${services.length} service${services.length === 1 ? '' : 's'}`,
			visible: services,
			overflow: null
		};
	}

	// FOLD RULE 2: at most 3 groups, worst-first, then a neutral overflow
	// count whose `title` names what it folded.
	const ordered = [...services].sort((a, b) => VERDICT_RANK[a.verdictWord] - VERDICT_RANK[b.verdictWord]);
	const visible = ordered.slice(0, 3);
	const hidden = ordered.slice(3);
	const overflow = hidden.length
		? { count: hidden.length, title: hidden.map((s) => s.appName).join(', ') }
		: null;

	return { services, allSameLabel: null, visible, overflow };
}
