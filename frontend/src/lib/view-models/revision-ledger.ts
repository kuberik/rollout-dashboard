import type { Environment, Rollout } from '$lib/../types';
import {
	groupRolloutsByApp,
	repoLabel,
	shortRevision,
	type AppCell,
	type AppGroup
} from '$lib/version-utils';
import { getDisplayVersion } from '$lib/utils';
import { buildLadder, divergedFromLine, type BuildLadder } from './build-ladder';
import { isDeployable } from './promotion';
import { rankVerdicts, rankBehindBy, type RankVerdict } from './env-rank';
import { compareEnvironmentNames } from '$lib/env-order';

/**
 * THE REVISION LEDGER — `/versions`, keyed by the commit rather than by the label.
 *
 * The human's ask: *"maybe if we showed revisions instead? and then showed
 * versions / services associated with that revision? … this then doesn't mix
 * same 'version' for different services. versions can be labeled different for
 * different versions on the same revision."*
 *
 * THE DEFECT THIS CLOSES, measured on the live cluster. The page keyed rows by
 * the DISPLAY LABEL, so one commit became one row per label it carried:
 * `9f10e49` occupied three rows — `NEWEST`, `−1` and `−2` — because the `−N`
 * was the row's index in a list of label strings, not a rank on any ladder.
 * That same row said `shared · 3 apps` while FIVE services carried the commit,
 * because the app set was collected per label and the two semver services fell
 * into rows of their own. 16 rows for 11 revisions, and the three ranks were
 * three different answers to one question.
 *
 * A revision is one string for every service that ships it, so keying by it
 * makes the fragmentation impossible by construction rather than by care. It
 * also closes a LATENT bug in the other direction — two services shipping
 * unrelated builds that happen to share a label string would have merged into
 * one row. That one is not currently firing: the live repo has 45 distinct
 * labels and none of them maps to two revisions. Do not describe it as a bug
 * that was observed.
 *
 * ONE RANK, PRODUCT-WIDE. Every rank here comes from `buildLadder`, the same
 * derivation `/apps`, `/apps/[name]`, `/environments` and `/envs/*` read
 * through `env-rank.ts`. This module indexes that ladder BY REVISION instead
 * of by display version; it does not compute an ordering of its own. A fourth
 * opinion about which build is newer is exactly what `env-rank.ts` exists to
 * prevent.
 */

/** One (service, environment) deployment slot, seen from a revision's side. */
export type RevisionSlot = {
	appName: string;
	envName: string;
	cell: AppCell;
	/** True when this environment is running the row's revision right now. */
	onIt: boolean;
	/**
	 * Rank, on the SERVICE'S OWN LADDER, of the build this environment is
	 * currently running. null when the ladder cannot place it — print no
	 * number then, never a `0` (which reads as "newest").
	 */
	currentRank: number | null;
	/** The OCI tag a promote to the row's revision would deploy here, or null. */
	promoteTag: string | null;
	/**
	 * THE SERVICE'S TAG FOR THIS BUILD, UNCONDITIONED.
	 *
	 * `promoteTag` is already filtered by `isDeployable`, so it collapses three
	 * different situations — no tag at all, the build is not a candidate here,
	 * and a gate refuses it — into one `null`. The revision pages have to tell
	 * the last two apart: attributing a gate to a build the rollout was never
	 * going to deploy anyway is a cause named from evidence that establishes
	 * something else.
	 */
	tag: string | null;
};

/** One service's relationship to a revision. */
export type RevisionService = {
	appName: string;
	/** What this service calls the revision — `1.66.0-66`, or the short sha. */
	label: string;
	/**
	 * PRINT THE LABEL ONLY WHEN IT DIFFERS FROM THE ROW'S OWN IDENTIFIER.
	 *
	 * A service listed bare *is* the statement "it ships under the revision".
	 * This is the rule that stops `9f10e49` printing its own sha once per
	 * service: measured on the live repo, 8 labels print across 40 service
	 * mentions instead of 40.
	 */
	labelDiffers: boolean;
	/** Rank of THIS revision on the service's own ladder; null when unplaceable. */
	rank: number | null;
	/** How many builds that ladder holds — the denominator, always named. */
	ladderLength: number;
	/**
	 * OFF THE RELEASE LINE — the product's `divergedFromLine`, not a raw
	 * `onReleaseLine === false`.
	 *
	 * The raw flag is only "no environment's `availableReleases` mentions this
	 * build", which is true of EVERY build of an app that publishes no release
	 * list at all. Rendered from the raw flag the note fired on all four rows of
	 * a fixture app — one condition wearing four marks, and a claim made from an
	 * absence of evidence rather than from evidence. `divergedFromLine` adds the
	 * two guards that make it sayable: a line must exist, and the build must sit
	 * inside the window that line still covers. Older than the window is "aged
	 * out", which is unknowable, and renders nothing.
	 */
	diverged: boolean;
	slots: RevisionSlot[];
	liveSlots: number;
};

/**
 * ONE NAME, AND EVERY SERVICE THAT SHIPS THE REVISION UNDER IT.
 *
 * THIS EXISTS TO DELETE A RULE, NOT TO ADD A SHAPE. `/versions` used to print
 * one line per service and attach the label *only where it differed from the
 * row's own sha* — a rule that cannot be read off the object, which is why the
 * page needed a caption saying *"a service with no AS badge ships this revision
 * under its own sha"*, and why the detail page needed a second caption for its
 * own dimmed-instead-of-omitted expression of the same rule. The human has
 * rejected legends twice. A caption in prose is a legend.
 *
 * Grouping removes the exception instead of explaining it. Every group states
 * its own name, including the group whose name IS the revision — so a reader
 * never sees a present label beside a missing one and has nothing to infer.
 * The commit's own sha appearing as one of its names is the fact, printed.
 *
 * IT IS ALSO THE COMPRESSION. Measured on the live cluster: 11 rows carrying
 * 40 service lines become 11 rows carrying 19 label lines, because six of the
 * eleven revisions have exactly ONE name and their whole cell is now one line.
 * And criterion 3 — *"which services ship it, and under what labels"* — stops
 * being a paragraph and becomes a COUNTABLE COLUMN: `9f10e49` has three names,
 * `3cc206c` has one, and you can see that without reading a word.
 *
 * ORDER: the differing names first, the revision's own sha last. Mark the
 * deviation; the norm reads last.
 */
export type RevisionLabelGroup = {
	/** What these services call the build. Always printed — never omitted, never dimmed. */
	label: string;
	/** True when this group's name is the revision's own short sha. */
	isOwnSha: boolean;
	services: RevisionService[];
};

export type RevisionRow = {
	/** Full git revision — the row's identity. */
	revision: string;
	/** Seven characters. What is displayed, never what is keyed on. */
	short: string;
	createdMs: number;
	lastDeployMs: number;
	services: RevisionService[];
	/**
	 * The same services, grouped by the name they ship the revision under.
	 * See `RevisionLabelGroup`: this is what `/versions` renders, and it is the
	 * reason neither revision page needs a caption any more.
	 */
	labelGroups: RevisionLabelGroup[];
	/** (service, env) slots currently running this revision. */
	liveSlots: number;
	/** (service, env) slots belonging to the services that carry it. */
	totalSlots: number;
	/**
	 * THE DEVIATION, AND ONLY THE DEVIATION.
	 *
	 * `notYet` is populated only for services this revision is rank 0 of —
	 * i.e. only on the head. `not yet in PROD` is true of every revision newer
	 * than production's build, so a design that prints it per row prints
	 * `−4 −3 −2 −1` down four consecutive rows: one problem, four amber marks.
	 * It is news exactly once.
	 *
	 * `stillLive` is its mirror for older revisions — there the deviation is
	 * the environment that has NOT moved on, not the ones that have.
	 */
	notYet: RevisionSlot[];
	stillLive: RevisionSlot[];
	/** Services whose release line does not contain this build. */
	offLine: RevisionService[];
	/**
	 * MIN RANK ACROSS SERVICES — the sort key that keeps ROW POSITION EQUAL TO
	 * RANK. The design drops the `−N` chip from the rows on the grounds that
	 * position already carries it, which is only true if the list order and the
	 * ladder order cannot disagree. They could: the list sorted on creation time
	 * then deploy recency, while `buildLadder` breaks a creation-time tie on the
	 * env-order rank of the environment running the build. On a fixture where no
	 * rollout publishes `created`, that put the ladder's rank-0 build in the
	 * SECOND row, and the page then printed `not yet in` on row 2 and `still
	 * live in` on row 1 — the head's story on the wrong line.
	 */
	minRank: number;
};

export type RepoLedger = {
	repoKey: string;
	repoLabel: string;
	rows: RevisionRow[];
	/**
	 * Revisions this repo knows about at all, INCLUDING the ones no service has
	 * ever deployed. `rows` is the deployed subset; the difference is printed
	 * in the subtitle rather than silently dropped — DESIGN.md forbids silent
	 * truncation, and on the live cluster the difference is 26 of 37.
	 */
	knownRevisions: number;
	/**
	 * THE BUILDS NOBODY HAS TAKEN — `knownRevisions` minus `rows`, as ROWS.
	 *
	 * These used to be a NUMBER and nothing else. The subtitle said `16 of 34
	 * revisions deployed` and the page listed sixteen; the other eighteen were
	 * named in a count and reachable from nowhere in the product — no row, no
	 * link, no detail page. A live UX critique called that out and it is the
	 * page's own first criterion failing: *"what's still out there?"* is a
	 * question about builds that have NOT landed at least as much as about
	 * builds that have.
	 *
	 * They are built by the SAME `buildRow` as the deployed ones, so a pending
	 * revision is not a second kind of object: it has services, labels, ranks,
	 * slots and a coverage of `0 of N`, and its `Not yet` bucket carries the
	 * gates that are the reason it is still here. That makes the detail page
	 * work for it unchanged — and for a blocked build it is the most useful
	 * page in the product, because every one of its places is a place the
	 * promotion has not reached.
	 *
	 * Newest first, same comparator as `rows`.
	 */
	pending: RevisionRow[];
	serviceCount: number;
	slotCount: number;
	lastDeployMs: number;
};

type ServiceCtx = {
	group: AppGroup;
	ladder: BuildLadder;
	/**
	 * REVISION KEY → the ladder entry, so the rank is the ladder's, not ours.
	 *
	 * The key is `build.revision` when the build has one and the DISPLAY VERSION
	 * when it does not. That fallback is not a compromise on the page's thesis,
	 * it is the honest floor: a rollout whose OCI artifacts carry no
	 * `org.opencontainers.image.revision` annotation has no commit identity to
	 * key on, and keying by the only string that exists beats rendering an empty
	 * page. It is the same reasoning `repoKeyFor` uses when `status.source` is
	 * missing. Two such services sharing a label string WOULD merge — which is
	 * exactly the latent bug revision keying closes everywhere the annotation is
	 * present, and it cannot be closed where it is not.
	 */
	byKey: Map<string, { rank: number; onReleaseLine: boolean; version: string }>;
	/**
	 * ⛔ THE ENVIRONMENT LAG IS NOT THE BUILD RANK. (2026-08-31)
	 *
	 * This module ranks BUILDS, and for that the ladder is right and stays.
	 * But `RevisionSlot.currentRank` is a different question — *"how far
	 * behind is this ENVIRONMENT"* — and it renders into a chip spelled
	 * `N behind`, the product's one word. It has to be the product's one
	 * number: the rollout's own candidate count (`env-rank.ts`). Reading it
	 * off the ladder made `/versions/<rev>` a fifth surface with a fourth
	 * answer for one rollout.
	 */
	lagByCell: Map<AppCell, RankVerdict>;
	/** revision key → the OCI tag this service deploys it under. */
	tagByKey: Map<string, string>;
	/** revision key → what this service labels it. */
	labelByKey: Map<string, string>;
	/**
	 * ⭐ DISPLAY VERSION → ITS OWN TAG, THE PARALLEL FIX TO `label`'s
	 * `placed.version` ONE. (2026-09-03, operator-walk BLOCKING item)
	 * `tagByKey` has the SAME "first noted wins" collapse `labelByKey` had —
	 * two releases sharing one revision (rel-66/rel-67) keep whichever tag
	 * `note()` saw FIRST (oldest-first `availableReleases`, so rel-66's), so
	 * `revisionCoverage.ts`'s `candidate` check compared the CURRENT release's
	 * tag against rel-66's own when it needed rel-67's — the tag `service.rank`
	 * and `service.label` both actually name. Keyed by DISPLAY VERSION rather
	 * than by revision, so it cannot collapse two releases that share a
	 * revision into one entry the way `tagByKey` does: every release has its
	 * own, unique display version even when it shares a commit with another.
	 */
	tagByVersion: Map<string, string>;
	/**
	 * Display version → revision key. A `status.history` entry frequently omits
	 * the revision that its `availableReleases` twin carries — `buildLadder`
	 * already merges the two into one record per build, so this map is how a
	 * history entry recovers the key without a second merge of its own.
	 */
	keyByVersion: Map<string, string>;
	cells: AppCell[];
};

function envTierOf(cell: AppCell): string {
	return cell.environment?.spec?.environment || cell.envName || '';
}

/**
 * Gate key form of a release, matching `promotion.ts`'s `gateKeyOf` exactly.
 * This is what `isDeployable` compares against and what `ChangeVersionModal`
 * preselects; it is NOT a display string.
 */
function tagOf(r: { tag?: string; version?: string; revision?: string }): string {
	return r.tag ?? r.version ?? r.revision ?? '';
}

function contextFor(group: AppGroup): ServiceCtx {
	const ladder = buildLadder(group.cells);
	const byKey = new Map<string, { rank: number; onReleaseLine: boolean; version: string }>();
	const keyByVersion = new Map<string, string>();
	for (const b of ladder.builds) {
		const key = b.revision ?? b.version;
		if (!key) continue;
		keyByVersion.set(b.version, key);
		// Keep the FIRST (highest-ranked) entry if two ladder rows somehow share
		// a key — a rank must be a single number.
		if (!byKey.has(key)) {
			byKey.set(key, { rank: b.rank, onReleaseLine: b.onReleaseLine, version: b.version });
		}
	}
	const tagByKey = new Map<string, string>();
	const labelByKey = new Map<string, string>();
	const tagByVersion = new Map<string, string>();
	const note = (raw: { tag?: string; version?: string; revision?: string } | undefined | null) => {
		if (!raw) return;
		const label = getDisplayVersion(raw as { version?: string; revision?: string; tag: string });
		const key = raw.revision ?? keyByVersion.get(label) ?? label;
		if (!key) return;
		const tag = tagOf(raw);
		if (tag && !tagByKey.has(key)) tagByKey.set(key, tag);
		if (label && !labelByKey.has(key)) labelByKey.set(key, label);
		// Unlike `tagByKey`, this one CANNOT collapse two releases: `label` is
		// the exact display version, unique to this one release even when it
		// shares `key` (the revision) with another.
		if (label && tag && !tagByVersion.has(label)) tagByVersion.set(label, tag);
	};
	for (const c of group.cells) {
		for (const rel of c.rollout.status?.availableReleases ?? []) note(rel);
		for (const h of c.rollout.status?.history ?? []) note(h.version);
	}
	return {
		group,
		ladder,
		byKey,
		tagByKey,
		labelByKey,
		tagByVersion,
		keyByVersion,
		cells: group.cells,
		lagByCell: rankVerdicts(group)
	};
}

/**
 * How far behind this environment is, in the product's one denominator —
 * `env-rank.ts`'s own-candidate count. `null` means print no number: a
 * `diverged` or `unknown` verdict is not a distance, and a `0` from either
 * would read as "newest".
 */
function currentLagOf(cell: AppCell, ctx: ServiceCtx): number | null {
	const v: RankVerdict | undefined = ctx.lagByCell.get(cell);
	if (!v) return null;
	if (v.kind === 'newest') return 0;
	if (v.kind === 'behind') return rankBehindBy(v);
	return null;
}

/** The revision key of whatever this environment is running right now. */
function currentKeyOf(cell: AppCell, ctx: ServiceCtx): string | null {
	const v = cell.rollout?.status?.history?.[0]?.version;
	if (!v) return null;
	if (v.revision) return v.revision;
	const label = getDisplayVersion(v as { version?: string; revision?: string; tag: string });
	return label ? (ctx.keyByVersion.get(label) ?? label) : null;
}

function buildRow(
	revision: string,
	createdMs: number,
	lastDeployMs: number,
	serviceCtxs: ServiceCtx[]
): RevisionRow {
	const short = shortRevision(revision);
	const services: RevisionService[] = [];

	for (const ctx of serviceCtxs) {
		// ⭐ THE GUARD IS `labelByKey` STILL — "has this service ever seen the
		// build at all" is a weaker, cheaper question than "which release does
		// `byKey` resolve", and `label` itself no longer reads this value —
		// see below.
		const label0 = ctx.labelByKey.get(revision);
		if (label0 === undefined) continue; // this service has never seen the build
		const placed = ctx.byKey.get(revision);
		/**
		 * ⛔ THE LABEL NOW COMES FROM `placed` — THE SAME RELEASE `rank`
		 * NAMES — NEVER FROM `labelByKey` ALONE. (2026-09-02)
		 *
		 * Two releases can share one revision: a rollback re-ships a build
		 * already released once before under a NEW tag. `labelByKey` keeps
		 * whichever release it noted FIRST (oldest-first `availableReleases`,
		 * so typically the OLDER one); `byKey` keeps whichever `ladder.builds`
		 * ranks BEST (rank ascending, so the NEWEST one). Reading `label`
		 * from one collapse and `rank` from the other pairs two DIFFERENT
		 * releases on one row.
		 *
		 * Measured on the live cluster: `hello-frontend-app` rel-66 and
		 * rel-67 share revision `9f10e494d560`. `labelByKey` kept rel-66's
		 * `2.66.0-66` (noted first, from oldest-first `availableReleases`);
		 * `byKey` kept rel-67's rank 0. The row printed `NEWEST · 2.66.0-66`
		 * — rel-67's rank glued to rel-66's own label, a claim about neither
		 * release. `placed.version` is rel-67's OWN display string
		 * (`Build.version` is `getDisplayVersion` of the exact release
		 * `placed.rank` describes), so the two can no longer disagree:
		 * `NEWEST · 2.67.0-67`.
		 *
		 * ⛔ NOT "PREFER THE RUNNING RELEASE". That was the first draft, and
		 * it changes MORE than the label: `rank` is the SAME field
		 * `revision-coverage.ts`'s `classify()` reads to decide `live` vs
		 * `notYet`. Pulling `rank` down to the running (older) release would
		 * make every environment running rel-66 read `live` again for THIS
		 * row — resurrecting the `6 of 6 · fully rolled out` claim
		 * `classify()`'s own fix (2026-09-02, same day) exists to kill. The
		 * label was the only field that was wrong; only it moves.
		 */
		const label = placed ? placed.version : label0;
		// ⭐ THE TAG NOW FOLLOWS `label`, THE PARALLEL FIX. (2026-09-03) Same
		// reasoning as the label move above: `tagByKey` keeps whichever tag
		// `note()` saw FIRST for this revision, which can be the OLDER release
		// when two share a commit. `tagByVersion` is keyed on the exact
		// release `label` now names, so the two can no longer point at
		// different releases — `revisionCoverage.ts`'s `candidate` check reads
		// this `tag` to decide whether the release the row is ABOUT is a real,
		// gate-checkable candidate.
		const tag = ctx.tagByVersion.get(label) ?? ctx.tagByKey.get(revision) ?? null;

		const slots: RevisionSlot[] = ctx.cells
			.map((cell) => {
				const cur = currentKeyOf(cell, ctx);
				const curPlaced = cur ? ctx.byKey.get(cur) : undefined;
				const onIt = cur === revision;
				return {
					appName: ctx.group.appName,
					envName: envTierOf(cell),
					cell,
					onIt,
					// The ENVIRONMENT's lag, from the product's one denominator —
					// not `curPlaced.rank`, which is the BUILD's position on the
					// ladder. `diverged` and `unknown` print no number at all.
					currentRank: currentLagOf(cell, ctx),
					promoteTag: onIt || !tag || !isDeployable(cell.rollout, tag) ? null : tag,
					tag
				};
			})
			.sort((a, b) => compareEnvironmentNames(a.envName, b.envName));

		services.push({
			appName: ctx.group.appName,
			label,
			labelDiffers: label !== short && !revision.startsWith(label),
			rank: placed ? placed.rank : null,
			ladderLength: ctx.ladder.builds.length,
			diverged: placed ? divergedFromLine(ctx.ladder, placed.version, lastDeployMs) : false,
			slots,
			liveSlots: slots.filter((s) => s.onIt).length
		});
	}

	services.sort((a, b) => a.appName.localeCompare(b.appName));

	const totalSlots = services.reduce((n, s) => n + s.slots.length, 0);
	const liveSlots = services.reduce((n, s) => n + s.liveSlots, 0);

	// Per SERVICE, not per row: a revision can be the head of one service's
	// ladder and three back on another's, and only the first of those has a
	// "not yet" story to tell.
	const notYet: RevisionSlot[] = [];
	const stillLive: RevisionSlot[] = [];
	for (const s of services) {
		if (s.rank === 0) {
			for (const slot of s.slots) if (!slot.onIt) notYet.push(slot);
		} else if (s.liveSlots > 0) {
			for (const slot of s.slots) if (slot.onIt) stillLive.push(slot);
		}
	}

	return {
		revision,
		short,
		createdMs,
		lastDeployMs,
		services,
		labelGroups: groupServicesByLabel(services, short),
		liveSlots,
		totalSlots,
		notYet,
		stillLive,
		offLine: services.filter((s) => s.diverged),
		minRank: services.reduce(
			(n, s) => (s.rank === null ? n : Math.min(n, s.rank)),
			Number.POSITIVE_INFINITY
		)
	};
}

/**
 * SERVICES → NAMES. Insertion order is `services`' order (alphabetical by app
 * name), so the first service to use a name fixes that name's position; then
 * the ONE reordering: the group whose name is the revision's own sha sinks to
 * the end.
 *
 * `labelDiffers` is the predicate, not a string comparison of our own — it
 * already handles the case where the label is a longer prefix of the full
 * revision than `short` is (`revision.startsWith(label)`), which a naive
 * `label !== short` would misclassify as a separate name.
 */
/**
 * DOES THIS ROW HAVE A NAME WORTH PRINTING?
 *
 * False when the row's ONLY group is the revision under its own sha — the
 * case where the name track would print the same seven characters the row's
 * own chip prints 60px to its left. On the live cluster that was 6 rows of 11.
 *
 * THIS IS NOT THE `labelDiffers` RULE COMING BACK, AND THE DIFFERENCE IS THE
 * SCOPE OF THE OMISSION. That rule was per-GROUP: a cell could show
 * `1.66.0-66` on one line and nothing on the next, so ABSENCE sat beside
 * PRESENCE inside one cell and the reader had to decode which meant what.
 * That is the ambiguity worth paying a caption to avoid, and grouping by name
 * already killed it — a multi-name row still prints every group's name,
 * including the sha group, exactly because there the column is load-bearing.
 *
 * This is per-ROW and total: there is one group, so nothing is hidden BESIDE
 * anything, and the fact it would have stated — *these ship under the
 * revision itself* — is already stated by the sha at the head of the row.
 * Nothing to infer, because nothing was omitted from a comparison.
 */
export function rowNamesBuild(row: Pick<RevisionRow, 'labelGroups'>): boolean {
	return row.labelGroups.length > 1 || !row.labelGroups[0]?.isOwnSha;
}

export function groupServicesByLabel(
	services: RevisionService[],
	/**
	 * THE SEVEN-CHARACTER FORM, AND IT IS WHAT THE OWN-SHA GROUP IS NAMED.
	 *
	 * A service that does not rename a build labels it with whatever string
	 * its artifact carries, and that is NOT always `short` — a rollout whose
	 * OCI tag is the full 40-character revision labels it with all forty, and
	 * `labelDiffers` correctly calls that "not a separate name"
	 * (`revision.startsWith(label)`). Rendered raw it would put a 40-character
	 * token in an 84px track and push the services column off its own x on
	 * that row alone.
	 *
	 * So the group is named in the form the page already uses for the
	 * revision: the same seven characters as the row's own chip. This is not
	 * the omit-when-it-matches rule coming back — the name is still printed,
	 * always, for every group. It is printed in one form instead of two.
	 */
	short?: string
): RevisionLabelGroup[] {
	const byLabel = new Map<string, RevisionLabelGroup>();
	for (const s of services) {
		let g = byLabel.get(s.label);
		if (!g) {
			const own = !s.labelDiffers;
			g = { label: own && short ? short : s.label, isOwnSha: own, services: [] };
			byLabel.set(s.label, g);
		}
		g.services.push(s);
	}
	const groups = [...byLabel.values()];
	// Stable: only the own-sha group moves, and there is at most one of it.
	return [...groups.filter((g) => !g.isOwnSha), ...groups.filter((g) => g.isOwnSha)];
}

/**
 * SCOPE: revisions that have been deployed at least once, and the page says so.
 *
 * The list has always been the union of every cell's `status.history`, which
 * the API caps at 4-5 entries — 15 ragged windows unioned into 11 revisions,
 * while 26 further revisions sit on the release ladder having never deployed
 * anywhere. Revision keying does not cause that; it makes it visible.
 *
 * Deployed-at-least-once is kept as the scope because the page's question is
 * "where has this commit got to", which a build that has never left the
 * registry cannot answer. But `knownRevisions` is reported alongside so the
 * subtitle can name the boundary: DESIGN.md forbids silent truncation, and a
 * list that quietly drops 70% of the ladder is exactly that.
 */
export function buildRevisionLedger(
	rollouts: Rollout[],
	environments: Environment[]
): RepoLedger[] {
	const groups = groupRolloutsByApp(rollouts, environments);

	// repoKey → the service contexts that belong to it. An app's cells all
	// share one repoKey (groupRolloutsByApp computes it per cell from the same
	// source annotation), so the first cell is representative.
	const repos = new Map<string, { label: string; ctxs: ServiceCtx[] }>();
	for (const group of groups.values()) {
		const repoKey = group.cells[0]?.repoKey;
		if (!repoKey) continue;
		let repo = repos.get(repoKey);
		if (!repo) {
			repo = { label: repoLabel(repoKey), ctxs: [] };
			repos.set(repoKey, repo);
		}
		repo.ctxs.push(contextFor(group));
	}

	const out: RepoLedger[] = [];
	for (const [repoKey, repo] of repos) {
		// The revision registry for the repo: creation time (ordering), last
		// deploy time (the age column), and whether anyone has deployed it.
		const createdMs = new Map<string, number>();
		const lastDeployMs = new Map<string, number>();
		const deployed = new Set<string>();
		const known = new Set<string>();

		for (const ctx of repo.ctxs) {
			for (const b of ctx.ladder.builds) {
				const key = b.revision ?? b.version;
				if (!key) continue;
				known.add(key);
				const prev = createdMs.get(key) ?? 0;
				if (b.createdMs > prev) createdMs.set(key, b.createdMs);
			}
			for (const cell of ctx.cells) {
				for (const h of cell.rollout.status?.history ?? []) {
					if (!h.version) continue;
					const label = getDisplayVersion(
						h.version as { version?: string; revision?: string; tag: string }
					);
					const key = h.version.revision ?? ctx.keyByVersion.get(label) ?? label;
					if (!key) continue;
					deployed.add(key);
					const t = h.timestamp ? new Date(h.timestamp).getTime() : NaN;
					if (Number.isFinite(t) && t > (lastDeployMs.get(key) ?? 0)) lastDeployMs.set(key, t);
				}
			}
		}

		const byRecency = (a: RevisionRow, b: RevisionRow) =>
			b.createdMs - a.createdMs ||
			a.minRank - b.minRank ||
			b.lastDeployMs - a.lastDeployMs ||
			a.revision.localeCompare(b.revision);

		const rows = [...deployed]
			.map((rev) => buildRow(rev, createdMs.get(rev) ?? 0, lastDeployMs.get(rev) ?? 0, repo.ctxs))
			.filter((r) => r.services.length > 0)
			// Newest first, by BUILD CREATION time — the same ordering the ladder
			// itself uses. Deploy recency is only the tiebreak, because a promotion
			// reaches prod after dev, so the latest deploy is routinely of the
			// oldest build.
			// Newest first by BUILD CREATION time — the ladder's own primary key.
			// The tiebreak is the ladder's RANK, not deploy recency: a promotion
			// reaches prod after dev, so the latest deploy in wall-clock time is
			// routinely of the oldest build, and a page that drops the `−N` chip
			// because "row position is the rank" must not let the two disagree.
			.sort(byRecency);

		if (rows.length === 0) continue;

		// THE OTHER SIDE OF THE SCOPE LINE, MADE REACHABLE. See `pending` on
		// `RepoLedger`: these are the ladder's builds that no service has ever
		// deployed. They were a number in a subtitle and nothing else.
		const pending = [...known]
			.filter((rev) => !deployed.has(rev))
			.map((rev) => buildRow(rev, createdMs.get(rev) ?? 0, 0, repo.ctxs))
			.filter((r) => r.services.length > 0)
			.sort(byRecency);

		out.push({
			repoKey,
			repoLabel: repo.label,
			rows,
			knownRevisions: known.size,
			pending,
			serviceCount: repo.ctxs.length,
			slotCount: repo.ctxs.reduce((n, c) => n + c.cells.length, 0),
			lastDeployMs: rows.reduce((n, r) => Math.max(n, r.lastDeployMs), 0)
		});
	}

	return out.sort((a, b) => b.lastDeployMs - a.lastDeployMs);
}

/** The rank sentence for the detail table — one rank, its own denominator. */
export function rankSentence(service: RevisionService): { rank: string; of: string } | null {
	if (service.rank === null || service.ladderLength === 0) return null;
	// ⛔ `N behind`, NOT `−N`. (2026-08-30) `env-rank.ts`'s `rankLabel` is the
	// product's one spelling and this was the last derivation still producing
	// the signed-integer form — it reached the screen as `hello-multi-app −1
	// 6f9524e of 32` on `/versions/<rev>`, a page whose other three rank chips
	// already said `19 behind`. Same chip, same role, same geometry.
	return {
		rank: service.rank === 0 ? 'newest' : `${service.rank} behind`,
		of: `of ${service.ladderLength}`
	};
}

/**
 * Resolve a URL segment to a revision on this repo.
 *
 * REVISION FIRST, then label. A 12-char slug, a 7-char sha pasted from a
 * terminal, and a full 40-char revision all resolve as prefixes; a link from
 * before the migration (`…/1.66.0-66`) resolves through the label map. The
 * detail page rewrites the URL to the canonical form once resolved, so old
 * links keep working without the old form becoming a second key.
 */
export function resolveRevision(ledger: RepoLedger | null, segment: string): string | null {
	if (!ledger || !segment) return null;
	const needle = segment.toLowerCase();
	// DEPLOYED FIRST, THEN PENDING — but both resolve. A build that has never
	// left the registry now has a row (`RepoLedger.pending`) and therefore a
	// page; refusing to resolve it here is what made the scope line's other
	// eighteen revisions unreachable. Order matters only for an ambiguous
	// prefix, and a build somebody has run is the likelier subject.
	for (const row of ledger.rows) {
		if (row.revision.toLowerCase().startsWith(needle)) return row.revision;
	}
	for (const row of ledger.pending) {
		if (row.revision.toLowerCase().startsWith(needle)) return row.revision;
	}
	for (const row of [...ledger.rows, ...ledger.pending]) {
		for (const s of row.services) {
			if (s.label === segment) return row.revision;
		}
	}
	return null;
}

/** A revision's row, deployed or not. The detail page's one lookup. */
export function findRow(ledger: RepoLedger | null, revision: string | null): RevisionRow | null {
	if (!ledger || !revision) return null;
	return (
		ledger.rows.find((r) => r.revision === revision) ??
		ledger.pending.find((r) => r.revision === revision) ??
		null
	);
}
