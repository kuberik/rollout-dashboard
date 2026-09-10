/**
 * THE PR-CENTRIC PIPELINE — "is my PR in yet, why not, when", per service.
 *
 * Reads the design doc's Frontend section
 * (`luka-polish-revisions-pass-6-design-20260910-092839.md`) for the exact
 * precedence this implements; this file is that precedence, and nothing
 * else decides it. `/pr/{owner}/{repo}/{number}` and `PipelineCard.svelte`
 * (both owned by a later lane) render what this computes; they invent none
 * of it.
 *
 * ── WHAT "CONTAINS THE PR" MEANS ──────────────────────────────────────────
 *
 * The backend's `containedIn` is `{mergeCommitSha} ∪ {commits on base since
 * mergedAt}`, capped at 300. A revision is a LITERAL member of that set or
 * it is not — that membership test alone answers rules 1 and 2 below
 * (`history[].version.revision`), because `versionHistoryLimit` (default
 * 10) keeps the deploy history close enough to HEAD that the 300-commit cap
 * essentially never bites there; the fixture proving the shape ("build sha
 * is a descendant of the merge commit", the rebase-merge case) is exactly
 * this — a revision that is not `mergeCommitSha` itself but is still, quite
 * literally, IN the set the backend already computed.
 *
 * `status.availableReleases`, by contrast, can span far more history than
 * ten deploys, so a release's revision genuinely can fall outside a
 * TRUNCATED (`containedInAll: true` — the backend's name for "the
 * since-list was cut at 300") set without being absent — that is what
 * `containment()` below's `release.created` vs `mergedAt` fallback is for,
 * and it applies ONLY there (rule 3/4's boundary), never to a history
 * entry. When `containedInAll` is `false` the list is COMPLETE, so absence
 * from it is authoritative: not built, no fallback, whatever `created`
 * says.
 *
 * ── KNOWN LIMITATION: A REVERT PR ─────────────────────────────────────────
 *
 * `containedIn` is built from commit ANCESTRY on `base`, which cannot tell
 * a commit that re-applies a change from one that reverts it — both are
 * "since mergedAt" the same way. So this module will keep reporting the
 * ORIGINAL pr's cells as `live` after a later PR reverts it, because the
 * revert commit is itself in the same `containedIn` set. The design doc
 * records this as an accepted v1 limitation ("a later slice can subtract
 * reverted ranges"); `pr-pipeline.test.ts`'s revert fixture asserts the
 * CURRENT behaviour so a future fix has something concrete to change.
 */
import type { Rollout, Environment, RolloutDependency } from '$lib/../types';
import { releaseMetadataUnresolved } from '$lib/../types';
import { getDisplayVersion } from '$lib/utils';
import { parseGoDuration } from '$lib/utils';
import { getEnvironmentRank } from '$lib/env-order';
import {
	groupRolloutsByApp,
	repoKeyFromSource,
	repoLabel,
	envFamilyWord,
	type AppCell
} from '$lib/version-utils';
import { deployActs, historyAtLimit, type DeployAct } from '$lib/history-marks';
import { rolloutPath } from '$lib/source-dashboard';
import type { EnvironmentTheme } from '$lib/environment-theme';
import { gateAllows } from './promotion';
import { buildGateContext, classifyGate, type GateContext } from './blocking-story';
import { median, leadTime, type LeadEnv, type LeadDeploy } from './lead-time';

export type PrState =
	| 'not-built'
	| 'gated'
	| 'pinned'
	| 'waiting-upstream'
	/**
	 * ⭐ FIX PASS ITEM 4 (2026-09-10) — "AMBER IS RESERVED FOR STUCK". Split
	 * off `waiting-upstream` for the case its own `gateSubjectKind ===
	 * 'environment'` names — a NORMAL promotion-order wait ("waiting for dev
	 * to deploy it first"), nobody blocking anything, just this env's own
	 * turn hasn't come up yet. `waiting-upstream` is now reserved for a
	 * `'service'`-subject dependency wait, which IS something a rule is
	 * actively refusing — the two used to share one state and one amber
	 * field/ring, which painted the ordinary, expected "not promoted here
	 * yet" case with the same "needs a look" colour reserved for a genuine
	 * stuck dependency. Colour and glyph both key off this new state, never
	 * off `gateSubjectKind` at render time (`LandingMark.svelte`,
	 * `landing-grid.ts`).
	 */
	| 'queued'
	| 'promoting'
	| 'deploying'
	| 'baking'
	| 'retrying'
	| 'failed'
	| 'cancelled'
	| 'rolled-back'
	| 'live';

/**
 * Where `PipelineCard.svelte` can fetch the FULL gate object, lazily, when a
 * reader expands this cell's reason. `rolloutGates` are not streamed with
 * the list (`blocking-story.ts:403`'s own doc comment) — this is a HANDLE,
 * never fetched by this module, never rendered raw in prose (the gate id is
 * deliberately absent from `reason`; see `blocking-story.ts`'s "FIVE handle
 * lines in one viewport" rule).
 */
export type PrGateHint = {
	cluster: string;
	namespace: string;
	rolloutName: string;
	gateName: string;
};

export type PrCell = {
	cluster: string;
	envName: string;
	/**
	 * ⭐ GAP FILLED BY F2 (`PipelineCard`/route lane): the row needs a
	 * destination (`namespace`/`rolloutName`, alongside `cluster` above) and
	 * an env-identity `Chip` (`theme`) — both were on F1's own `AppCell` all
	 * along (`version-utils.ts`) and simply were not carried through
	 * `buildCell`'s narrower return shape. Added here rather than threading
	 * `AppCell` itself through the card, so the card's one input stays the
	 * VM's own cell type.
	 */
	namespace: string;
	rolloutName: string;
	theme: EnvironmentTheme | null;
	/** Promotion-order rank, `getEnvironmentRank` — dev → staging → prod. */
	envRank: number;
	state: PrState;
	/** The "why", one sentence fragment, never the raw gate id. */
	reason: string;
	/** ISO instant this state began, or `null` when it cannot be known. */
	since: string | null;
	/** This rollout's own median bake span, `null` under a 2-sample guard. */
	usuallyMs: number | null;
	/** Time left against `deployTimeout`/`bakeTime`, or `null`. */
	bakeLeftMs: number | null;
	/** The display name of the build this cell is about, `''` when none. */
	releaseLabel: string;
	/** The git revision this cell is about, `null` when none. */
	revision: string | null;
	/**
	 * `true` on a `live` cell whose actually-deployed revision is a LATER
	 * commit that also carries the PR — the PR's own merge commit has
	 * already been superseded by a later build, so the cell is live but not
	 * because of the exact commit that shipped it.
	 */
	superseded: boolean;
	/** See `PrGateHint`. `null` when this cell's state names no gate. */
	gateHint: PrGateHint | null;
	/**
	 * ⭐ GAP FILLED BY F2 — `ClassifiedGate.label` ("the gate in words an
	 * operator can act on", `blocking-story.ts`'s own phrase), set ONLY on a
	 * `gated` cell. This is the `<name>` in the card's fixed "gated by
	 * <name>" sentence; `reason` (`pick.short`) stays the fuller muted-text
	 * clause so the two never restate one fact twice.
	 */
	gateLabel: string | null;
	/**
	 * ⭐ GAP FILLED BY F2 — `ClassifiedGate.subject` (the upstream env or
	 * service NAME, never a sentence), set ONLY on a `waiting-upstream`
	 * cell. This is the `<service/env>` in "waiting on <service/env>".
	 */
	gateSubject: string | null;
	/**
	 * `ClassifiedGate.subjectKind`, carried through so `pr-cell-copy.ts` can
	 * pick the right verb: `'environment'` (a promotion order — "waiting for
	 * dev to deploy it first") reads differently from `'service'` (a
	 * dependency — "waiting on hello-api-app"). `null` off a `waiting-upstream`
	 * cell.
	 */
	gateSubjectKind: 'service' | 'environment' | 'schedule' | null;
	/**
	 * ⭐ ITEM 3 (2026-09-10 fix pass). `true` when this VM cannot yet back up
	 * a specific rule name or kind for a `gated` cell — either `classifyGate`
	 * itself said `pending` (the schedule join has not landed), or the gate
	 * classified as `approval`/`unknown` with NO owner evidence (this module
	 * never supplies `rolloutGates`, so that classification is a guess it
	 * cannot stand behind; it may really be a closed schedule). `gateLabel`
	 * is null exactly when this is `true`. The row renders a generic "held
	 * by a rule" sentence and a `SkeletonBar` for the reason — never the
	 * gate's raw Kubernetes id — until the "why" disclosure's lazy fetch
	 * (which DOES supply owner evidence and the schedule join) resolves it.
	 */
	gatePending: boolean;
	/**
	 * ⭐ FIX PASS ITEM 5 (2026-09-10). The dependency's own contract name
	 * (`api`, say) and the range the gate actually evaluates (`^1.68.0`) —
	 * `classifyGate`'s own `contract`/`need` fields, carried through so the
	 * VERDICT can name "the honest when" (`buildChangeVerdict`'s own "will
	 * not move on its own — needs X" tail) without re-deriving them from
	 * `reason`'s free text. `null` off every cell except a `waiting-upstream`
	 * one whose gate resolved to a dependency (`gateSubjectKind: 'service'`).
	 */
	gateContract: string | null;
	gateRequiredVersion: string | null;
	/**
	 * ⭐ FIX PASS ITEM 5. Set by `joinDependencyReasons`'s own cross-service
	 * pass (RULING 4) — `true` when the provider named by `gateSubject` has
	 * NOT built this change AT ALL yet, meaning this cell genuinely cannot
	 * resolve on its own no matter how long the reader waits: nothing here
	 * is moving until the provider ships. `false` (never `true`) off every
	 * other state.
	 */
	providerHasNoBuild: boolean;
	/**
	 * ⭐ RULING 1 (CHANGES-2026-09-10 fix pass, "SUPERSEDED IS LIVE"). `false`
	 * when this VM cannot yet trust a POSITIVE containment claim beyond an
	 * exact sha match — a bare-sha `PrPipelineMeta` with an empty
	 * `containedIn` and `containedInAll: false` (the stub shape
	 * `{mergeCommitSha, containedIn: [], containedInAll: false}` §3
	 * constructs before the `commits/:sha` endpoint's real ancestry list is
	 * wired in). Same value on every cell this call produces — see
	 * `buildPrPipeline`'s own `containmentKnown` local. When `false`,
	 * `buildCell` refuses to report `promoting`/`waiting-upstream` off a
	 * merely-exact-match candidate (that candidate may already be a
	 * superseded, historical release while the real head — unprovably —
	 * already carries the change) and reports `not-built`/"not built
	 * (unverified)" instead, so the page can fetch real ancestry rather than
	 * print a confident but possibly-wrong "promoting shortly"/"waiting for
	 * staging".
	 */
	containmentKnown: boolean;
	/**
	 * ⭐ ROUND 2, R2.3 — `ChangeHistoryCard`'s OWN DATA. Every entry in THIS
	 * rollout's `status.history` that carries the change (`set.has(revision)`
	 * — the SAME membership test rules 1/2 above already run; no second
	 * containment pass) — "ran here before" and "rolled back" survive as
	 * real facts even on a cell whose CURRENT state is `not-built` (the
	 * change shipped here once and was later superseded). Newest first,
	 * same order as `status.history` itself. `act` is `history-marks.ts`'s
	 * own `deployActs(rollout)[i]`, index-aligned — the identical
	 * rollback/forward/redeploy classification the rollout detail History
	 * tab already computes, not a second one.
	 *
	 * ⚠️ OPTIONAL, DELIBERATELY — three fixture files this lane does not own
	 * (`changes.test.ts`, `landing-grid.test.ts`, both LA's) construct
	 * `PrCell` literals directly; making these three fields REQUIRED would
	 * force an edit to files outside this lane's ownership for a field
	 * those tests never read. `buildCell` (the only real producer) always
	 * sets all three; a hand-built fixture that omits them simply has none
	 * to show, same as omitting any other optional field elsewhere in this
	 * type.
	 */
	historyMatches?: PrHistoryMatch[];
	/** `history-marks.ts`'s own `historyAtLimit` — this rollout's retained
	 *  history may have evicted an earlier deploy of this change. */
	historyAtLimit?: boolean;
	/** `rollout.spec.versionHistoryLimit`, or the controller's own default —
	 *  the number `ChangeHistoryCard`'s retention caveat names. */
	versionHistoryLimit?: number;
};

/** One matched `status.history` entry — see `PrCell.historyMatches`. */
export type PrHistoryMatch = {
	revision: string | null;
	displayVersion: string;
	timestamp: string;
	bakeStatus: string;
	triggeredBy: { kind: 'User' | 'System'; name: string } | null;
	act: DeployAct;
};

export type PrService = {
	appName: string;
	/** `github.com/owner/repo`, this app's OWN `status.source`, normalised. */
	sourceRepo: string;
	cells: PrCell[];
	/** The rollup sentence, e.g. "live in dev · baking in staging". */
	furthest: string;
	/**
	 * ⭐ ITEM 11 (2026-09-10 fix pass). The SAME rollup, folded to a form
	 * that fits a narrow card — "1 of 3 live", "held in dev · stg" — for
	 * `Card`'s `verdictCompact`, shown instead of `furthest` below a 560px
	 * card width. See `compactFurthestSentence`'s own doc comment for the
	 * fold order. ⭐ RULING 7 (2026-09-10 fix pass): the held reading names
	 * the FAMILY WORDS of the held environments, never a bare count.
	 */
	furthestCompact: string;
	/** This app's own dev→prod lead time, `null` with fewer than 2 samples. */
	leadTimeMs: number | null;
	/**
	 * ⭐ RULING 2 (CHANGES-2026-09-10 fix pass, "NOT-BUILT HAS NO ETA"). `true`
	 * when some OTHER service of this same repository has at least one cell
	 * whose state is not `not-built` — i.e. the change HAS been built
	 * somewhere on this cluster, just not for THIS service.
	 *
	 * ⚠️ ROUND 3 (2026-09-10 ruling A, "NO RELEASE MEANS NOT AFFECTED") —
	 * LARGELY VESTIGIAL NOW. `buildPrPipeline` only ever keeps a service in
	 * `PrPipelineVM.services` when IT ITSELF has release evidence
	 * (`unaffectedServices` is where a service with none goes instead), so
	 * "a service with no build of its own, while a sibling has one" is a much
	 * rarer shape than it used to be — kept for compatibility (a hand-built
	 * fixture, or the narrow case every cell of an otherwise-included service
	 * reads `not built (unverified)`), but `pr-cell-copy.ts` no longer reads
	 * it (see `cellStateSentence`'s own doc).
	 */
	builtElsewhere: boolean;
};

/** THE SHORT VERDICT'S TONE — CHANGES-2026-09-10 §2b/§3. Canonical home is
 *  here (not `changes.ts`): `buildChangeVerdict` below is the ONE frontier
 *  verdict function the change page, the index row and the Home card all
 *  share (ruling 3); `changes.ts`'s own `changeVerdict` re-exports this type
 *  and thinly wraps the function so existing call sites keep working. */
export type ChangeVerdictTone = 'live' | 'held' | 'failed' | 'active' | 'not-built';

export type PrPipelineVM = {
	services: PrService[];
	/** The page's one verdict line, e.g. "live everywhere". Sentence-cased for
	 *  head-band prose; same words `verdictWord` carries, lower-cased. */
	verdict: string;
	/** The SAME verdict, lower-case, undecorated — §2b's row-word spelling
	 *  ("held in dev on hello-api-app"), for a caller that colours the word
	 *  by `verdictTone` rather than dropping it into a capitalised sentence. */
	verdictWord: string;
	verdictTone: ChangeVerdictTone;
	/** See `PrCell.containmentKnown` — one value for the whole PR/commit. */
	containmentKnown: boolean;
	/** ⭐ RULING 5 (COUNTS). Every rollout (cell) this change could possibly
	 *  land in, on this cluster — ⭐ ROUND 3: scoped to `services` (INCLUDED
	 *  services only; see `unaffectedServices`), never the wider set of every
	 *  app that merely sources this repository. */
	rolloutsTotal: number;
	/**
	 * Cells whose state is not `not-built` — "N of M rollouts have a build
	 * of this change".
	 *
	 * ⭐ ROUND 3 (2026-09-10 ruling A). NOW REDUNDANT, `=== rolloutsTotal` in
	 * every ordinary case: a service is only ever kept in `services` when it
	 * has release evidence, and every cell of a kept service that would
	 * otherwise read `not-built` is recast `queued` (see
	 * `remapForIncludedService`) — so there is nothing left for this filter
	 * to exclude. Kept as its own field for callers that already read it
	 * (rather than assuming it equals `rolloutsTotal`); the ONE case it can
	 * still differ is the rare all-cells-`not built (unverified)` shape
	 * (`buildCell`'s ruling-1 honesty guard), which is intentionally NOT
	 * recast — see `remapForIncludedService`'s own doc.
	 */
	rolloutsWithBuild: number;
	/** Cells whose state is `live`. */
	rolloutsLive: number;
	/**
	 * ⭐ ROUND 3 (2026-09-10 ruling A, "NO RELEASE MEANS NOT AFFECTED"). App
	 * names this PR's own repository matches on this cluster, but which carry
	 * NO release evidence for this exact change (no exact/descendant sha
	 * match anywhere in history or `availableReleases`) — dropped out of
	 * `services` entirely rather than rendered as an empty/"not built" card.
	 * Exposed for debugging ONLY; no product surface renders this list.
	 */
	unaffectedServices: string[];
	/**
	 * ⭐ ROUND 3 (2026-09-10 ruling A). `true` when this repository DOES have
	 * at least one app deploying it on this cluster, but NONE of them carry
	 * any release evidence for this exact change — "assume CI didn't release
	 * it for a reason" (the tech lead's own words). Distinct from the
	 * `services.length === 0` case where NO app on this cluster sources this
	 * repository at all (`verdictWord`/`verdict` stay "not built here" for
	 * that one, unchanged). A `noRelease` VM has `services: []` and a verdict
	 * of "no release for this commit yet" — no per-service card, one line.
	 */
	noRelease: boolean;
};

/**
 * The PR facts `fetchPull` (`api/pulls.ts`) resolves, plus the repo it is on.
 *
 * ⭐ `number` IS OPTIONAL (CHANGES-2026-09-10 §3): a bare commit reference —
 * `/changes/<repo>/<sha>`, no PR behind it at all — constructs this same
 * shape with no PR number, `containedIn: []`, `containedInAll: false` (exact
 * membership: only `mergeCommitSha` itself counts, never a truncation
 * fallback). Nothing in this module reads `number` — it exists for a
 * caller's own head band (a PR page prints `#N`; a bare-sha page does not) —
 * so leaving it unset changes no VM behaviour at all.
 */
export type PrPipelineMeta = {
	owner: string;
	repo: string;
	number?: number;
	mergedAt: string | null;
	mergeCommitSha: string | null;
	containedIn: readonly string[];
	containedInAll: boolean;
	/**
	 * ⭐ RULING 1 (CHANGES-2026-09-10 fix pass). Explicit override for
	 * `buildPrPipeline`'s own "do I actually have real ancestry data" check.
	 * Optional and additive: a caller that has verified real ancestry (a
	 * fully-resolved PR, or a bare sha whose `commits/:sha` fetch came back
	 * with an authoritative empty list — genuinely zero commits since) may
	 * pass `true` even with `containedIn: []`. Omitted, the default is
	 * `containedIn.length > 0 || containedInAll` — which reads a `{
	 * containedIn: [], containedInAll: false }` stub (§3's bare-sha
	 * construction, before `commits/:sha` is wired for a given caller) as
	 * UNKNOWN, never as "verified empty".
	 */
	containmentKnown?: boolean;
};

type ReleaseLike = { tag: string; version?: string; revision?: string; created?: string };

function buildContainedSet(meta: PrPipelineMeta): Set<string> {
	const set = new Set<string>();
	if (meta.mergeCommitSha) set.add(meta.mergeCommitSha);
	for (const sha of meta.containedIn) set.add(sha);
	return set;
}

type Containment = 'contained' | 'not-contained' | 'unverified';

/**
 * ⭐ THE ONE PLACE THE `containedInAll` FALLBACK IS WRITTEN. Only ever asked
 * of `availableReleases` entries (rule 3/4's boundary) — see the module doc.
 *
 * `containedInAll` is the BACKEND'S own name for "the since-list was
 * TRUNCATED at 300" (`main_github_pulls.go`'s `cutAt300`) — a confusing
 * name for a true bit, but that is its meaning: `false` means the list is a
 * COMPLETE, AUTHORITATIVE account of every commit since the merge, so a
 * revision absent from it is simply not built, full stop, whatever its
 * `created` timestamp says. `true` means the list was cut short, so a
 * revision outside it is not PROVEN absent — only then do we fall back to
 * comparing `release.created` against `mergedAt` per release, and even that
 * fallback refuses to call a release with no `created` timestamp
 * "contained": nil `created` is `unverified`, never `contained`.
 */
function containment(release: ReleaseLike, set: Set<string>, meta: PrPipelineMeta): Containment {
	if (release.revision && set.has(release.revision)) return 'contained';
	if (!meta.containedInAll) return 'not-contained';
	if (!release.created) return 'unverified';
	if (!meta.mergedAt) return 'not-contained';
	const createdMs = new Date(release.created).getTime();
	const mergedMs = new Date(meta.mergedAt).getTime();
	if (!Number.isFinite(createdMs) || !Number.isFinite(mergedMs)) return 'unverified';
	return createdMs < mergedMs ? 'not-contained' : 'contained';
}

function findContainingRelease(
	releases: readonly ReleaseLike[],
	set: Set<string>,
	meta: PrPipelineMeta
): { release: ReleaseLike; state: Containment } | null {
	let unverifiedHit: ReleaseLike | null = null;
	for (const r of releases) {
		const c = containment(r, set, meta);
		if (c === 'contained') return { release: r, state: c };
		if (c === 'unverified' && !unverifiedHit) unverifiedHit = r;
	}
	return unverifiedHit ? { release: unverifiedHit, state: 'unverified' } : null;
}

/** Tag → revision, for resolving `spec.wantedVersion` (a TAG, never a revision). */
function revisionForTag(rollout: Rollout, tag: string): string | null {
	for (const rel of rollout.status?.availableReleases ?? []) {
		if (rel.tag === tag) return rel.revision ?? null;
	}
	for (const h of rollout.status?.history ?? []) {
		if (h.version?.tag === tag) return h.version.revision ?? null;
	}
	return null;
}

/** `displayVersionForTag`'s own lookup, inlined so this module has no other
 *  dependency on `version-utils.ts` beyond the grouping/repo helpers. */
function displayVersionForTag(rollout: Rollout, tag: string): string {
	for (const rel of rollout.status?.availableReleases ?? []) {
		if (rel.tag === tag) return getDisplayVersion(rel);
	}
	for (const h of rollout.status?.history ?? []) {
		if (h.version?.tag === tag) return getDisplayVersion(h.version);
	}
	return tag.length > 12 ? tag.slice(0, 7) : tag;
}

/** Time left against a Go-duration deadline that started at `startIso`. May
 *  be negative (the deadline has already passed but the controller has not
 *  reconciled the terminal state yet). `null` when the duration is unset. */
function deadlineLeftMs(startIso: string | undefined, duration: string | undefined, now: Date): number | null {
	if (!startIso || !duration) return null;
	const totalMs = parseGoDuration(duration);
	if (!totalMs) return null;
	const start = new Date(startIso).getTime();
	if (!Number.isFinite(start)) return null;
	return totalMs - (now.getTime() - start);
}

/**
 * This ONE rollout's own median bake span, with its OWN ≥2-samples guard —
 * `medianBakeSpan` (`lead-time.ts`) folds several rollouts together and
 * `median()` alone happily returns a one-sample "median", which is not a
 * typical anything. Scoped to `≤ versionHistoryLimit` entries because that
 * is all `status.history` ever holds.
 */
function cellUsuallyMs(rollout: Rollout): number | null {
	const spans: number[] = [];
	for (const h of rollout.status?.history ?? []) {
		if (!h.bakeStartTime || !h.bakeEndTime) continue;
		const a = new Date(h.bakeStartTime).getTime();
		const b = new Date(h.bakeEndTime).getTime();
		if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
		spans.push(b - a);
	}
	if (spans.length < 2) return null;
	return median(spans);
}

const NOTHING: Pick<
	PrCell,
	| 'since'
	| 'bakeLeftMs'
	| 'superseded'
	| 'gateHint'
	| 'gateLabel'
	| 'gateSubject'
	| 'gateSubjectKind'
	| 'gatePending'
	| 'gateContract'
	| 'gateRequiredVersion'
	| 'providerHasNoBuild'
> = {
	since: null,
	bakeLeftMs: null,
	superseded: false,
	gateHint: null,
	gateLabel: null,
	gateSubject: null,
	gateSubjectKind: null,
	gatePending: false,
	gateContract: null,
	gateRequiredVersion: null,
	providerHasNoBuild: false
};

function buildCell(
	rollout: Rollout,
	envName: string,
	cluster: string,
	theme: EnvironmentTheme | null,
	set: Set<string>,
	meta: PrPipelineMeta,
	gateCtx: GateContext,
	now: Date,
	containmentKnown: boolean
): PrCell {
	const status = rollout.status ?? {};
	const history = status.history ?? [];
	const head = history[0];
	const headRevision = head?.version?.revision ?? null;
	const ns = rollout.metadata?.namespace ?? '';
	const name = rollout.metadata?.name ?? '';
	const envRank = getEnvironmentRank(envName);
	const usuallyMs = cellUsuallyMs(rollout);

	// ⭐ ROUND 2, R2.3 — `historyMatches`, computed ONCE per cell (not per
	// branch below): every `status.history` entry this SAME `set` (rules
	// 1/2's own containment membership) says carries the change, newest
	// first (the array's own order), paired with `history-marks.ts`'s own
	// index-aligned `deployActs` so a match already knows whether it was a
	// rollback/forward/redeploy without a second pass over the array.
	const acts = deployActs(rollout);
	const historyMatches: PrHistoryMatch[] = history.reduce<PrHistoryMatch[]>((out, h, i) => {
		const rev = h.version?.revision;
		if (rev && set.has(rev)) {
			out.push({
				revision: rev,
				displayVersion: getDisplayVersion(h.version),
				timestamp: h.timestamp,
				bakeStatus: h.bakeStatus ?? 'None',
				triggeredBy: h.triggeredBy ?? null,
				act: acts[i] ?? null
			});
		}
		return out;
	}, []);

	const cell = (
		partial: Omit<
			PrCell,
			| 'cluster'
			| 'envName'
			| 'envRank'
			| 'usuallyMs'
			| 'namespace'
			| 'rolloutName'
			| 'theme'
			| 'containmentKnown'
			| 'historyMatches'
			| 'historyAtLimit'
			| 'versionHistoryLimit'
		>
	): PrCell => ({
		cluster,
		envName,
		envRank,
		usuallyMs,
		namespace: ns,
		rolloutName: name,
		theme,
		containmentKnown,
		historyMatches,
		historyAtLimit: historyAtLimit(rollout),
		versionHistoryLimit: rollout.spec?.versionHistoryLimit ?? 10,
		...partial
	});

	// ⭐ RULING 1. A cell this ambiguous still gets returned honestly — never
	// a confident-but-unverifiable "promoting"/"waiting" — see the two call
	// sites below.
	const notBuiltUnverified = (): PrCell =>
		cell({
			...NOTHING,
			state: 'not-built',
			reason: 'not built (unverified)',
			releaseLabel: '',
			revision: null
		});

	// ── RULE 1: the currently-running build IS the PR's ────────────────────
	if (headRevision && set.has(headRevision)) {
		const bakeStatus = head?.bakeStatus ?? 'None';
		const releaseLabel = getDisplayVersion(head!.version);

		if (bakeStatus === 'Deploying') {
			return cell({
				...NOTHING,
				state: 'deploying',
				reason: 'deploying now',
				since: head?.timestamp ?? null,
				bakeLeftMs: deadlineLeftMs(head?.timestamp, rollout.spec?.deployTimeout, now),
				releaseLabel,
				revision: headRevision
			});
		}
		if (bakeStatus === 'InProgress') {
			return cell({
				...NOTHING,
				state: 'baking',
				reason: rollout.spec?.bakeTime ? 'baking' : 'baking, no timer',
				since: head?.bakeStartTime ?? head?.timestamp ?? null,
				bakeLeftMs: deadlineLeftMs(head?.bakeStartTime, rollout.spec?.bakeTime, now),
				releaseLabel,
				revision: headRevision
			});
		}
		if (bakeStatus === 'BakeTimeRetrying') {
			return cell({
				...NOTHING,
				state: 'retrying',
				reason: head?.bakeStatusMessage || 'retrying the bake',
				since: head?.bakeStartTime ?? head?.timestamp ?? null,
				bakeLeftMs: deadlineLeftMs(head?.bakeStartTime, rollout.spec?.bakeTime, now),
				releaseLabel,
				revision: headRevision
			});
		}
		if (bakeStatus === 'Failed') {
			return cell({
				...NOTHING,
				state: 'failed',
				reason: head?.bakeStatusMessage || 'the bake failed',
				since: head?.bakeEndTime ?? head?.timestamp ?? null,
				releaseLabel,
				revision: headRevision
			});
		}
		if (bakeStatus === 'Cancelled') {
			// ⛔ NEITHER LIVE NOR ROLLED BACK. The head still contains the PR —
			// the deploy that would have superseded it never finished baking.
			return cell({
				...NOTHING,
				state: 'cancelled',
				reason: head?.bakeStatusMessage || 'the bake was cancelled',
				since: head?.bakeEndTime ?? head?.timestamp ?? null,
				releaseLabel,
				revision: headRevision
			});
		}

		// Succeeded, or no bake status at all (`None`) — live.
		const oldestTs = history.length ? history[history.length - 1]?.timestamp : null;
		let since: string | null = head?.bakeEndTime ?? head?.timestamp ?? null;
		let reason = 'live';
		if (meta.mergedAt && oldestTs) {
			const mergedMs = new Date(meta.mergedAt).getTime();
			const oldestMs = new Date(oldestTs).getTime();
			// ⭐ THE PR PREDATES WHAT THIS ROLLOUT EVEN REMEMBERS. `since` would
			// otherwise be THIS head entry's own timestamp — which is a claim
			// about when THIS deploy happened, not about when the PR first
			// went live, and those can be very different events once the
			// retained history window has rolled past the one that matters.
			if (Number.isFinite(mergedMs) && Number.isFinite(oldestMs) && mergedMs < oldestMs) {
				since = null;
				reason = 'live (since before recorded history)';
			}
		}
		const superseded = meta.mergeCommitSha != null && headRevision !== meta.mergeCommitSha;
		return cell({ ...NOTHING, state: 'live', reason, since, superseded, releaseLabel, revision: headRevision });
	}

	// ── RULE 2: rolled back — an OLDER history entry has it, HEAD does not ──
	const rolledBackEntry = history.find((h, i) => {
		if (i === 0) return false;
		const rev = h.version?.revision;
		return !!rev && set.has(rev);
	});
	if (rolledBackEntry) {
		const releaseLabel = head?.version ? getDisplayVersion(head.version) : '';
		return cell({
			...NOTHING,
			state: 'rolled-back',
			reason: head?.message?.trim() || `rolled back to ${releaseLabel}`,
			since: head?.timestamp ?? null,
			releaseLabel,
			revision: headRevision
		});
	}

	// ── RULE 3/4: search `availableReleases` for a build carrying the PR ────
	const found = findContainingRelease(status.availableReleases ?? [], set, meta);

	if (found && found.state === 'contained') {
		const candidate = found.release;
		const candidateKey = candidate.tag ?? candidate.version ?? candidate.revision ?? '';
		const releaseLabel = getDisplayVersion(candidate);

		// PINNED — outranks every gate, same as `blockingStory`'s own rule.
		const wanted = rollout.spec?.wantedVersion;
		if (wanted) {
			const wantedRevision = revisionForTag(rollout, wanted);
			if (!wantedRevision || !set.has(wantedRevision)) {
				return cell({
					...NOTHING,
					state: 'pinned',
					reason: `pinned to ${displayVersionForTag(rollout, wanted)}`,
					releaseLabel,
					revision: candidate.revision ?? null
				});
			}
		}

		// The requires-metadata this candidate would be gated on could not be
		// read at all — say so, rather than a false "nothing is blocking it".
		// ⭐ ITEM 9 (2026-09-10 fix pass): this is a failure to VERIFY this
		// release's own upstream contracts, not a rule actively refusing it
		// — `waiting-upstream`, never `gated`.
		if (releaseMetadataUnresolved(candidate)) {
			return cell({
				...NOTHING,
				state: 'waiting-upstream',
				reason: 'manifest unreadable',
				releaseLabel,
				revision: candidate.revision ?? null
			});
		}

		const gates = status.gates ?? [];
		const blocking = gates.filter((g) => !gateAllows(g, candidateKey));
		if (blocking.length > 0) {
			const classified = blocking.map((g) => classifyGate(g, ns, gateCtx));
			// ⭐ COORDINATOR FIX (fourth operator walk, item A, 2026-09-10). A
			// bare PROMOTION-ORDER gate (`clears === 'upstream'`, `subjectKind
			// === 'environment'` — "this environment's own turn hasn't come up
			// yet") is the WEAKEST reason a candidate can be blocked: it clears
			// on its own the moment the upstream environment deploys, and
			// nothing else is refusing the build. The OLD code picked ANY gate
			// with `clears === 'upstream'` first, so a promotion gate and, say,
			// a manual-approval gate with an empty allow-list sitting in the
			// SAME `blocking` list both matched `clears === 'upstream'`-or-not
			// inconsistently — actually only the promotion gate matched at all,
			// which meant the approval gate (the REAL, durable blocker) was
			// silently discarded the instant a promotion gate also happened to
			// be present. A live fleet's prod row had exactly this shape: a
			// promotion gate ("wait for staging") beside `hello-world-manual-
			// approval` (`allowedVersions: []`), and the row printed "queued …
			// usually 1 min once it starts" over a build that was never going
			// to move on a promotion tick.
			//
			// `dependencyGate` below folds in the owner-based `RolloutDependency`
			// fallback too (`clears === 'upstream'` with no `subjectKind` set,
			// see `blocking-story.ts`'s owner branch) — anything upstream that
			// is NOT a bare environment-subject promotion wait is still ranked
			// above every non-upstream gate, unchanged from before this fix.
			const promotionGate = classified.find((c) => c.clears === 'upstream' && c.subjectKind === 'environment');
			const dependencyGate = classified.find((c) => c.clears === 'upstream' && c !== promotionGate);
			const otherGate = classified.find((c) => c !== promotionGate && c !== dependencyGate);
			// `upstream` keeps its OLD meaning (a `waiting-upstream`-shaped
			// dependency) for the two fields ONLY a dependency gate populates
			// (`gateContract`/`gateRequiredVersion`, FIX PASS ITEM 5). `anyUpstream`
			// covers BOTH upstream shapes (dependency OR bare promotion order) for
			// `gateSubject`/`gateSubjectKind`/`gateLabel` — unchanged from before
			// this fix for a promotion-only cell (still `queued`, still names its
			// upstream environment as `gateSubject`).
			const upstream = dependencyGate;
			const anyUpstream = dependencyGate ?? promotionGate;
			// Precedence: a dependency wins outright (unchanged); anything ELSE
			// actively refusing the candidate (approval, a closed schedule, an
			// unresolved check) outranks a bare promotion-order wait; `queued`
			// is reported only when the promotion gate is the ONE gate in
			// `blocking` — "queued only when the only thing between the
			// candidate and the environment is the promotion order."
			const pick = dependencyGate ?? otherGate ?? promotionGate ?? classified[0];
			// ⭐ ITEM 3 (2026-09-10 fix pass) — THE `schedule-gate-fk44d` BUG.
			// This module never supplies `rolloutGates` to `buildGateContext`
			// (only the single-rollout endpoint serves them, fetched lazily
			// per row on "why"), so `classifyGate`'s `approval`/`unknown`
			// fallback here has NO owner evidence — it is a guess this VM
			// cannot back up. Live example: a closed schedule gate named
			// `schedule-gate-fk44d` has no promotion/dependency join, no
			// owner evidence, so it fell to `approval` and printed its own
			// raw Kubernetes id as the "rule name". `promotion`/`dependency`
			// ARE real evidence (matched directly off Environment/
			// RolloutDependency, which this module DOES supply) and stay
			// trustworthy; `pending` (the schedule/check branch's own
			// honesty flag, set because `/schedules` was never asked here)
			// is the other case `classifyGate` already tells us not to
			// trust. Both get identical treatment: no label, no printed id.
			const unresolvedKind = !upstream && (pick.kind === 'approval' || pick.kind === 'unknown');
			const pending = !!pick.pending || unresolvedKind;
			// ⭐ RULING 1 (2026-09-10 fix pass, "SUPERSEDED IS LIVE"). A
			// `waiting-upstream` claim names a SPECIFIC upstream blocking a
			// SPECIFIC candidate — this VM cannot stand behind that when it
			// does not actually know whether the head has already moved past
			// this exact-match candidate via ancestry it cannot see. `gated`
			// is untouched: it names no upstream, only "some rule currently
			// disallows this build", which stays true regardless.
			if (!otherGate && (dependencyGate || promotionGate) && !containmentKnown) {
				return notBuiltUnverified();
			}
			// ⭐ FIX PASS ITEM 4 / ITEM A (2026-09-10 coordinator fix). `queued`
			// is reported ONLY when a bare promotion-order wait is the one and
			// only thing in `blocking` (`otherGate` and `dependencyGate` both
			// absent) — the normal "waiting for dev to deploy it first" case,
			// nobody refusing anything. Any other gate present, of any kind,
			// reads `gated` first; a `'service'`-subject dependency still
			// outranks everything, amber `waiting-upstream`. See `PrState`'s own
			// doc comment for why `queued`/`waiting-upstream` were split.
			const upstreamState: PrState = dependencyGate ? 'waiting-upstream' : otherGate ? 'gated' : 'queued';
			return cell({
				...NOTHING,
				state: upstreamState,
				reason: pending ? '' : pick.short,
				releaseLabel,
				revision: candidate.revision ?? null,
				gateHint: { cluster, namespace: ns, rolloutName: name, gateName: pick.id },
				gateLabel: anyUpstream || pending ? null : pick.label,
				gateSubject: anyUpstream ? (pick.subject ?? null) : null,
				gateSubjectKind: anyUpstream ? (pick.subjectKind ?? null) : null,
				gatePending: pending,
				// ⭐ FIX PASS ITEM 5. Only a `'service'`-subject dependency gate
				// (`waiting-upstream`) ever carries these — `classifyGate`'s
				// promotion branch never sets `contract`/`need` (its own
				// `NOTHING_TO_DRAW` spread leaves them `null`), so this is a
				// no-op for `queued`/`gated` even without the extra check.
				gateContract: upstream ? (pick.contract ?? null) : null,
				gateRequiredVersion: upstream ? (pick.need ?? null) : null
			});
		}

		// ⭐ ITEM 6 (2026-09-10 fix pass). Nothing is blocking this candidate
		// — every current gate allows it — and the rollout controller
		// simply has not reconciled the promotion yet. This is NOT a held
		// state (no rule is refusing it), so it is its own state, never
		// `gated`: "ready, not promoted yet" printed beside the HELD chip
		// was a contradiction (`lib/CLAUDE.md`'s finding). No HELD chip on
		// `promoting` (`PipelineRow.svelte`'s `HELD_STATES` excludes it).
		// ⭐ RULING 1: "promoting shortly" is the loudest unverifiable claim of
		// all — it says nothing at all is in the way — so it is the first one
		// refused when containment is unknown.
		if (!containmentKnown) {
			return notBuiltUnverified();
		}
		return cell({
			...NOTHING,
			state: 'promoting',
			reason: 'waiting for the next reconcile',
			releaseLabel,
			revision: candidate.revision ?? null
		});
	}

	// ── RULE 4: not built here at all ───────────────────────────────────────
	return cell({
		...NOTHING,
		state: 'not-built',
		reason: found?.state === 'unverified' ? 'not built (unverified)' : 'not built here yet',
		releaseLabel: '',
		revision: null
	});
}

/**
 * ⭐ ROUND 3 (2026-09-10 ruling A, "NO RELEASE MEANS NOT AFFECTED"; REFINED
 * the same day after the third operator walk). A service is AFFECTED by a
 * change only when CI actually built THAT service from the change's OWN
 * commit — an EXACT match against `meta.mergeCommitSha`, anywhere in
 * `history` or `availableReleases`. This is the per-service ELIGIBILITY test
 * `buildPrPipeline` runs BEFORE building cells — a service with no such
 * release anywhere does not exist for this change at all (dropped into
 * `unaffectedServices`), even when a LATER release of it happens to be a
 * descendant that contains this commit.
 *
 * ⚠️ DELIBERATELY NOT `set`/`containedIn` (descendant containment) — that is
 * `buildCell`'s own job, for an ALREADY-AFFECTED service, to decide whether
 * an environment's head or a candidate carries the change (live via a
 * newer build, held by a newer build, …). Using descendant containment HERE
 * too was the bug the third walk found: `hello-frontend-app`'s one held
 * release is a descendant of nearly every older merged commit on its repo,
 * so every one of those OLDER changes read "held in dev on hello-api-app" —
 * a hold that has nothing to do with that specific change. "Assume CI
 * didn't release it for a reason" applies exactly as much to a coincidental
 * ancestor match as to no match at all: only the commit's OWN build counts.
 */
function hasBuildEvidence(rollout: Rollout, meta: PrPipelineMeta): boolean {
	if (!meta.mergeCommitSha) return false;
	const status = rollout.status ?? {};
	const history = status.history ?? [];
	if (history.some((h) => h.version?.revision === meta.mergeCommitSha)) return true;
	for (const r of status.availableReleases ?? []) {
		if (r.revision === meta.mergeCommitSha) return true;
	}
	return false;
}

/**
 * ⭐ ROUND 3 (2026-09-10 ruling A). For a service `buildPrPipeline` has
 * already decided IS included (`hasBuildEvidence` said yes, somewhere), rule
 * 4's genuine "nothing at all carries the change in THIS env" catch-all
 * (`reason === 'not built here yet'`) must not surface the retired
 * `not-built` reading — the SERVICE has a release, this one environment's
 * rollout just has not been offered a candidate yet. Recast `queued`, the
 * same neutral "not this cell's turn" state a normal promotion-order wait
 * already uses, with a reason naming the actual fact.
 *
 * ⚠️ Deliberately NARROW — matches the literal rule-4 string only. A cell
 * reading `'not built (unverified)'` is `notBuiltUnverified()` (ruling 1's
 * own honesty guard for a candidate this VM cannot yet PROVE carries the
 * change) and is left exactly as `not-built`: recasting an unverifiable
 * claim as `queued` would assert MORE than this VM actually knows, the
 * opposite of what ruling 1 exists to prevent. `pr-cell-copy.ts`'s
 * `cellStateSentence` speaks that one surviving case as "release status
 * unknown", never "not built".
 */
function remapForIncludedService(cell: PrCell): PrCell {
	if (cell.state !== 'not-built' || cell.reason !== 'not built here yet') return cell;
	return { ...cell, state: 'queued', reason: `not offered to ${cell.envName} yet` };
}

function isProdEnv(envName: string): boolean {
	return getEnvironmentRank(envName) >= 7;
}

function leadDeploysFor(rollout: Rollout): LeadDeploy[] {
	const out: LeadDeploy[] = [];
	for (const h of rollout.status?.history ?? []) {
		const v = h.version ? getDisplayVersion(h.version) : '';
		if (!v || !h.timestamp) continue;
		const ms = new Date(h.timestamp).getTime();
		if (Number.isFinite(ms)) {
			out.push({ version: v, ms, inFlight: h.bakeStatus === 'InProgress' || h.bakeStatus === 'Deploying' });
		}
	}
	return out;
}

/** Same predicate `/apps` uses (`apps/+page.svelte:832`), applied per app. */
function buildLeadEnvs(cells: AppCell[]): LeadEnv[] {
	const byEnv = new Map<string, AppCell[]>();
	for (const c of cells) {
		const list = byEnv.get(c.envName) ?? [];
		list.push(c);
		byEnv.set(c.envName, list);
	}
	const envs: LeadEnv[] = [];
	for (const [envName, group] of byEnv) {
		envs.push({
			label: envName,
			order: getEnvironmentRank(envName),
			prod: isProdEnv(envName),
			deploys: group.flatMap((c) => leadDeploysFor(c.rollout))
		});
	}
	return envs;
}

const STATE_VERB: Record<PrState, string> = {
	'not-built': 'not built',
	gated: 'held',
	pinned: 'pinned',
	'waiting-upstream': 'waiting',
	queued: 'queued',
	promoting: 'promoting',
	deploying: 'deploying',
	baking: 'baking',
	retrying: 'retrying',
	failed: 'failed',
	cancelled: 'cancelled',
	'rolled-back': 'rolled back',
	live: 'live'
};

function furthestSentence(cells: PrCell[]): string {
	if (cells.length === 0) return 'no environments';
	return [...cells]
		.sort((a, b) => a.envRank - b.envRank || a.cluster.localeCompare(b.cluster))
		.map((c) => `${STATE_VERB[c.state]} in ${c.envName}`)
		.join(' · ');
}

/** Same set `PipelineRow.svelte`'s `HELD_STATES` draws the HELD chip for. */
const HELD_LIKE_STATES = new Set<PrState>(['gated', 'waiting-upstream', 'pinned']);
const ACTIVE_STATES = new Set<PrState>(['deploying', 'baking', 'retrying']);

/**
 * ⭐ ITEM 11 (2026-09-10 fix pass), ⭐ RULING 7 (CHANGES-2026-09-10 fix pass,
 * "Mobile header rollup"). `furthestSentence`'s own vocabulary as a clause
 * LIST has no upper bound on length — one clause per environment, and a
 * five-environment service (`hello-world-manifests`, three mismatched-tier
 * envs) measured 535px in a 341px card at 390, clipping mid-word under
 * `whitespace-nowrap`. This is the FOLDED form `Card`'s `verdictCompact`
 * shows instead below 560px, in the same precedence the page's own verdict
 * already uses (live > held > not-built > active), never a second clause
 * list. The held reading names the FAMILY WORDS of the held environments
 * (`held in dev · stg`), never a bare count — a count answers "how many"
 * when the reader's question is "where", the same defect §2a's marks exist
 * to fix.
 */
function compactFurthestSentence(cells: PrCell[]): string {
	const total = cells.length;
	if (total === 0) return 'no environments';
	const live = cells.filter((c) => c.state === 'live').length;
	if (live > 0) return `${live} of ${total} live`;
	const held = cells.filter((c) => HELD_LIKE_STATES.has(c.state));
	if (held.length > 0) {
		const families = [...new Set(held.map((c) => envFamilyWord(c.envName).toLowerCase()))];
		return `held in ${families.join(' · ')}`;
	}
	const notBuilt = cells.filter((c) => c.state === 'not-built').length;
	// ⭐ COORDINATOR FIX (fourth operator walk, item 4, 2026-09-10). "not
	// built yet" is retired copy (⭐ ROUND 3 ruling A, "no release means not
	// affected") — this exact shape (every cell for a service is
	// `not-built`) is unreachable through the real pipeline today (such a
	// service is dropped as unaffected before it ever reaches a `PrService`,
	// see `hasBuildEvidence`), but a hand-built fixture can still call this
	// function directly, and it must not regress to the banned word if one
	// does. "no release" matches `standingWordsCompact`'s own word for the
	// identical fact (`changes.ts`).
	if (notBuilt === total) return 'no release';
	const active = cells.filter((c) => ACTIVE_STATES.has(c.state)).length;
	if (active > 0) return `${active} of ${total} active`;
	return `${total} in progress`;
}

/** The word `buildChangeVerdict` prints for a frontier cell's state — NOT
 *  `STATE_VERB` (which spells `waiting-upstream` as "waiting"): ruling 3's
 *  own examples spell a dependency wait "held in dev on hello-api-app",
 *  same word as a gate hold, because both are "something else has to move
 *  first" from the reader's point of view. */
const FRONTIER_VERB: Record<PrState, string> = {
	'not-built': 'not built',
	gated: 'held',
	pinned: 'pinned',
	'waiting-upstream': 'held',
	// ⭐ FIX PASS ITEM 4/5. `queued` is the NORMAL promotion-order wait — it
	// gets its own neutral word, never `held` (amber's one reserved
	// meaning, per `PrState`'s own doc comment).
	queued: 'queued',
	promoting: 'promoting',
	deploying: 'deploying',
	baking: 'baking',
	retrying: 'retrying',
	failed: 'failed',
	cancelled: 'cancelled',
	'rolled-back': 'rolled back',
	live: 'live'
};

function frontierTone(state: PrState): ChangeVerdictTone {
	switch (state) {
		case 'failed':
			return 'failed';
		case 'gated':
		case 'pinned':
		case 'waiting-upstream':
			return 'held';
		default:
			return 'active';
	}
}

/** The subject clause, when the frontier state names one — a `gated` cell
 *  names the RULE (`by <gateLabel>`) only once this VM can back the label up
 *  (`gateLabel` non-null, i.e. not `gatePending`); a `waiting-upstream` cell
 *  names the upstream SERVICE (`on <gateSubject>`) — the only subject kind
 *  it can carry now that `queued` (item 4) owns the environment-subject
 *  case, naming the environment it is waiting on in its own words ("waiting
 *  for dev to deploy it first", not "on dev" — the ordering phrase reads
 *  right on a normal wait where "on" would suggest an active block). Every
 *  other state — `pinned`, `deploying`, `baking`, `failed`… — carries no
 *  subject in the verdict, even though some (`pinned`) have a target of
 *  their own; the design doc's own examples show none. */
function frontierSubject(cell: PrCell): string | null {
	if (cell.state === 'gated') return cell.gateLabel ? `by ${cell.gateLabel}` : null;
	if (cell.state === 'waiting-upstream') return `on ${cell.gateSubject ?? 'its upstream'}`;
	if (cell.state === 'queued') return `waiting for ${cell.gateSubject ?? 'an earlier environment'} first`;
	return null;
}

function capitalize(word: string): string {
	return word ? `${word[0].toUpperCase()}${word.slice(1)}` : word;
}

/**
 * ⭐ RULING 3 (CHANGES-2026-09-10 fix pass, "ONE VERDICT, THE FRONTIER").
 * THE ONE VERDICT FUNCTION — the change page, the index row and the Home
 * card all read this (`changes.ts`'s own `changeVerdict` is a thin wrapper,
 * never its own computation). Supersedes the old "worst-progressed cell"
 * rule: the verdict now names the FRONTIER — the EARLIEST env-rank cell
 * (lowest rank, among cells whose service actually has a build) that is not
 * live — because a later-ranked cell is usually just waiting on the earlier
 * one anyway, and "held in dev" is more actionable than "held in prod" when
 * dev is where the actual block is.
 *
 * A service with NO build at all takes no part in this (`withBuild` filters
 * `not-built` out first, exactly as the superseded `buildVerdict` did) —
 * see `pr-pipeline.test.ts`'s "live everywhere among services WITH a build"
 * regression.
 *
 * ⭐ FIX PASS ITEM 5 (2026-09-10) — "SUBJECT FIRST". The word now names the
 * BLOCKED SERVICE ahead of the state — `<service> held in <env> on
 * <blocker>` / `<service> pinned in staging` — never a bare "held in dev on
 * hello-api-app" with no subject at all. Live bug this closes: Home's own
 * card read "held in dev on hello-api-app" for PR #4 with no indication
 * WHICH service was held (`hello-frontend-app`) — the one piece of
 * information a reader scanning several rows actually needs first. `live
 * everywhere` keeps no subject: it is a claim about the WHOLE fleet, and no
 * one service is "the" subject of it.
 */
export function buildChangeVerdict(services: PrService[]): { word: string; tone: ChangeVerdictTone } {
	const allCells = services.flatMap((s) => s.cells.map((cell) => ({ cell, appName: s.appName })));
	const withBuild = allCells.filter((x) => x.cell.state !== 'not-built');
	// ⭐ NO SUBJECT HERE, DELIBERATELY. Unlike a frontier CANDIDATE below
	// (one specific cell blocking one specific service), "nothing has built
	// this change anywhere yet" is a fact about the CHANGE, not about any
	// one of its services in particular — every service is equally
	// not-built, so naming one would imply it is somehow the one to watch.
	//
	// ⭐ ROUND 3 (2026-09-10 ruling A). "not built yet" is retired copy —
	// `buildPrPipeline`'s own eligibility filter means this branch is
	// unreachable through the real pipeline (an included service never has
	// an all-`not-built` cell set, bar the rare all-unverified shape); kept
	// here, worded the same as `noRelease`'s own verdict, for a caller that
	// hands this function a hand-built `PrService[]` directly.
	if (withBuild.length === 0) return { word: 'no release for this commit yet', tone: 'not-built' };
	if (withBuild.every((x) => x.cell.state === 'live')) return { word: 'live everywhere', tone: 'live' };

	const candidates = withBuild
		.filter((x) => x.cell.state !== 'live')
		.sort((a, b) => a.cell.envRank - b.cell.envRank || a.cell.cluster.localeCompare(b.cell.cluster));
	const frontier = candidates[0];
	const subject = frontierSubject(frontier.cell);
	const base = subject
		? `${frontier.appName} ${FRONTIER_VERB[frontier.cell.state]} in ${frontier.cell.envName} ${subject}`
		: `${frontier.appName} ${FRONTIER_VERB[frontier.cell.state]} in ${frontier.cell.envName}`;
	// ⭐ FIX PASS ITEM 5 — "THE HONEST WHEN". A dependency that has not built
	// this change AT ALL cannot resolve on its own no matter how long the
	// reader waits — `providerHasNoBuild` (`joinDependencyReasons`, ruling
	// 4) is the one place that fact is known. Naming the exact contract and
	// range is what makes this actionable rather than another "waiting"
	// sentence the reader has already seen twice.
	const needsClause =
		frontier.cell.providerHasNoBuild && frontier.cell.gateContract && frontier.cell.gateRequiredVersion
			? ` · will not move on its own — needs ${frontier.cell.gateSubject} ${frontier.cell.gateContract} ${frontier.cell.gateRequiredVersion}`
			: '';
	return { word: `${base}${needsClause}`, tone: frontierTone(frontier.cell.state) };
}

/**
 * ⭐ RULING 4 (CHANGES-2026-09-10 fix pass, "JOIN THE REASON"). A second pass
 * over already-built services: a `waiting-upstream` cell whose dependency
 * `subjectKind === 'service'` may be waiting on a service that is ITSELF one
 * of this same change's own services — in which case this VM can see
 * something the generic gate clause alone cannot: does the provider have a
 * build of THIS change anywhere, and has it reached the SAME env/cluster the
 * waiting cell is in? Runs after every service is built because it is the
 * only point every service's cells are all in hand at once. Mutates no cell
 * in place — returns fresh cell/service objects so nothing else that
 * captured a reference is surprised.
 *
 * ⭐ ROUND 3B (2026-09-10, coordinator correction) — RETIRED: "its build of
 * this change does not exist yet". Under ruling A ("no release means not
 * affected"), a provider with no release evidence for this exact commit is
 * not "missing a build of this change" — it needs a NEW, ordinary release of
 * its own contract, exactly like any other unsatisfied dependency. The
 * generic gate clause `buildCell` already computed (`pick.short`,
 * `blocking-story.ts`'s own dependency branch — "Waiting for hello-api-app
 * to ship api ^1.68.0 — it is on 1.67.0", naming the provider, the contract,
 * the required range and what it currently serves) is the true, actionable
 * sentence and is left untouched in both branches below. Only
 * `providerHasNoBuild` is still set — `buildChangeVerdict`'s own "will not
 * move on its own" tail is the one place that fact belongs, not a second,
 * invented reason on the cell.
 */
function joinDependencyReasons(
	services: readonly PrService[],
	unaffected: ReadonlySet<string>
): PrService[] {
	const byName = new Map(services.map((s) => [s.appName, s]));
	return services.map((svc) => ({
		...svc,
		cells: svc.cells.map((cell) => {
			if (cell.state !== 'waiting-upstream' || cell.gateSubjectKind !== 'service' || !cell.gateSubject) {
				return cell;
			}
			// ⭐ ROUND 3 (2026-09-10 ruling A). A provider dropped entirely for
			// having no release evidence at all (`buildPrPipeline`'s own
			// `unaffectedServices`) still needs `providerHasNoBuild` set — the
			// cell's own `reason` (the generic dependency clause) stays as-is.
			if (unaffected.has(cell.gateSubject)) {
				return { ...cell, providerHasNoBuild: true };
			}
			const provider = byName.get(cell.gateSubject);
			if (!provider) return cell;
			const providerHasAnyBuild = provider.cells.some((c) => c.state !== 'not-built');
			if (!providerHasAnyBuild) {
				// ⭐ FIX PASS ITEM 5. `providerHasNoBuild` is the honest "will not
				// move on its own" signal `buildChangeVerdict` reads to add its
				// own tail — this cell cannot resolve no matter how long the
				// reader waits, because the release it needs does not exist yet.
				return { ...cell, providerHasNoBuild: true };
			}
			const atSameSpot = provider.cells.find(
				(c) => c.envName === cell.envName && c.cluster === cell.cluster
			);
			if (!atSameSpot || atSameSpot.state !== 'live') {
				return { ...cell, reason: `waiting on ${cell.gateSubject} to reach ${cell.envName}` };
			}
			return cell;
		})
	}));
}

/** RULING 2's `builtElsewhere` — a second cross-service pass for the same
 *  reason `joinDependencyReasons` is one: needs every service's cells in
 *  hand, which only exists once the whole array is built. */
function withBuiltElsewhere(services: readonly PrService[]): PrService[] {
	return services.map((svc, i) => ({
		...svc,
		builtElsewhere: services.some(
			(other, j) => j !== i && other.cells.some((c) => c.state !== 'not-built')
		)
	}));
}

/**
 * THE ONE ENTRY POINT. Everything above is private machinery this function
 * assembles per app whose `status.source` names the PR's own repository.
 */
export function buildPrPipeline(
	meta: PrPipelineMeta,
	rollouts: Rollout[],
	environments: Environment[],
	rolloutDependencies: { items?: RolloutDependency[] } | null | undefined,
	now: Date = new Date()
): PrPipelineVM {
	const set = buildContainedSet(meta);
	const gateCtx = buildGateContext({
		environments: { items: environments },
		rolloutDependencies
	});
	// ⭐ RULING 1. See `PrPipelineMeta.containmentKnown`'s own doc — the
	// default reads an unpopulated bare-sha stub as UNKNOWN, never as
	// "verified empty".
	const containmentKnown = meta.containmentKnown ?? (meta.containedIn.length > 0 || meta.containedInAll);

	// The PR's own repo, normalised the SAME way every rollout's own
	// `status.source` is — so `https://github.com/o/r.git` and `o/r` agree.
	const expectedRepoKey = repoKeyFromSource(`github.com/${meta.owner}/${meta.repo}`, '');

	const groups = groupRolloutsByApp(rollouts, environments);
	let services: PrService[] = [];
	// ⭐ ROUND 3 (2026-09-10 ruling A, "NO RELEASE MEANS NOT AFFECTED"). Every
	// app whose `status.source` matches this PR's own repository, but which
	// carries no release evidence for THIS exact change anywhere — dropped
	// out of `services` entirely rather than rendered with an all-`not-built`
	// card. See `hasBuildEvidence`'s own doc for the exact test.
	const unaffectedServices: string[] = [];

	for (const group of groups.values()) {
		const matching = group.cells.filter((c) => c.repoKey === expectedRepoKey);
		if (matching.length === 0) continue;

		if (!matching.some((c) => hasBuildEvidence(c.rollout, meta))) {
			unaffectedServices.push(group.appName);
			continue;
		}

		const cells = matching
			.map((c) =>
				buildCell(c.rollout, c.envName, c.sourceCluster, c.theme, set, meta, gateCtx, now, containmentKnown)
			)
			.map(remapForIncludedService)
			.sort((a, b) => a.envRank - b.envRank || a.cluster.localeCompare(b.cluster));

		const leadVm = leadTime(buildLeadEnvs(matching));

		services.push({
			appName: group.appName,
			sourceRepo: repoLabel(matching[0].repoKey),
			cells,
			furthest: furthestSentence(cells),
			furthestCompact: compactFurthestSentence(cells),
			leadTimeMs: leadVm?.medianMs ?? null,
			builtElsewhere: false // placeholder — `withBuiltElsewhere` fills the real value below
		});
	}

	services = withBuiltElsewhere(joinDependencyReasons(services, new Set(unaffectedServices)));

	const allCells = services.flatMap((s) => s.cells);
	const rolloutsTotal = allCells.length;
	// ⭐ ROUND 3 — see `PrPipelineVM.rolloutsWithBuild`'s own doc: this is now
	// redundant with `rolloutsTotal` in every ordinary case, kept as its own
	// computation rather than aliased so the rare all-unverified shape still
	// reads honestly.
	const rolloutsWithBuild = allCells.filter((c) => c.state !== 'not-built').length;
	const rolloutsLive = allCells.filter((c) => c.state === 'live').length;

	// ⭐ ITEM 4 (2026-09-10 fix pass) / RULING 3 / ROUND 3 RULING A. Three
	// distinct facts, never conflated:
	//  - no app on this cluster sources this repository at all → "not built
	//    here" (unchanged from the original fix-pass wording — a DIFFERENT
	//    fact from "no release", and not banned copy).
	//  - the repository IS deployed here, but nothing anywhere carries this
	//    exact change → `noRelease`, "no release for this commit".
	//  - at least one included service exists → the ordinary frontier verdict.
	//
	// ⭐ ROUND 3B (2026-09-10) — "no release for this commit", not "…yet".
	// "Yet" promises a future build this dashboard has no way to back up
	// (`docs/changes.md`: "we cannot see a build that failed or was
	// skipped" — CI may simply never build this commit for any service, on
	// purpose). The change page pairs this with a muted line naming that
	// exact limitation instead.
	const matchedAnyRepo = services.length > 0 || unaffectedServices.length > 0;
	const noRelease = matchedAnyRepo && services.length === 0;
	let word: string;
	let tone: ChangeVerdictTone;
	let verdict: string;
	if (!matchedAnyRepo) {
		word = 'not built here';
		tone = 'not-built';
		verdict = 'No service on this cluster deploys this repository';
	} else if (noRelease) {
		word = 'no release for this commit';
		tone = 'not-built';
		verdict = capitalize(word);
	} else {
		({ word, tone } = buildChangeVerdict(services));
		verdict = capitalize(word);
	}

	return {
		services,
		verdict,
		verdictWord: word,
		verdictTone: tone,
		containmentKnown,
		rolloutsTotal,
		rolloutsWithBuild,
		rolloutsLive,
		unaffectedServices,
		noRelease
	};
}

// ── ROUND 2, R2.3 — `ChangeHistoryCard`'S OWN DATA ────────────────────────

/**
 * One `ChangeHistoryCard` row — a single `status.history` entry, ANY
 * service/environment, that carries this change (`PrCell.historyMatches`,
 * built off the SAME containment `set` rules 1/2 above already run).
 */
export type ChangeHistoryRow = {
	key: string;
	appName: string;
	envName: string;
	theme: EnvironmentTheme | null;
	/** The rollout page this deploy happened on. */
	href: string;
	displayVersion: string;
	shortRevision: string | null;
	bakeStatus: string;
	actorName: string | null;
	actorKind: 'User' | 'System' | null;
	timestamp: string;
	/** `history-marks.ts`'s own classification — carries the `rolled back`/
	 *  `forward`/`redeploy` word this card's rollback mark reads. */
	act: DeployAct;
};

/**
 * Flattens every service's every cell's `historyMatches` into one
 * newest-first feed — the change page's own "everywhere this build ever
 * ran" list, `ChangeHistoryCard`'s entire input. `localClusterName` is the
 * same hub-local fallback every other `rolloutPath()` call site in this
 * lane already applies to a cell's own empty `cluster`.
 */
export function buildChangeHistory(
	services: readonly PrService[],
	localClusterName: string
): ChangeHistoryRow[] {
	const rows: ChangeHistoryRow[] = [];
	for (const service of services) {
		for (const c of service.cells) {
			for (const match of c.historyMatches ?? []) {
				rows.push({
					key: `${c.cluster}/${c.namespace}/${c.rolloutName}/${match.timestamp}/${match.revision ?? ''}`,
					appName: service.appName,
					envName: c.envName,
					theme: c.theme,
					href: rolloutPath(c.cluster || localClusterName, c.namespace, c.rolloutName),
					displayVersion: match.displayVersion,
					shortRevision: match.revision ? match.revision.slice(0, 7) : null,
					bakeStatus: match.bakeStatus,
					actorName: match.triggeredBy?.name ?? null,
					actorKind: match.triggeredBy?.kind ?? null,
					timestamp: match.timestamp,
					act: match.act
				});
			}
		}
	}
	rows.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
	return rows;
}

/**
 * The History tab's own retention caveat (`historyLimitNote`, the change
 * page's now-dead `+page.svelte` helper of the identical name it
 * supersedes) — restated here, word for word, rather than cross-imported:
 * this lane owns `pr-pipeline.ts`, not the rollout detail route the
 * original sentence lives in, and a second wording of the same caveat is
 * exactly the sprawl the product's vocabulary passes exist to cut. `null`
 * unless AT LEAST ONE matched cell's own rollout is at its retention limit.
 */
export function changeHistoryRetentionNote(services: readonly PrService[]): string | null {
	for (const service of services) {
		for (const c of service.cells) {
			if (c.historyAtLimit) {
				const limit = c.versionHistoryLimit ?? 10;
				return `History keeps the last ${limit} deploys per service; a build deployed earlier is not recorded.`;
			}
		}
	}
	return null;
}
