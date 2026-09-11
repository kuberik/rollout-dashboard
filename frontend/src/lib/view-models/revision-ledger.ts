import type { Environment, Rollout } from '$lib/../types';
import {
	groupRolloutsByApp,
	repoLabel,
	shortRevision,
	type AppCell,
	type AppGroup
} from '$lib/version-utils';
import { getDisplayVersion, detectStuck } from '$lib/utils';
import { buildLadder, divergedFromLine, type BuildLadder } from './build-ladder';
import { isDeployable, promotionBlock, promotionCandidates } from './promotion';
import { rankVerdicts, rankBehindBy, type RankVerdict } from './env-rank';
import { compareEnvironmentNames } from '$lib/env-order';
import { bakeWord, bakeTitle } from '$lib/bake-status';
// TYPE-ONLY — see `repoDeviation`'s own doc comment for why this does not
// create an import cycle with `revision-coverage.ts` (which itself only
// type-imports FROM this file).
import type { RevisionCoverage } from './revision-coverage';

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
	/**
	 * True when this environment is running THE ROW'S OWN RELEASE right now —
	 * not merely its revision. See `buildRow`'s own doc comment: the two
	 * questions differ only when a revision resolves to more than one
	 * release, and this is always the finer one.
	 */
	onIt: boolean;
	/**
	 * ⭐ ROUND 4a, ITEM A — RUNNING THE SAME COMMIT, UNDER *SOME* RELEASE OF
	 * IT. Weaker than `onIt` (which additionally requires the EXACT release
	 * this row is about) and strictly the OLD `onIt` definition before the
	 * split. This is what tells `revision-coverage.ts`'s `heldBehind()` apart
	 * a place that has not taken this row's release because it is on the
	 * SIBLING release of the same revision (the held/running-a-rollback-tag
	 * case) from a place that simply has not been promoted past a much older,
	 * unrelated commit yet — both land in the `notYet` bucket, and only the
	 * first one is "held" in the sense this row can name.
	 */
	onRevision: boolean;
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
	/**
	 * Identity of THIS ROW, not of the commit: `<revision>#<labels>`. Rows are
	 * split per release ("a row is about ONE release"), so two rows can share a
	 * revision — hello-frontend-app ran rel-66 in prod and rel-67 in dev, both
	 * 9f10e49, and every `{#each … (row.revision)}` threw each_key_duplicate
	 * (2026-09-10, the human: "Revisions list page doesn't open for me"). Key
	 * keyed blocks on this, never on `revision`.
	 */
	key: string;
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
	 * ⭐ EVERY RELEASE A REVISION RESOLVES TO, NOT JUST THE BEST-RANKED ONE —
	 * ROUND 4a, ITEM A. `byKey` above keeps only the first (highest-ranked)
	 * `ladder.builds` entry for a shared key, which is right for `curPlaced`
	 * lookups (a place can only be running ONE build) and wrong for `buildRow`
	 * itself: a rollback re-ships a build already released once before under a
	 * NEW tag, so ONE service's ladder can hold TWO `Build`s sharing one
	 * revision (`hello-frontend-app` rel-66/rel-67, one git sha, two OCI
	 * tags). Collapsing them in `buildRow` pasted the best rank onto whichever
	 * label happened to be noted, producing one row that read `NEWEST` while
	 * describing places running the OLDER of the two. This map is how
	 * `buildRowsForRevision` discovers the ambiguity and builds one row per
	 * release instead of one row per commit. In rank order (ascending), same
	 * as `ladder.builds` itself.
	 */
	releasesByKey: Map<
		string,
		Array<{ rank: number; onReleaseLine: boolean; version: string; createdMs: number }>
	>;
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
	const releasesByKey = new Map<
		string,
		Array<{ rank: number; onReleaseLine: boolean; version: string; createdMs: number }>
	>();
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
		// ⭐ …AND KEEP THEM ALL — see `releasesByKey`'s own doc comment.
		// `ladder.builds` is already rank-ascending, so this list is too.
		const entry = {
			rank: b.rank,
			onReleaseLine: b.onReleaseLine,
			version: b.version,
			createdMs: b.createdMs
		};
		const list = releasesByKey.get(key);
		if (list) list.push(entry);
		else releasesByKey.set(key, [entry]);
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
		releasesByKey,
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

/**
 * The exact display version of whatever this environment is running right
 * now — the finer question `currentKeyOf` cannot answer. Two releases can
 * share a revision key (a rollback re-ships a build under a new tag), so
 * "is this place on the row's revision" and "is this place on the row's
 * RELEASE of it" are different questions once that happens. See `buildRow`'s
 * own `onIt` computation for where the distinction matters.
 */
function currentVersionOf(cell: AppCell): string | null {
	const v = cell.rollout?.status?.history?.[0]?.version;
	if (!v) return null;
	return getDisplayVersion(v as { version?: string; revision?: string; tag: string }) || null;
}

function buildRow(
	revision: string,
	/**
	 * ⭐ ROUND 4a, ITEM A — WHICH RELEASE THIS ROW IS ABOUT, WHEN THE REVISION
	 * IS AMBIGUOUS. `null` is the ordinary case (a revision this SERVICE only
	 * ever saw one release of) and behaves exactly as before: `placed` comes
	 * from `ctx.byKey`, the best-ranked entry. A non-null value is the
	 * caller's answer to "which release, of the several this revision
	 * resolves to" — set by `buildRowsForRevision` only when some service's
	 * own `releasesByKey` for this revision has more than one entry. A
	 * service that has no release matching this exact target is skipped for
	 * THIS row; it gets its own row, keyed by its own version, instead — see
	 * `buildRowsForRevision`.
	 */
	targetVersion: string | null,
	/**
	 * ⭐ COORDINATOR PASS 2, ITEM C — TRUE for exactly one row per split
	 * (the best-ranked / newest version, `versions[0]` in
	 * `buildRowsForRevision`), always true in the ordinary `targetVersion
	 * === null` case. Decides where a NON-ambiguous ctx (a service with
	 * only one release of this revision) attaches: only the primary row,
	 * never every row the split produced — see this row's own doc
	 * comment on `buildRowsForRevision` for the double-count that not
	 * doing this caused.
	 */
	isPrimary: boolean,
	createdMs: number,
	lastDeployMs: number,
	serviceCtxs: ServiceCtx[]
): RevisionRow {
	const short = shortRevision(revision);
	const services: RevisionService[] = [];

	for (const ctx of serviceCtxs) {
		const releases = ctx.releasesByKey.get(revision);
		if (!releases || releases.length === 0) continue; // this service has never seen the build
		// THE ROW'S OWN RELEASE OF THIS BUILD, FOR THIS SERVICE.
		//   · `targetVersion === null` — the ordinary, unsplit case: this
		//     ctx's best-ranked release, same as `ctx.byKey` always has.
		//   · this ctx IS ambiguous here (>1 release of the revision) — the
		//     EXACT release this row is about; it sits out any row that
		//     is not its own.
		//   · this ctx is NOT ambiguous here, but SOME OTHER ctx on this
		//     revision is (the split still happened) — it was never asked
		//     "which of these releases is yours", so it attaches to the
		//     PRIMARY row alone with its own single release, never to
		//     every split row (which would count its live slots once per
		//     row — see `buildRowsForRevision`'s own doc comment).
		let placed:
			| { rank: number; onReleaseLine: boolean; version: string; createdMs: number }
			| undefined;
		if (targetVersion === null) {
			placed = releases[0];
		} else if (releases.length > 1) {
			placed = releases.find((r) => r.version === targetVersion);
		} else if (isPrimary) {
			placed = releases[0];
		}
		if (!placed) continue;
		const label = placed.version;
		// `tagByVersion` is keyed on the exact release `label` names, so it
		// cannot point at a DIFFERENT release the way `tagByKey` (revision-
		// keyed, first-noted-wins) can when two releases share a revision.
		const tag = ctx.tagByVersion.get(label) ?? ctx.tagByKey.get(revision) ?? null;

		const slots: RevisionSlot[] = ctx.cells
			.map((cell) => {
				const cur = currentKeyOf(cell, ctx);
				const sameRevision = cur === revision;
				/**
				 * ⛔ "RUNNING THE REVISION" IS NOT "RUNNING THIS RELEASE OF IT".
				 * (round 4a, item A) When a revision resolves to only one
				 * release (`releases.length <= 1`, the overwhelming case),
				 * the two questions are the same and this is byte-identical
				 * to the old `cur === revision`. When it does not — a
				 * rollback re-ships a build already released once before,
				 * under a NEW tag — a place running the OLDER release must
				 * not read as `onIt` for the NEWER release's own row: that is
				 * exactly how one row came to claim `held in 3 places` about
				 * a build that three places were, in fact, running.
				 */
				const onIt =
					sameRevision && (releases.length <= 1 || currentVersionOf(cell) === placed.version);
				return {
					appName: ctx.group.appName,
					envName: envTierOf(cell),
					cell,
					onIt,
					onRevision: sameRevision,
					// The ENVIRONMENT's lag, from the product's one denominator —
					// not the BUILD's position on the ladder. `diverged` and
					// `unknown` print no number at all.
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
			rank: placed.rank,
			ladderLength: ctx.ladder.builds.length,
			diverged: divergedFromLine(ctx.ladder, placed.version, lastDeployMs),
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
		key: `${revision}#${[...new Set(services.map((x) => x.label))].sort().join('+')}`,

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
		// ⭐ ROUND 4a, ITEM A — THE SAME TWO REGISTRIES, KEYED BY THE EXACT
		// RELEASE (display version) RATHER THAN BY REVISION. `createdMs`/
		// `lastDeployMs` above answer "when did this COMMIT last move", which
		// is right for the ordinary one-release-per-commit row and wrong for
		// a split one: a held release has never been deployed and must not
		// borrow the running release's `lastDeployMs`, nor vice versa.
		const createdMsByVersion = new Map<string, number>();
		const lastDeployMsByVersion = new Map<string, number>();

		for (const ctx of repo.ctxs) {
			for (const b of ctx.ladder.builds) {
				const key = b.revision ?? b.version;
				if (!key) continue;
				known.add(key);
				const prev = createdMs.get(key) ?? 0;
				if (b.createdMs > prev) createdMs.set(key, b.createdMs);
				if (b.createdMs > (createdMsByVersion.get(b.version) ?? 0)) {
					createdMsByVersion.set(b.version, b.createdMs);
				}
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
					if (label && Number.isFinite(t) && t > (lastDeployMsByVersion.get(label) ?? 0)) {
						lastDeployMsByVersion.set(label, t);
					}
				}
			}
		}

		const byRecency = (a: RevisionRow, b: RevisionRow) =>
			b.createdMs - a.createdMs ||
			a.minRank - b.minRank ||
			b.lastDeployMs - a.lastDeployMs ||
			a.revision.localeCompare(b.revision);

		/**
		 * ⭐ ONE ROW PER RELEASE — ROUND 4a, ITEM A, completing the half-fix
		 * `buildRow`'s own 2026-09-02 comment described. A revision splits
		 * into several rows only when some SERVICE actually carries several
		 * releases under it (`ServiceCtx.releasesByKey`, length > 1) — the
		 * ordinary case, several services each with their OWN single label
		 * for one commit, is not ambiguity at all: `groupServicesByLabel`
		 * already draws that as several named groups inside ONE row, and
		 * this must not re-fragment it (see `revision-ledger.test.ts`'s
		 * `fixture()` — two services, two label schemes, one row per commit,
		 * unchanged).
		 *
		 * ⛔ COORDINATOR PASS 2, ITEM C — THE SPLIT SET IS THE AMBIGUOUS
		 * SERVICE'S OWN VERSIONS ONLY, NEVER EVERY CTX'S. The first draft
		 * unioned every ctx's releases at this revision into the version
		 * set, so `hello-api-app` — which has exactly ONE release of
		 * `9f10e49`, no ambiguity of its own at all — got a THIRD row keyed
		 * on its own version string, because that string never equalled
		 * either of `hello-frontend-app`'s two. One revision produced
		 * THREE rows for a fixture with exactly one ambiguous service,
		 * inflating "deployed at least once" by 2 instead of 1 and
		 * silently dropping `hello-api-app` out of the shared release
		 * line's own hero (it and `hello-frontend-app` share a
		 * `releaseLines()` line; the hero is supposed to name both).
		 *
		 * The fix: `versions` is built ONLY from ctxs that are themselves
		 * ambiguous at this revision. A non-ambiguous ctx (`hello-api-app`)
		 * is not asked "which of these versions is yours" at all — it
		 * attaches to exactly the PRIMARY row (`isPrimary`, the
		 * best-ranked / newest of the split, index 0) with its own single
		 * release, the same row it would have occupied in the un-split
		 * model. It sits every OTHER split row out — seeing it there too
		 * would count its live slots once per row it appeared in.
		 */
		function buildRowsForRevision(revision: string, forPending: boolean): RevisionRow[] {
			const rowCreatedMs = createdMs.get(revision) ?? 0;
			const rowLastDeployMs = forPending ? 0 : (lastDeployMs.get(revision) ?? 0);
			const ambiguousCtxs = repo.ctxs.filter(
				(ctx) => (ctx.releasesByKey.get(revision)?.length ?? 0) > 1
			);
			if (ambiguousCtxs.length === 0) {
				const row = buildRow(revision, null, true, rowCreatedMs, rowLastDeployMs, repo.ctxs);
				return row.services.length > 0 ? [row] : [];
			}
			const bestRank = new Map<string, number>();
			for (const ctx of ambiguousCtxs) {
				for (const r of ctx.releasesByKey.get(revision) ?? []) {
					const prev = bestRank.get(r.version);
					if (prev === undefined || r.rank < prev) bestRank.set(r.version, r.rank);
				}
			}
			const versions = [...bestRank.keys()].sort((a, b) => bestRank.get(a)! - bestRank.get(b)!);
			return versions
				.map((version, i) =>
					buildRow(
						revision,
						version,
						i === 0,
						createdMsByVersion.get(version) ?? rowCreatedMs,
						forPending ? 0 : (lastDeployMsByVersion.get(version) ?? 0),
						repo.ctxs
					)
				)
				.filter((r) => r.services.length > 0);
		}

		const rows = [...deployed]
			.flatMap((rev) => buildRowsForRevision(rev, false))
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

		// ⭐ A REPO WITH ZERO DEPLOYS IS STILL A REPO. (REVISIONS-2026-09-05,
		// "repo with no deployed build") This used to be `rows.length === 0`,
		// so a repo none of whose services had EVER deployed anything was
		// dropped from `ledgers` entirely — not merely hero-less, unreachable:
		// no card, no row, no detail page for any of its `known` builds. The
		// per-service ledger (`serviceLedger`, below) is built to answer
		// "Not deployed" for exactly this repo, and the rail's `Never
		// deployed` card already renders from `pending` alone — both need the
		// repo to still be IN `ledgers`. Only a repo with nothing known at
		// all (no rollout has ever named it on a release list) has truly
		// nothing to show.
		if (rows.length === 0 && known.size === 0) continue;

		// THE OTHER SIDE OF THE SCOPE LINE, MADE REACHABLE. See `pending` on
		// `RepoLedger`: these are the ladder's builds that no service has ever
		// deployed. They were a number in a subtitle and nothing else.
		const pending = [...known]
			.filter((rev) => !deployed.has(rev))
			.flatMap((rev) => buildRowsForRevision(rev, true))
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
		// ⛔ WAS A BARE `of ${n}` — A NUMBER WITH NO NOUN. (2026-09-03, operator
		// walk, P4) `/versions/<rev>`'s service row printed `NEWEST 064b655
		// of 33` and left the reader to guess "33 what" — the row's own `title`
		// tooltip already answers it (`"the N builds ${appName} can deploy"`),
		// so the visible text gets the same noun the ledger uses everywhere
		// else for this count, instead of relying on a hover to supply it.
		of: `of ${service.ladderLength} build${service.ladderLength === 1 ? '' : 's'}`
	};
}

/**
 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 5 — THE VISIBLE DENOMINATOR, REWORDED SO
 * IT STOPS READING AS A FRACTION. `rankSentence(...).of` ("of 4 builds") sits
 * beside a WORD, not a numerator digit (`NEWEST` or `3 BEHIND`, never a bare
 * "1"), so `NEWEST  of 4 builds` visually completes to "1 of 4 builds" —
 * a fraction the row never actually draws a numerator for. This states the
 * same fact as a position instead: `service.rank` is 0-indexed from the
 * newest, so `rank + 1` is this build's own place on the ladder.
 *
 * `rankSentence`'s `.of` field is UNCHANGED and stays exported — three other
 * strings on this row (`rank.of.replace(/^of /, '')`) compose full sentences
 * ("the newest of the 4 builds hello-api-app can deploy") that this reword
 * would break if it changed the shared field instead of adding a new one.
 */
export function ladderPositionLabel(service: RevisionService): string {
	if (service.rank === null || service.ladderLength === 0) return '';
	if (service.ladderLength === 1) return 'the only build this service has';
	return `${service.rank + 1} of this service's ${service.ladderLength} builds`;
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

/**
 * ⭐ COORDINATOR PASS 2, ITEM C — "DEPLOYED AT LEAST ONCE" IS A COUNT OF
 * DISTINCT REVISIONS, NEVER OF RAW ROWS. `repo.rows.length` stopped being
 * 1:1 with "how many commits has this repo deployed" the moment a
 * revision could split into more than one row (`buildRowsForRevision` —
 * a rollback re-tags a commit under a second release, still one commit).
 * Reading `rows.length` directly counted `9f10e49` TWICE on the live
 * fleet — once for the release still running, once for the held one that
 * has never landed anywhere — so the head band (`19 of 41` → `21 of 41`)
 * and the repo footer (`14` → `16`) both grew from one split, with no new
 * commit actually deployed. THE DEFINITION, so the next reader does not
 * have to re-derive it from the split: a commit counts once here the
 * moment ANY of its releases has run anywhere, ever — regardless of how
 * many releases (rows) that commit resolves to. This is the ONE place
 * both the head band (`scope`, `+page.svelte`) and the per-repo footer
 * read it, so they cannot drift apart again.
 */
export function deployedRevisionCount(repo: Pick<RepoLedger, 'rows'>): number {
	return new Set(repo.rows.map((r) => r.revision)).size;
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

/**
 * ONE LINE PER (SERVICE, BUILD) THE SERVICE IS ACTUALLY LIVE ON.
 *
 * `REVISIONS-2026-09-05.md` §7 — the answer to *"what is `hello-api-app`
 * running everywhere"*, which the ledger of `RepoLedger.rows` cannot give
 * directly: a `RevisionRow` is keyed by BUILD, so a service that runs one
 * build in DEV/STAGING and an older one in PROD (a promotion in flight) has
 * its story split across two rows. This re-indexes the other way, BY
 * SERVICE, walking every deployed row once.
 *
 * A service can own more than one line — `hello-multi-app` above — because
 * a promotion in flight is exactly two builds live at once on one service's
 * own ladder. A service that has never carried a live slot on any deployed
 * row gets a group with an EMPTY `lines` array, which the page renders as
 * one `Not deployed` row; that is the reason `names` is walked across BOTH
 * `repo.rows` and `repo.pending` — a service that has only ever appeared on
 * a pending (never-deployed) build must still get its own "Not deployed"
 * line rather than being missing from the ledger altogether.
 */
export type ServiceLedgerLine = {
	appName: string;
	revision: string;
	/** The row this line came from (`RevisionRow.key`): unique even when two rows share a revision. */
	rowKey: string;
	short: string;
	/** Rank on THIS service's own ladder; null when unplaceable. Never a guess. */
	rank: number | null;
	ladderLength: number;
	/** Live slots for this (service, build) pair, in `compareEnvironmentNames` order. */
	slots: RevisionSlot[];
};

export type ServiceLedgerGroup = {
	appName: string;
	/** Empty means this service has never deployed anything. */
	lines: ServiceLedgerLine[];
};

export function serviceLedger(repo: Pick<RepoLedger, 'rows' | 'pending'>): ServiceLedgerGroup[] {
	const names = new Set<string>();
	for (const r of repo.rows) for (const s of r.services) names.add(s.appName);
	for (const r of repo.pending) for (const s of r.services) names.add(s.appName);

	const byApp = new Map<string, ServiceLedgerLine[]>();
	for (const n of names) byApp.set(n, []);

	for (const row of repo.rows) {
		for (const service of row.services) {
			if (service.liveSlots === 0) continue;
			const slots = service.slots.filter((s) => s.onIt);
			if (slots.length === 0) continue;
			byApp.get(service.appName)!.push({
				appName: service.appName,
				revision: row.revision,
				rowKey: row.key,
				short: row.short,
				rank: service.rank,
				ladderLength: service.ladderLength,
				slots
			});
		}
	}

	return [...names].sort((a, b) => a.localeCompare(b)).map((appName) => ({
		appName,
		// Newest first, the same convention as every other list on the page —
		// a service running two builds at once shows the one it is MOSTLY on
		// (or, on a tie, the newer one) first.
		lines: (byApp.get(appName) ?? []).sort(
			(a, b) => (a.rank ?? Number.POSITIVE_INFINITY) - (b.rank ?? Number.POSITIVE_INFINITY)
		)
	}));
}

/**
 * ⭐ DEVIATION-FIRST ORDERING WITHIN A LINE — round 3 addendum C, extracted
 * out of `/revisions`' own template so it is testable without mounting the
 * page. A group whose own line has something to say — `lineState`'s own
 * held/pinned/stuck/failing classification, the SAME primitives the home
 * cards read — sorts BEFORE a steady one; ties break alphabetically, which
 * is what makes this ordering worth a fixture at all: alphabetical order and
 * deviation order have to actually DISAGREE for a naive `localeCompare`
 * regression to be visible.
 *
 * `lineIndexOf`, when given, is asked FIRST — a multi-line repo's own
 * RELEASE LINE order takes priority over any one service's deviation, so a
 * service's own trouble never jumps it ahead of a service on an earlier
 * line, only ahead of its line-mates. Omitted entirely on a single-line
 * repo, where there is only one line to sort within.
 */
export function orderServiceGroups(
	groups: ServiceLedgerGroup[],
	options: { lineIndexOf?: (appName: string) => number; now: Date }
): ServiceLedgerGroup[] {
	const { lineIndexOf, now } = options;
	return [...groups].sort((a, b) => {
		if (lineIndexOf) {
			const la = lineIndexOf(a.appName);
			const lb = lineIndexOf(b.appName);
			if (la !== lb) return la - lb;
		}
		const da = a.lines.some((ln) => lineState(ln, now)) ? 0 : 1;
		const db = b.lines.some((ln) => lineState(ln, now)) ? 0 : 1;
		if (da !== db) return da - db;
		return a.appName.localeCompare(b.appName);
	});
}

/**
 * ⭐ WHICH REPO HAS SOMETHING TO SAY — craft-review follow-up 3
 * (REVISIONS-2026-09-05). `buildRevisionLedger`'s own order (most-recently-
 * deployed first) is left UNTOUCHED here — this module's contract for
 * `/revisions/[...slug]`, a route this pass does not own, does not change.
 * `/revisions` (the list) reorders its OWN rendering with this pure,
 * separately-tested function instead: the repo an operator would actually
 * open first — something failing, held, or meaningfully behind — should
 * lead the page and default open, not whichever repo happened to deploy
 * most recently.
 *
 * `headCoverage` is the CALLER's own `revisionCoverage(repo.rows[0], now)` —
 * this module takes only its TYPE (erased at compile time), never a runtime
 * import of `revision-coverage.ts`'s functions, so the two files do not form
 * an import cycle (that file already type-imports FROM this one).
 */
export type RepoDeviationChip = {
	/** Matches `Chip.svelte`'s own `role` prop — kept as a plain string here
	    so this file does not import a `.svelte` component's internal type. */
	role: 'failing' | 'held' | 'rank';
	label: string;
	/**
	 * ⭐ ROUND 4, ITEM 13 — THE ANTECEDENT. `label` already carries the count
	 * (`"3 held"`), but the page's own tooltip for this chip used to be a
	 * static sentence with no number in it ("Places running this build on an
	 * older release…") — a plural noun with nothing upstream telling the
	 * reader HOW MANY. Exposing the raw count lets the call site build a
	 * tooltip that names it directly ("3 places are held by a rule") instead
	 * of parsing it back out of the label string.
	 */
	count: number;
};

export type RepoDeviation = {
	/** Higher sorts first: 3 failing, 2 held, 1 behind, 0 none. */
	severity: 0 | 1 | 2 | 3;
	/** What the collapsed header prints beside the distance rollup, or `null`. */
	chip: RepoDeviationChip | null;
	/** Tiebreak after severity: the size of the never-deployed backlog. */
	backlog: number;
};

export function repoDeviation(
	repo: Pick<RepoLedger, 'pending'>,
	headCoverage: RevisionCoverage | null
): RepoDeviation {
	const backlog = repo.pending.length;
	if (!headCoverage) return { severity: 0, chip: null, backlog };

	const failing = headCoverage.buckets.find((b) => b.key === 'failing')?.slots.length ?? 0;
	if (failing > 0) {
		return { severity: 3, chip: { role: 'failing', label: 'failing', count: failing }, backlog };
	}

	// HELD — a place on an older release of the head's own commit (the same
	// predicate the hero's own "N held" chip uses, see `RevisionLead`'s
	// `heldTotal`).
	//
	// ⭐ COORDINATOR PASS 2, ITEM B — READS `notYet` TOO NOW, NOT JUST `live`.
	// Once a revision splits one row per release (`buildRowsForRevision`),
	// the head row for a HELD release has nobody `live` on it at all — the
	// places running the sibling release land in `notYet` instead (see
	// `revision-coverage.ts`'s `heldBehind`, the same union this mirrors
	// without importing it — this file only TYPE-imports from
	// `revision-coverage.ts`, see this module's own header comment on why).
	// Reading only `live` here made `hello-frontend-app`'s held `9f10e49`
	// read `1 BEHIND` in the collapsed header while its own hero, two
	// scrolls down, said `held in 3 places` — the same rollout, two verdicts.
	//
	// ⭐ ROLE IS `held`, NOT `alarm`. (round-3 addendum B) `held` is not an
	// alarm — CLAUDE.md's own ruling: "a gate correctly refusing a candidate
	// is not a stoppage". `/rollouts` (`RolloutGrid.svelte`) already spells
	// this exact fact `Chip role="held" label="held"`, the quiet TRAILING
	// orange outline chip; this repeated it as the amber `alarm` FILL — the
	// loudest mark in the system, reserved for `stuck`/`unhealthy` — 4.9x
	// louder than the shared spelling. Same role here, so the two pages
	// agree on what "held" looks like as well as what it means.
	const live = headCoverage.buckets.find((b) => b.key === 'live')?.slots ?? [];
	const notYetSlots = headCoverage.buckets.find((b) => b.key === 'notYet')?.slots ?? [];
	const held =
		live.filter((s) => !s.onOwnRelease).length +
		notYetSlots.filter((s) => s.slot.onRevision).length;
	if (held > 0) {
		return { severity: 2, chip: { role: 'held', label: `${held} held`, count: held }, backlog };
	}

	// BEHIND — distinct services with something not yet on the newest build
	// any of them has reached. Counts SERVICES, not places: five environments
	// on one lagging service is one fact, not five. Excludes the ones just
	// counted as `held` above — a place on the SAME commit's sibling release
	// is not "behind" in the ordinary sense; it is held, and may not be
	// counted (and coloured) as both.
	const notYetServices = new Set(
		notYetSlots.filter((s) => !s.slot.onRevision).map((s) => s.appName)
	).size;
	if (notYetServices > 0) {
		return {
			severity: 1,
			chip: { role: 'rank', label: `${notYetServices} behind`, count: notYetServices },
			backlog
		};
	}

	return { severity: 0, chip: null, backlog };
}

/**
 * Deviation first (failing > held > behind > none), the never-deployed
 * backlog second, recency last. `T` is generic so the caller can sort
 * whatever pairing of repo+deviation it already computed rather than this
 * function recomputing coverage itself.
 */
export function sortByDeviation<T extends { repo: RepoLedger; deviation: RepoDeviation }>(
	items: T[]
): T[] {
	return [...items].sort(
		(a, b) =>
			b.deviation.severity - a.deviation.severity ||
			b.deviation.backlog - a.deviation.backlog ||
			b.repo.lastDeployMs - a.repo.lastDeployMs
	);
}

/**
 * ⭐ A REPOSITORY IS NOT ONE RELEASE LINE. (REVISIONS-2026-09-05 round 3, §1)
 *
 * Measured on the live fleet: `kuberik-testing` holds five services, and
 * `9f10e49` is the newest build only for `hello-api-app` and
 * `hello-frontend-app` — `hello-multi-app`, `hello-world-app` and
 * `hello-world-manifests` share an entirely different stream whose newest is
 * `064b655`. The page used to pick ONE repo-wide "newest" row
 * (`repo.rows[0]`) and file everything else under "Also still running",
 * which put a service's own CURRENT build in the "legacy" bucket for no
 * reason other than a different service in the same repo happening to have
 * shipped more recently.
 *
 * A LINE is the set of services that share one newest known build — "release
 * tag sets coincide" resolved operationally as *"whose own head is the same
 * revision"*, which is what a monorepo's independently-versioned services
 * actually partition into, and is derivable from data this module already
 * computes (`RevisionService.rank`) rather than a second opinion about
 * commit ancestry this product has no access to.
 *
 * A service with no placeable rank (never deployed, no ladder) forms a line
 * of its own — grouping it into an arbitrary line by absence of evidence
 * would be exactly the kind of unresolvable-comparison-as-a-claim
 * `divergedFromLine`'s own doc comment already refuses.
 */
export type ReleaseLine = {
	/** The revision every member service's own ladder currently heads with,
	    or `null` when the service has no placeable rank at all. */
	headRevision: string | null;
	/** App names in this line, alphabetical. */
	services: string[];
};

export function releaseLines(repo: Pick<RepoLedger, 'rows' | 'pending'>): ReleaseLine[] {
	const allRows = [...repo.rows, ...repo.pending];
	const headByService = new Map<string, string>();
	const allServices = new Set<string>();
	for (const row of allRows) {
		for (const s of row.services) {
			allServices.add(s.appName);
			if (s.rank === 0 && !headByService.has(s.appName)) headByService.set(s.appName, row.revision);
		}
	}

	/**
	 * ⭐ COORDINATOR PASS 2, ITEM D — MAX PER REVISION, NEVER LAST-WRITE-WINS.
	 * Once a revision can resolve to more than one row (a held sibling
	 * release), `allRows` can carry TWO rows for one key with DIFFERENT
	 * `createdMs` — the held release's (newer) and the running release's
	 * (older). Plain `.set()` per row took whichever was iterated LAST, not
	 * the true newest, so this line's own "how recently was this created"
	 * sort key silently used the OLDER of the two: on the live fleet,
	 * `hello-api-app`/`hello-frontend-app`'s line (head `9f10e49`, held)
	 * sorted AFTER `hello-multi-app`'s (head `064b655`, not held) even
	 * though `9f10e49`'s own held release was created more recently — the
	 * deviating line lost its place at the top of the ledger to a stale
	 * timestamp this map itself introduced.
	 */
	const createdMs = new Map<string, number>();
	for (const row of allRows) {
		const prev = createdMs.get(row.revision) ?? 0;
		if (row.createdMs > prev) createdMs.set(row.revision, row.createdMs);
	}

	const byHead = new Map<string, string[]>();
	for (const appName of allServices) {
		// A service with no rank-0 row anywhere (never deployed, no ladder)
		// gets its OWN line, keyed uniquely so it never merges with another
		// unrankable service by coincidence.
		const key = headByService.get(appName) ?? `unranked:${appName}`;
		if (!byHead.has(key)) byHead.set(key, []);
		byHead.get(key)!.push(appName);
	}

	return [...byHead.entries()]
		.map(([key, services]) => ({
			headRevision: key.startsWith('unranked:') ? null : key,
			services: services.sort((a, b) => a.localeCompare(b))
		}))
		.sort(
			(a, b) =>
				(createdMs.get(b.headRevision ?? '') ?? 0) - (createdMs.get(a.headRevision ?? '') ?? 0) ||
				a.services[0].localeCompare(b.services[0])
		);
}

/**
 * ⭐ THE LEDGER LINE'S OWN STATE — HELD/PINNED/STUCK/FAILING, IN WORDS, THE
 * RIGHT HUE. (round 3, §3) Read off the SAME view-models `buildRolloutCards`
 * (`rollout-cards.ts`, the home cards) reads for exactly these four facts —
 * `detectStuck`, `promotionBlock(...).blocked`, `spec.wantedVersion`, and the
 * latest history entry's `bakeStatus` — so the word on this page cannot
 * disagree with the word on `/` or `/rollouts` for the same rollout. `null`
 * means steady: nothing is drawn for the norm (round-3 addendum I).
 *
 * Worst wins across the line's own live slots, in the order a person would
 * want to know about them: a broken deploy outranks a wedged one, which
 * outranks an ACTIVE deploy happening right now, which outranks a rule's
 * refusal, which outranks a person's own deliberate pin.
 *
 * ⭐ REVISIONS-2026-09-06, ITEM 1 (IN-FLIGHT ON THE LEDGER ROW, finishes round
 * five's own item 2). The live cluster measured a real canary where the hero
 * correctly read `8 live · 1 deploying` while the ledger row for the same
 * service printed no sign that one place was mid-canary at all — `held` and
 * `pinned` are both STATIC facts about a candidate that has not moved;
 * `Deploying`/`InProgress` is a THIRD, temporal fact about the build this
 * line is already on, and it outranks both: a place that is actively
 * finishing its own deploy is not "merely held" or "merely pinned", it is in
 * the middle of becoming something else right now. Checked after `stuck`
 * (round-5 ruling 9: a deploy stuck FOR LONG ENOUGH already reads `stuck`,
 * never a soft `deploying`) and before `held`/`pinned`. The word and hue come
 * from `bake-status.ts` — never spelled here — so this line can never
 * disagree with `/rollouts`' own `deploying`/`checking` words for the
 * identical rollout. `Deploying` wins the tie over `InProgress` when a line
 * spans two environments in two different in-flight phases at once: the
 * version is still literally going out somewhere, which is the more urgent
 * of the two to name.
 */
export type LineStateChip = {
	/** Matches `Chip.svelte`'s own `role` prop. */
	role: 'failing' | 'alarm' | 'held' | 'unranked' | 'deploying' | 'checking';
	label: string;
	title: string;
	/**
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 6 — THE BLOCKED CANDIDATE ITSELF, SO
	 * A `held` LINE CAN NAME WHAT IS ACTUALLY HELD. `role: 'held'` means
	 * "this slot's RUNNING build cannot advance" — the line's own
	 * `short`/`revision` are the RUNNING build, not the held one, and a row
	 * that shows only `HELD <running sha>` names the wrong build. `holdOf`
	 * is the newest candidate `promotionBlock` found blocked
	 * (`promotionCandidates(rollout)[0]`), read off the SAME rollout the
	 * `held` classification itself came from, so the two can never point at
	 * different builds. `null` on every non-`held` result, and on a `held`
	 * result where the candidate has no resolvable revision.
	 */
	holdOf: { short: string; label: string | null } | null;
};

export function lineState(
	line: Pick<ServiceLedgerLine, 'slots'>,
	now: Date
): LineStateChip | null {
	let failing = false;
	let stuck = false;
	let held = false;
	let holdOf: { short: string; label: string | null } | null = null;
	let pinnedVersion: string | null = null;
	let inFlightBake: 'Deploying' | 'InProgress' | null = null;
	for (const slot of line.slots) {
		const rollout = slot.cell?.rollout;
		if (!rollout) continue;
		const bake = rollout.status?.history?.[0]?.bakeStatus;
		if (bake === 'Failed') failing = true;
		if (detectStuck(rollout, { now })) stuck = true;
		// `Deploying` (the build is still going out) is the more urgent of
		// the two in-flight phases, so it wins over an `InProgress` (bake
		// window) slot seen earlier in the same line.
		if (bake === 'Deploying') inFlightBake = 'Deploying';
		else if (bake === 'InProgress' && inFlightBake === null) inFlightBake = 'InProgress';
		if (promotionBlock(rollout).blocked) {
			held = true;
			if (!holdOf) {
				const cand = promotionCandidates(rollout)[0];
				if (cand?.revision) {
					const short = shortRevision(cand.revision);
					const label = getDisplayVersion({
						version: cand.version,
						revision: cand.revision,
						tag: cand.tag ?? ''
					});
					holdOf = { short, label: label && label !== cand.revision && label !== short ? label : null };
				}
			}
		}
		if (rollout.spec?.wantedVersion && pinnedVersion === null) {
			pinnedVersion = rollout.spec.wantedVersion;
		}
	}
	if (failing) {
		return {
			role: 'failing',
			label: 'failing',
			title: 'Deployed here, but the deploy is not healthy.',
			holdOf: null
		};
	}
	if (stuck) {
		return {
			role: 'alarm',
			label: 'stuck',
			title: 'Stuck — this deploy has not moved.',
			holdOf: null
		};
	}
	if (inFlightBake) {
		return {
			role: inFlightBake === 'Deploying' ? 'deploying' : 'checking',
			label: bakeWord(inFlightBake),
			title: bakeTitle(inFlightBake),
			holdOf: null
		};
	}
	if (held) {
		return {
			role: 'held',
			label: 'held',
			title: 'Held: a newer build exists, but no rule lets it through yet.',
			holdOf
		};
	}
	if (pinnedVersion !== null) {
		return {
			role: 'unranked',
			label: 'pinned',
			title: `Pinned to ${pinnedVersion} — automatic deploys are paused until the pin is cleared.`,
			holdOf: null
		};
	}
	return null;
}

/**
 * ⭐ ROUND 11, LANE 2 — ONE MATCH PREDICATE, ROW-SHAPED AND LINE-SHAPED
 * TARGETS BOTH.
 *
 * OPERATOR-WALK FINDING 1 (2026-09-09, BLOCKING): `/revisions?q=2.67.0-67`
 * said "1 build matches" in the head band (which filters `RevisionRow`s —
 * `revision`/`short`/`labelGroups` all checked) while every repository card
 * said "no match" — the per-service ledger filtered its own
 * `ServiceLedgerLine`s with a NARROWER predicate that checked only
 * `revision`/`short`, never the label. A query that matches a release LABEL
 * has to match the row carrying that label, wherever that row is rendered.
 *
 * ⭐ ROUND 11, SECOND OPERATOR WALK, ITEM 1 (BLOCKING, part 2) — AND THE
 * SERVICE NAME, THE FIELD THE SEARCH FIELD'S OWN PLACEHOLDER PROMISES
 * ("Find a build or service"). `/revisions?q=hello-world` printed "0 builds
 * match" in the head band and "0 of 36 builds" on the `kuberik-testing`
 * card's own header while that card's body drew TWO matching rows
 * (`hello-world-app`, `hello-world-manifests`) — `RepoLedgerCard`'s row
 * filter (`visibleGroupsOf`) checked `appName` directly and this predicate
 * did not, so the same contradiction Finding 1 already closed for LABELS
 * reopened for the other field the placeholder advertises. Checking
 * `services[].appName` here closes it for every caller at once, the same
 * way adding the label check did.
 *
 * `target` is `Pick<RevisionRow, 'revision' | 'short' | 'labelGroups' |
 * 'services'>` — satisfied by a `RevisionRow` directly, or by looking one
 * up (see `revisionLookup`, below) for a `ServiceLedgerLine`, which does not
 * carry its own labels or sibling services.
 *
 * ⭐ LANE 9, ROUND 11 QA, ITEM 9 — `matchServiceNames` (default `true`,
 * every EXISTING call site is byte-identical). At the ROW/BUILD level (the
 * index, `BuildLists`, the repository page's own `repoRowMatchesFilter`),
 * "does this build match the query" correctly includes "because one of its
 * services does" — a build is relevant if the reader named its sha, its
 * label, OR a service that runs it. But `RepoLedgerCard`'s per-SERVICE
 * ledger line is a narrower question: "does THIS service's own row match",
 * and re-using the row-level predicate there let a query for
 * `hello-api` — matching nothing about `hello-frontend-app` itself — still
 * show `hello-frontend-app`'s line, because `matchesRevisionText` checked
 * every OTHER service sharing that row's revision too. `false` restricts
 * the check to the row's own sha/label — facts about the BUILD, still fair
 * to share across services on one row — and drops the sibling-name clause
 * that was leaking one service's match onto another's line.
 */
export function matchesRevisionText(
	target: Pick<RevisionRow, 'revision' | 'short' | 'labelGroups' | 'services'>,
	query: string,
	matchServiceNames = true
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	return (
		target.revision.toLowerCase().startsWith(q) ||
		target.short.toLowerCase().includes(q) ||
		target.labelGroups.some((g) => g.label.toLowerCase().includes(q)) ||
		(matchServiceNames && (target.services ?? []).some((s) => s.appName.toLowerCase().includes(q)))
	);
}

/**
 * Every revision this repo knows about (deployed or pending), keyed for a
 * quick label lookup — what `matchesRevisionText` needs to check a
 * `ServiceLedgerLine` (which has a `revision` but no `labelGroups` of its
 * own) against the SAME predicate a `RevisionRow` is checked against.
 *
 * ⛔ THE VALUE IS AN ARRAY, NOT A SINGLE ROW — AND THAT IS NOT INCIDENTAL.
 * `buildRowsForRevision` splits ONE revision into SEVERAL `RevisionRow`s
 * the moment some service carries several releases of it (a held sibling
 * release, e.g. `9f10e49` resolving to both a running `1.66.0-66` row and a
 * held `2.67.0-67` row) — the exact live-cluster shape finding 1 was
 * reported against. A `Map<string, RevisionRow>` can hold only ONE of
 * them per revision, so whichever row lost the map slot had its OWN
 * `labelGroups` (and so its own label) silently unreachable from a
 * `ServiceLedgerLine` search — reproducing the blocking defect one layer
 * down from where it was first fixed. Callers check EVERY row sharing the
 * revision (`.some(...)`), never just the first.
 */
export function revisionLookup(
	repo: Pick<RepoLedger, 'rows' | 'pending'>
): Map<string, RevisionRow[]> {
	const m = new Map<string, RevisionRow[]>();
	for (const row of [...repo.rows, ...repo.pending]) {
		const list = m.get(row.revision);
		if (list) list.push(row);
		else m.set(row.revision, [row]);
	}
	return m;
}

/**
 * ⭐ ROUND 3 §1 — A REPOSITORY IS NOT ONE RELEASE LINE. Ported from
 * `/revisions`' own template (round six) so the repository page (lane 3)
 * and the index card (lane 2) compute the SAME lead row per release line
 * rather than two independent opinions about which row is "the head".
 *
 * One hero/verdict-worthy row PER LINE whose own head has actually been
 * DEPLOYED — a line whose newest known build has never been deployed
 * anywhere has nothing to lead with (it belongs to the "Never deployed"
 * list instead, per `releaseLines`' own `headRevision` doc comment).
 */
export function leadRowsFor(repo: Pick<RepoLedger, 'rows'>, lines: ReleaseLine[]): RevisionRow[] {
	const out: RevisionRow[] = [];
	for (const line of lines) {
		// ⚠️ NOT `line.headRevision` — see this function's own callers: the
		// hero states what is DEPLOYED, so it is this line's own newest row
		// within `repo.rows` (already sorted newest-first), not the line's
		// absolute ladder head, which can itself be undeployed.
		const deployed = repo.rows.find((r) =>
			r.services.some((s) => line.services.includes(s.appName))
		);
		if (deployed) out.push(deployed);
	}
	return out;
}

/** The two halves of the ledger, split on the page's FIRST criterion. */
export function liveRows(repo: Pick<RepoLedger, 'rows'>): RevisionRow[] {
	return repo.rows.filter((r) => r.liveSlots > 0);
}

/** Everything still running that is NOT one of the lines' own heads. */
export function restRows(repo: Pick<RepoLedger, 'rows'>, headRevisions: Set<string>): RevisionRow[] {
	return liveRows(repo).filter((r) => !headRevisions.has(r.revision));
}

/**
 * ⭐ REVISIONS-2026-09-06, ITEM 8 — SORTED BY THE DATE IT DISPLAYS. `rows` is
 * ordered by BUILD CREATION time (`buildRevisionLedger`'s own contract) —
 * filtering it for "No longer running anywhere" without re-sorting leaves
 * the row order following creation time while every row's own printed fact
 * is `Last deployed N ago`. Newest `lastDeployMs` first, matching the age
 * this list actually prints.
 */
export function pastRows(repo: Pick<RepoLedger, 'rows'>, headRevisions: Set<string>): RevisionRow[] {
	return repo.rows
		.filter((r) => r.liveSlots === 0 && !headRevisions.has(r.revision))
		.sort((a, b) => b.lastDeployMs - a.lastDeployMs);
}
