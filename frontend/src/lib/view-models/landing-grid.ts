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

/**
 * ⭐ RULING 6 (CHANGES-2026-09-10 fix pass, "GRID DATA"). State-only colour —
 * identity stays the WORD (the family label + its ring), never a hue, so a
 * mark's tint is free to carry state alone with no collision. `stuck`, not
 * `held`: amber is the product's one reserved "needs a look" colour and this
 * is the tone table it is reserved for (`gated`/`pinned`/`waiting-upstream`).
 * `none` is the quiet norm for `not-built` — a mark that carries no field at
 * all (§2a's own dashed-outline rule), not an alarm.
 *
 * ⭐ FIX PASS ITEM 4 (2026-09-10). `queued` is its OWN tone, not folded into
 * `active` — a normal promotion-order wait ("waiting for dev to deploy it
 * first") is not "something is moving right now" (`active`'s own meaning,
 * `deploying`/`baking`/`retrying`) any more than it is `stuck`; giving it a
 * third, neutral bucket is what keeps `stuck` meaning ONLY "amber, needs a
 * look" everywhere this tone is read.
 */
export type MarkTone = 'live' | 'stuck' | 'active' | 'queued' | 'none' | 'failed';

/** One collapsed mark — one family, worst state among the regions it holds. */
export type LandingMarkVM = {
	/** `DEV` / `STG` / `PRD` / `TEST`, or a 3-letter fallback. Never the raw env name. */
	family: string;
	/**
	 * ⭐ RULING 6. Canonical tier position (`env-order.ts`'s own dev → test →
	 * staging → prod, 0-indexed) so a column layout can align DEV/STG/PRD
	 * across rows even when one service's own family list has a gap (no
	 * TEST tier, say) — the caller places this mark in column `familyOrder`
	 * rather than the next free slot. An unmatched/fallback family (§2a's
	 * "first 3 letters" case) sorts last, after every named tier.
	 */
	familyOrder: number;
	/** Regions collapsed into this mark. 1 for an un-collapsed family. */
	count: number;
	state: PrState;
	/** State-only colour channel — see `MarkTone`'s own doc. */
	tone: MarkTone;
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
	/**
	 * ⭐ RULING 6 (CHANGES-2026-09-10 fix pass, "GRID DATA"). ALWAYS every
	 * service — adverse-first (`orderByVerdict`), then alphabetical — never
	 * truncated by this module. The +N fold is now a PRESENTATION choice: the
	 * caller (a `LandingGrid.svelte` `max` prop) decides how many of this
	 * ordered list to draw and builds its own overflow chip from the
	 * remainder. `overflow` stays on the type for callers that have not moved
	 * to the prop-driven fold yet, but this module no longer populates it —
	 * see below.
	 */
	visible: LandingServiceVM[];
	/**
	 * ⭐ RULING 6. Always `null` — VM-level truncation is retired (see
	 * `visible`'s own doc). Kept on the type rather than deleted so an
	 * un-migrated caller reading `grid.overflow` degrades to "nothing
	 * overflowed" instead of a compile error.
	 */
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
	// `queued` ties `promoting`'s own tier — both are the SAME "nothing is
	// wrong, just not this cell's turn yet" tier, worse than `not-built`
	// (a build exists) but never as loud as a held/failed/in-flight state.
	promoting: 5,
	queued: 5,
	'not-built': 6,
	live: 7
};

/** Worst-first, cells edition — the reduce every mark/service classification
 *  in this module shares. Exported so a caller building its OWN
 *  classification off raw `PrCell[]` (the change page's full-form cards,
 *  ruling 6's "SAME order function") never re-derives it. */
export function worstCell(cells: readonly PrCell[]): PrCell {
	return cells.reduce((acc, c) => (STATE_RANK[c.state] < STATE_RANK[acc.state] ? c : acc));
}

/** Folds a `PrState` to the closed verdict-word vocabulary. `cancelled` /
 *  `rolled-back` / `promoting` land on `active` — none of the three is the
 *  settled `live` norm nor an unbuilt gap, and none needs its own row in a
 *  fold whose only job is ordering "needs a look" ahead of "quiet". Exported
 *  alongside `worstCell` for the same reason. */
export function classify(state: PrState): LandingVerdictWord {
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

/** ⭐ RULING 6. State-only colour, off the same closed fold `classify` already
 *  performs — `held` becomes `stuck` (amber's one reserved meaning), never a
 *  second classification a mark and a card could disagree on.
 *
 *  ⭐ FIX PASS ITEM 4. `queued` is carved out BEFORE the `classify` fold —
 *  `classify` itself still folds it to the closed `active` verdict word
 *  (a normal wait is not a NEW category the service-level ordering needs to
 *  know about), but the mark's own tone must not reuse `active`'s hue,
 *  which is `deploying`/`baking`/`retrying`'s "something is moving right
 *  now" — a queued cell is the opposite of that. */
function toneOf(state: PrState): MarkTone {
	if (state === 'queued') return 'queued';
	switch (classify(state)) {
		case 'held':
			return 'stuck';
		case 'not-built':
			return 'none';
		default:
			return classify(state) as MarkTone;
	}
}

/** ⭐ RULING 6. Canonical dev → test → staging → prod tier position,
 *  `env-order.ts`'s own ordering restated for the mark's own family-word
 *  vocabulary (`envFamilyWord`'s closed set) — an unmatched/fallback family
 *  (e.g. `CAN` for `canary`) sorts after every named tier, not before or
 *  interleaved with one. */
const FAMILY_ORDER: Record<string, number> = { DEV: 0, TEST: 1, STG: 2, PRD: 3 };

function familyOrderFor(family: string): number {
	return FAMILY_ORDER[family] ?? Object.keys(FAMILY_ORDER).length;
}

/**
 * §2a: REGIONS COLLAPSE, STAGES DO NOT. Groups a service's cells by family
 * word (in the order the first region of each family appears — which is
 * `pr-pipeline.ts`'s own env-rank order, so DEV/TEST/STAGING/PROD sort
 * correctly without this module re-deriving rank), and folds each group to
 * one mark carrying the group's WORST state.
 */
function collapseFamilies(cells: readonly PrCell[], now: Date, builtElsewhere: boolean): LandingMarkVM[] {
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
			.map((c) => `${c.envName}: ${cellStateSentence(c, now, { builtElsewhere })}`)
			.join('; ');
		return {
			family,
			familyOrder: familyOrderFor(family),
			count: group.length,
			state: worst.state,
			tone: toneOf(worst.state),
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

/**
 * ⭐ RULING 6. Adverse-first, then alphabetical — the ONE ordering both the
 * compact grid's `visible` list and the change page's own full-form cards
 * use (ruling 6: "the SAME order function is exported for the change page's
 * cards"). Generic over anything with a `verdictWord`/`appName` shape so a
 * caller working from raw `PrService[]` can supply its own
 * `classify(worstCell(s.cells).state)` as the word without this module
 * needing to know about `PrService` at all.
 */
export function orderByVerdict<T>(
	items: readonly T[],
	wordOf: (item: T) => LandingVerdictWord,
	nameOf: (item: T) => string
): T[] {
	return [...items].sort((a, b) => VERDICT_RANK[wordOf(a)] - VERDICT_RANK[wordOf(b)] || nameOf(a).localeCompare(nameOf(b)));
}

/** THE ONE ENTRY POINT. Builds the compact grid's view-model off the pipeline
 *  VM `pr-pipeline.ts` already computed — invents no new pipeline facts,
 *  only folds the ones it is given. */
export function buildLandingGrid(vm: PrPipelineVM, now: Date = new Date()): LandingGridVM {
	const services: LandingServiceVM[] = vm.services.map((s) => {
		const worst = s.cells.length ? worstCell(s.cells) : null;
		return {
			appName: s.appName,
			marks: collapseFamilies(s.cells, now, s.builtElsewhere),
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

	// ⭐ RULING 6. NO truncation here any more — `visible` is every service,
	// adverse-first then alphabetical, full stop. The +N fold is
	// `LandingGrid.svelte`'s own `max` prop to apply against this list.
	const visible = orderByVerdict(
		services,
		(s) => s.verdictWord,
		(s) => s.appName
	);

	return { services, allSameLabel: null, visible, overflow: null };
}
