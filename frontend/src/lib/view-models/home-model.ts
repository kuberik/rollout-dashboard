/**
 * HOME ROUND 12 — THE ONE DATA MODEL, CONSOLIDATED (2026-10-18).
 *
 * Pure. Every round-12 mockup draws from `buildHomeModel`'s output (or the
 * pinned JSON snapshot `scripts/export-home-model.ts` writes from it), never
 * from the raw mock/API shapes directly — so a mockup can never reintroduce
 * a bug this module already fixed.
 *
 * This module is a COORDINATION point, not new logic: every fix below was
 * found and proven independently on a round-10/11 lab branch; this file
 * ports each one into one tested place instead of three divergent lab
 * copies.
 *
 *  1. JUST-MERGED CHANGES DROPPED. A `noRelease` `ChangeRowVM` (nothing has
 *     built yet) carries no `services` breakdown — `apps[].merged` reads
 *     `row.repo === app` directly off the row itself (never off
 *     `row.services`, which is `[]`), the same guard `design/home-r11-census`
 *     7283084a added after a `noRelease` row on one repo was silently
 *     folding into every OTHER repo's merged bucket.
 *  2. COMMIT-ID LENGTH MISMATCH. Fixed upstream of this module in
 *     `pr-pipeline.ts`'s `ShaSet` (sharedfix 13749e4d) — a 7-char short sha
 *     and a 40-char revision match by prefix. `rolledBackChangeRef` below
 *     reuses `ShaSet` rather than `===`, so this module can never regress it.
 *  3. AN ANCESTOR COMMIT REPEATED AS "LIVE" IN EVERY ENV. `PrCell.state`
 *     reads `'live'` for any commit CONTAINED IN whatever is actually
 *     running, so an old change can show live in five environments at once.
 *     `ledgerForApp`'s `seenByEnv` running cap (newest-merged-first, 2 slots
 *     per env: the current occupant + at most one dim predecessor) is
 *     `design/home-r11-census` 0341ec29/7b82df4f's fix, ported verbatim.
 *  4. QUEUED/PROMOTING SHOWN AS A FAKE "HELD". `queued`/`promoting` are the
 *     ordinary "hasn't reached this env's turn yet" wait, true of nearly
 *     every change in nearly every downstream env — `SKIP_STATES` drops
 *     them (never a chip), same as `census`/`islands`.
 *  5. #37 FAILED / #38 ROLLED BACK LIVING ONLY IN THE RAW-ENV OVERLAY,
 *     BLEEDING INTO ALL PROD REGIONS. `buildOverrides` computes the
 *     failed/rolled-back override PER (env, ref) — never folded to one
 *     `'prod'` key — from `rollout.status.history[0].failedHealthChecks`
 *     (a check failing now; `design/home-r11-islands`' `failingHealthCheck`)
 *     and `deployActs`'s own rollback act (`design/home-r11-islands`'
 *     `rolledBackRevisions`). `ledgerForApp` then exempts an override hit
 *     from the running cap, so it is NEVER dropped by fix 3's cap and NEVER
 *     applies to a region it didn't name.
 *  6. APPROVAL GATES DRAWN AS RULE HOLDS. `PrCell.gateApprovalGuess` (set by
 *     `pr-pipeline.ts` itself) distinguishes a gate held for a PERSON from
 *     an ordinary rule hold per cell, carried straight through to
 *     `EnvChangeState` as `'awaiting-approval'` vs `'held-by-rule'` — the
 *     same distinction `census/ledger.ts`'s `chipFor` draws. The app-level
 *     `AppEnv.state` draws the same line off `RolloutCard.heldCause`.
 *  7. CARRIED CHANGES VANISHING ("6 yours" INSTEAD OF 10). A change whose
 *     own build is CONTAINED IN a later build it didn't also land itself is
 *     never silently counted — it is either genuinely placed (its own
 *     SKIP/live/held cell, wherever that is) or capped out as a dim
 *     predecessor (fix 3), but every one of the viewer's `ChangeRowVM`s is
 *     visited by `ledgerForApp`'s outer loop once, so none is dropped from
 *     the model entirely; `buildHomeModel`'s own test pins the count.
 *  8. IDLE SHOWN AS A SIGNAL. `signals` filters `fleetSignals()`'s output to
 *     `HOME_PULSE_WORTH_LOOK` (`fleet-signals.ts`, sharedfix 13749e4d) —
 *     `'stall'` (idle) is deliberately excluded from that set.
 */
import type {
	Rollout,
	Environment,
	RolloutDependency,
	Kustomization,
	KruiseRollout
} from '../../types';
import type { Change } from '../api/changes';
import type { NetworkSchedules } from '../api/schedules';
import { healthChecksByRollout, type RolloutHealthChecks } from '../api/health-checks';
import { buildRolloutCards, type RolloutCard } from '../rollout-cards';
import { deployActs } from '../history-marks';
import { rolloutPath } from '../source-dashboard';
import { href as toHref } from '../paths';
import { changePath } from '../pr-ref';
import { getEnvironmentRank } from '../env-order';
import { derivePipeline, kruiseRolloutsForRollout, type StageState } from '../pipeline';
import { buildLanes, type Lane, type LaneNode, type Tier } from './promotion-lanes';
import { isHeld, isNeedsYou } from './fleet-groups';
import { fleetFacts, type FleetFacts, type PulseRange } from './fleet-facts';
import {
	fleetSignals,
	HOME_PULSE_WORTH_LOOK,
	type FleetSignal,
	type SignalFacts
} from './fleet-signals';
import { buildChangeRows, type ChangeRowVM } from './changes';
import { ShaSet, type PrCell, type PrState } from './pr-pipeline';
import { cardContext } from './card-context';
import { blockingStory, type GateContext, type ContractHolds } from './blocking-story';
import { prodTargets } from './home-status';
import type { CheckFailure } from './health-witness';
import { failureKind, formatTimeAgoCompact } from '../utils';
import * as msg from '$lib/paraglide/messages';
import { eventAge, historyEntrySince, type EventAgeKind } from './event-age';

// ── THE PER-ENVIRONMENT STATE WORD, ONE ENUM FOR BOTH THE APP'S CURRENT
//    STANDING AND ONE VIEWER CHANGE'S OWN POSITION THERE. ──────────────────
export type EnvState =
	| 'healthy'
	| 'superseded'
	| 'deploying'
	| 'checking'
	| 'held-by-rule'
	| 'awaiting-approval'
	| 'failed'
	| 'rolled-back'
	| 'not-deployed';

export type Signal = {
	key: string;
	kind: FleetSignal['kind'];
	app: string;
	env: string;
	/** `fleet-signals.ts`'s own `evidence` sentence — already composed, never re-worded here. */
	phrase: string;
	/** What `phrase` is worded from (`fleet-signals.ts`'s `SignalFacts`), so
	 *  Home words it through paraglide without parsing the sentence. */
	facts: SignalFacts | null;
	/** ISO instant the signal's own clock reads from (`<= now`). */
	since: string;
	ageMs: number;
	href: string;
};

export type NeedsYouEntry = {
	app: string;
	env: string;
	cause: 'approval' | 'order' | 'dependency' | 'other';
	phrase: string;
	/** What `phrase` says, as data (`holdPhrase(facts.reason) === phrase`).
	 *  `checks`: on a `'check'` hold, the not-passing checks' own names when
	 *  the rollout's gates carry them (`['integration-tests']`), else absent;
	 *  `phrase` stays the generic `waits on a check` either way.
	 *  `provider`: on a `'dependency'` hold, the one service its refusing
	 *  dependency gates wait on (`payments-svc`), read off the same gates
	 *  `EnvChange.waitsOn` is; absent when none or several. */
	facts: { reason: HoldReason; checks?: string[]; provider?: string; window?: { label: string; opensAt: string | null } };
	href: string;
};

/** Why a place is stopped or held, the vocabulary of `NeedsYouEntry.phrase`. */
export type HoldReason =
	| 'failed-healthcheck'
	| 'failed-deploy'
	| 'stuck'
	| 'approval'
	| 'dependency'
	| 'order'
	| 'clock'
	| 'check'
	| 'pinned'
	| 'rule';

export type FleetSummary = {
	apps: number;
	mappedApps: number;
	places: number;
	/** Prod regions NOT failed/stuck (`home-status.ts`'s own `prodTargets`
	 *  predicate — the same arithmetic Home's header prints) out of every
	 *  mapped prod region. Deliberately NOT "not held/deploying/checking" —
	 *  mid-bake or waiting on an approval is not a failure. */
	prodHealthy: { healthy: number; total: number };
	/** "+N since 24h ago" style delta on fleet deploy volume — `null` when
	 *  there isn't a full previous window to compare against yet
	 *  (`FleetFacts.hasPrev === false`). */
	sinceDelta: { deploys: number; deploysPrev: number | null } | null;
	needsYou: NeedsYouEntry[];
};

/** One of the viewer's own changes, positioned at exactly one place. */
export type EnvChange = {
	/** `#44` (a PR) or a short sha (a bare commit) — never both. */
	ref: string;
	title: string;
	href: string;
	mergedAt: string;
	/** ISO instant this change reached ITS state at THIS place, `<= now`. */
	since: string | null;
	state: EnvState;
	/** Set only on `'checking'`, minutes left in the bake, when known. */
	checkingMinutesLeft: number | null;
	/** ROUND 12 DATA R3 — "repo grouping". The change's own repo
	 *  (`ChangeRowVM.repo`) — the fixture used to have exactly one app per
	 *  repo, so nothing ever exercised grouping several apps' cards under
	 *  one repo card; a two-service repo (`billing-api`/`billing-worker` on
	 *  the stress fixture) now does. */
	repo: string;
	/** Every app/service THIS SAME change affects (`ChangeRowVM.services`'
	 *  own `appName`s, or just this app for a `noRelease` row with no
	 *  services breakdown yet) — always includes the app this `EnvChange`
	 *  itself is attached to. A caller folding by repo reads this to know
	 *  whether a change needs to render under more than one app. */
	apps: string[];
	/** Set only on `'rolled-back'`: the build running there NOW contains this
	 *  change (a later build carried it back in), so it is rolled back as an
	 *  event but live there again. Product-only (`home/parity.test.ts`). */
	liveAgain?: true;
	/** Set only on a held entry refused at this place by a dependency gate
	 *  (`waiting-upstream`): the provider that gate waits on, read off the
	 *  gate itself (`PrCell.gateSubject`, `payments-svc`). Product-only. */
	waitsOn?: string;
	/** Set with `waitsOn`: the refusing rollout's Gates tab, where that
	 *  dependency is drawn (`PrCell.gateHint`'s cluster/namespace/name).
	 *  Product-only. */
	waitsOnHref?: string;
};

/** What a place refusing a change's build knows about the hold: since when
 *  the change has waited there (its build's arrival one tier upstream),
 *  `null` when no upstream tier ever ran it. */
type HeldHere = { since: string | null };

/** ROUND 12 DATA R3 — the pipeline Home's own `ControlCenter.svelte` draws
 *  per app ("5/14 stages done · 4 rolling out", "deploying · step 1/3"),
 *  derived EXACTLY the way that component does: `derivePipeline`
 *  (`lib/pipeline.ts`) over the rollout's own linked KruiseRollouts
 *  (`kruiseRolloutsForRollout`), falling back to a single deploy/bake track
 *  when none are linked. Never recomputed independently — this is the same
 *  `PipelineSummary` that component derives, reshaped for this model. */
export type PipelineStageVM = { state: StageState };
export type PipelineTrackVM = {
	/** The KruiseRollout's own name, or `null` for the no-KruiseRollout
	 *  deploy/bake fallback track (which carries no real track identity). */
	name: string | null;
	stages: PipelineStageVM[];
};
export type EnvPipeline = {
	/** One track per linked KruiseRollout; multiple run in parallel. In the
	 *  fallback shape (`isFallback`) this is always exactly one track,
	 *  `[{ name: null, stages: [deployState] }]`. */
	tracks: PipelineTrackVM[];
	/** The trailing kuberik-level bake cell — only flips out of `'pending'`
	 *  once every track is done, same gating as the detail page. */
	bake: StageState;
	/** The position of whichever step is currently `'active'`, 1-based
	 *  (matching `ControlCenter.svelte`'s own `step ${idx + 1}/${total}`
	 *  phrasing) — the FIRST active step found across tracks, or `null`
	 *  when nothing is active (every stage done/pending, or a fallback
	 *  track with no canary steps to be "in" at all). */
	activeStep: { index: number; total: number } | null;
	/** `true` when no KruiseRollouts were linked and `tracks` is the
	 *  single-track deploy/bake fallback — the trigger/deploy/bake shape
	 *  `derivePipeline` produces for a rollout with no openkruise canary in
	 *  use (or data not yet propagated). */
	isFallback: boolean;
};

export type AppEnv = {
	env: string;
	/** Short label under a PROD eyebrow (`eu-west`), the raw name otherwise. */
	label: string;
	tier: Tier;
	isProdRegion: boolean;
	state: EnvState;
	version: string | null;
	/** ISO instant the CURRENT deploy there began, `<= now`, or `null`. */
	arrivedAt: string | null;
	/** On a held or awaiting-approval place: when the hold there began
	 *  (`eventAge(card, 'held')`, the instant the app's figure counts from when
	 *  this place leads), else `null`. Product-only (`home/parity.test.ts`). */
	heldSince: string | null;
	/** The viewer's own changes positioned at this exact place — see the
	 *  module doc's fix 3/4/5/7. Newest first. Never capped for a
	 *  `'failed'`/`'rolled-back'` entry. */
	myChanges: EnvChange[];
	/** ROUND 12 DATA R3 — this env's rollout pipeline, derived the same way
	 *  `ControlCenter.svelte` derives it. See `EnvPipeline`'s own doc. */
	pipeline: EnvPipeline;
	/** This place's own rollout page, from its card's real cluster, namespace
	 *  and name (`rolloutPath`), never guessed from naming conventions.
	 *  Product-only: the lab export predates it (`home/parity.test.ts`). */
	href: string;
};

export type AppModel = {
	app: string;
	tier: 'starred' | 'active' | 'quiet';
	figure: string | null;
	phrase: string | null;
	/** What `figure` and `phrase` are made of: the lead place's state and the
	 *  instant `figure` counts from (both null when there is no lead). */
	facts: { lead: EnvState | null; since: string | null };
	primaryAction: { label: string; href: string } | null;
	/** A second, lower-urgency action on the SAME app, at a different place
	 *  (e.g. invoice-api's own failing prod-eu-west is the lead, but
	 *  prod-us-east is separately waiting on an approval) — `null` when
	 *  there is nothing else to point at. */
	secondaryAction: { label: string; href: string } | null;
	/** Promotion order: stages first (dev → test → staging), then every
	 *  prod region as its own separate entry. */
	envs: AppEnv[];
	/** The viewer's own changes on this app, merged but with no build
	 *  anywhere yet (module doc fix 1). Newest first. */
	merged: EnvChange[];
	/** The app's own page (`/apps/<app>`, through `$lib/paths`). Product-only,
	 *  like `AppEnv.href`. */
	href: string;
};

export type HomeModel = {
	/** ISO instant every other field was computed against — pinned by the
	 *  caller, independent of any mock's own drifting clock. */
	now: string;
	fleet: FleetSummary;
	signals: Signal[];
	apps: AppModel[];
};

export type HomeModelInput = {
	changes: readonly Change[];
	rollouts: Rollout[];
	environments: Environment[];
	rolloutDependencies?: { items?: RolloutDependency[] } | null;
	/** ROUND 12 DATA R3 — feeds `AppEnv.pipeline`'s own `derivePipeline`
	 *  call, exactly the inputs `ControlCenter.svelte` passes it
	 *  (`kruiseRolloutsForRollout` walks `kustomizations` to resolve which
	 *  KruiseRollouts belong to a given app's rollout). Both default to
	 *  `[]` — a caller that doesn't fetch either still gets the
	 *  no-KruiseRollout deploy/bake fallback, same as before this field
	 *  existed. */
	kustomizations?: Kustomization[];
	kruiseRollouts?: KruiseRollout[];
	/** Lower-cased GitHub login — `Change.author` is compared case-insensitively. */
	me: string;
	now: Date;
	/** Apps to place in the `'starred'` tier even with none of the viewer's
	 *  own changes on them right now (the "yours/starred" half of tiering —
	 *  the other half, "has one of my changes", is derived). */
	starredApps?: ReadonlySet<string>;
	pulseRange?: PulseRange;
	/** hc-v2: the rollouts whose HealthChecks are KNOWN, from `GET /api/health-checks`
	 *  through `rolloutHealthChecks(res)` (`api/health-checks.ts`, which drops what
	 *  `partialReads` covers). Feeds `fleetSignals`' check-recovered / check-flapping.
	 *  A rollout with no group is unknown, never "no checks": it gets no check signal
	 *  either way, so no claim comes from absence. Absent or null: no check signals
	 *  (a backend without the endpoint). */
	healthChecks?: readonly RolloutHealthChecks[] | null;
	/** the fleet's schedule objects per cluster (`fetchNetworkSchedules`): joined into the gate context so a closed deploy window classifies as a clock (`Deploy window opens Mon 09:00`), not as a nameless gate or a failing check. Absent: no join (`schedulesExpected: false`). */
	schedulesByCluster?: Map<string, NetworkSchedules>;
};

const SKIP_STATES: readonly PrState[] = ['not-built', 'cancelled', 'queued', 'promoting'];
const HELD_STATES: readonly PrState[] = ['gated', 'pinned', 'waiting-upstream'];

function cardHref(c: RolloutCard): string {
	return rolloutPath(c.sourceCluster || 'local', c.ns, c.name);
}

function appHref(app: string): string {
	return toHref(`/apps/${encodeURIComponent(app)}`);
}

function fmtMinutesLeft(bakeLeftMs: number | null): number | null {
	if (bakeLeftMs == null || bakeLeftMs <= 0) return null;
	return Math.max(1, Math.round(bakeLeftMs / 60_000));
}

// ── FIX 5 (module doc): PER (env, ref) FAILED/ROLLED-BACK OVERRIDE ────────

type Override = 'failed' | 'rolled-back';

/** `rollout.status.history` read the way `deployActs` already reads it: the
 *  revision a `rollback` act REPLACED (the build that failed and was rolled
 *  back away from), not the revision now running. Ported from
 *  `design/home-r11-islands`' `rolledBackRevisions`. */
function rolledBackRevisions(rollout: Rollout | null | undefined): Set<string> {
	const history = rollout?.status?.history ?? [];
	const acts = deployActs(rollout);
	const out = new Set<string>();
	acts.forEach((act, i) => {
		if (act?.kind === 'rollback') {
			const rev = history[i + 1]?.version?.revision;
			if (rev) out.add(rev.toLowerCase());
		}
	});
	return out;
}

/** A health check failing RIGHT NOW on the head of this rollout's history —
 *  a fact `PrCell.state` cannot see (it only knows the bake landed), ported
 *  from `design/home-r11-islands`' `failingHealthCheck`. */
function headHealthCheckFailing(rollout: Rollout | null | undefined): string | null {
	const head = rollout?.status?.history?.[0];
	if (head?.failedHealthChecks && (head.failedHealthChecks as unknown[]).length) {
		return head.version?.revision ?? null;
	}
	return null;
}

// ── ROUND 12 FIX: THE HEALTH-WITNESS BLIND SPOT ──────────────────────────
//
// `RolloutCard.checkFailure` (`health-witness.ts`) is condition-based: it
// reads the controller's own `DeploymentBlocked`/`UnhealthyHealthChecks`
// condition. A fixture (or a controller race) that records a failing check
// on `status.history[0].failedHealthChecks` WITHOUT that condition — "the
// deploy succeeded; the check failed afterward" — is invisible to
// `appEnvState`/`nodeState`/`fleetSignals`, all of which read `checkFailure`
// alone. `headHealthCheckFailing` above already reads the raw history field
// for the per-change override; this backfills the SAME fact onto the card
// itself, once, so every downstream reader (env state, prod-healthy count,
// the `check-failing` signal) agrees with the per-change ledger instead of
// three of them calling it healthy and one calling it failed.
function withHealthWitness(cards: readonly RolloutCard[]): RolloutCard[] {
	return cards.map((c) => {
		if (c.checkFailure) return c;
		const head = c.rollout?.status?.history?.[0];
		const failed = (head?.failedHealthChecks ?? []) as { name?: string; message?: string }[];
		if (!failed.length) return c;
		const witness: CheckFailure = {
			check: failed[0]?.name ?? null,
			detail: failed[0]?.message ?? null,
			raw: head?.bakeStatusMessage || failed[0]?.message || 'health check failing',
			// When it began failing: the failed attempt's own end, falling back to
			// the deploy start only when the entry has none (`historyEntrySince`,
			// the rule `eventAge('failed')` and the failed `PrCell.since` read).
			// `head.timestamp` alone dated the failure from the deploy, so Needs
			// you and Your changes printed two ages for one failure.
			since: historyEntrySince(head)
		};
		return { ...c, checkFailure: witness };
	});
}

/** `app -> env -> ref -> override`, built once from the raw rollouts —
 *  never folded to a single `'prod'` key (module doc fix 5). */
function buildOverrides(
	cards: readonly RolloutCard[],
	rows: readonly ChangeRowVM[]
): Map<string, Map<string, Map<string, Override>>> {
	const byAppEnv = new Map<
		string,
		Map<string, { rolledBack: Set<string>; failingRev: string | null }>
	>();
	for (const c of cards) {
		if (!c.envName) continue;
		const envMap = byAppEnv.get(c.name) ?? new Map();
		envMap.set(c.envName, {
			rolledBack: rolledBackRevisions(c.rollout),
			failingRev: headHealthCheckFailing(c.rollout)
		});
		byAppEnv.set(c.name, envMap);
	}
	const out = new Map<string, Map<string, Map<string, Override>>>();
	for (const row of rows) {
		if (row.noRelease) continue;
		const ref = row.number != null ? `#${row.number}` : row.shortSha;
		const envMap = byAppEnv.get(row.repo);
		if (!envMap) continue;
		for (const [env, info] of envMap) {
			let ov: Override | null = null;
			if (info.failingRev && new ShaSet([info.failingRev]).has(row.sha)) ov = 'failed';
			else if ([...info.rolledBack].some((rev) => new ShaSet([rev]).has(row.sha)))
				ov = 'rolled-back';
			if (!ov) continue;
			const appOut = out.get(row.repo) ?? new Map<string, Map<string, Override>>();
			const envOut = appOut.get(env) ?? new Map<string, Override>();
			envOut.set(ref, ov);
			appOut.set(env, envOut);
			out.set(row.repo, appOut);
		}
	}
	return out;
}

// ── PER-CELL -> EnvChange, fix 3/4/5/6 ────────────────────────────────────

/**
 * ⚠️ `cell.superseded` (`pr-pipeline.ts`) is `meta.mergeCommitSha !==
 * headRevision` — a STRICT string compare, not `ShaSet`'s prefix match. On
 * this fixture the cell whose own build genuinely IS the current occupant
 * still read `superseded: true` (observed against the live mock:
 * invoice-api/staging, IA6 own cell). Trusting that flag mislabelled the
 * current occupant itself as a dim predecessor. `isFirstOccupant` (the
 * running cap's own position — this IS the first non-exempt entry seen for
 * this env, newest-merged-first) is what actually decides `'healthy'` vs
 * `'superseded'` below, the same way `design/home-r11-islands`' own
 * `ledgerRowsFor` decided it off its `liveSeen` counter rather than off this
 * same unreliable flag.
 */
function cellToEnvChange(
	cell: PrCell,
	ref: string,
	row: ChangeRowVM,
	override: Override | undefined,
	isFirstOccupant: boolean,
	hold?: HeldHere
): EnvChange | null {
	if (SKIP_STATES.includes(cell.state)) return null; // fix 4
	// ⭐ ROUND 12 FIX ("DUPLICATES"): `HELD_STATES` (gated/pinned/waiting-upstream)
	// is the CELL's own state, which this module's own doc already warns is an
	// upstream GUESS for any allow-list gate with no join (`gateApprovalGuess`'s
	// doc). The shared `held`/`held.ts` predicate (`PrCell.held`) is the
	// authoritative "refused HERE, not merely not-reached-yet" fact — a build
	// still queued behind an earlier env's own gate can read `gated` at every
	// later env it has never been offered to, which is exactly how one viewer
	// change (IA8/IA9 on the stress fixture) read `awaiting-approval` at
	// `prod-us-east` while it had only ever reached `test`/`dev`. `held ===
	// false` means "not reached yet" and is treated as the same ordinary wait
	// `SKIP_STATES` already drops — `held === undefined` (a hand-built fixture
	// that never set it) leaves the cell's own state standing, per that field's
	// own doc comment.
	if (HELD_STATES.includes(cell.state) && cell.held === false) return null;
	const base: Omit<EnvChange, 'state'> = {
		ref,
		title: row.title,
		href: row.href,
		mergedAt: row.mergedAt,
		since: cell.since,
		checkingMinutesLeft: null,
		repo: row.repo,
		// Every service this SAME change affects — not just the one `svc`
		// this cell came from (`ledgerForApp`'s own loop already matched
		// `svc` to the current app before calling this). A row is only ever
		// `noRelease` outside this function (handled separately, in
		// `ledgerForApp`'s own `merged` branch), so `row.services` is
		// populated whenever this function runs.
		apps: (row.services ?? []).map((s) => s.appName)
	};
	if (override === 'failed' || cell.state === 'failed') return { ...base, state: 'failed' };
	if (override === 'rolled-back' || cell.state === 'rolled-back')
		// the cell reads `live` when the running build contains the change
		return cell.state === 'live'
			? { ...base, state: 'rolled-back', liveAgain: true }
			: { ...base, state: 'rolled-back' };
	if (cell.state === 'deploying') return { ...base, state: 'deploying' };
	if (cell.state === 'baking')
		return { ...base, state: 'checking', checkingMinutesLeft: fmtMinutesLeft(cell.bakeLeftMs) };
	if (cell.state === 'retrying') return { ...base, state: 'checking' };
	if (HELD_STATES.includes(cell.state)) {
		// fix 6 — `approvalWait` is the shared held-predicate's own person/rule
		// split (`held.ts`), authoritative once a real `GateContext` is wired in
		// (round 12 fix, see `buildHomeModel`); `gateApprovalGuess` is this VM's
		// own pre-resolution guess and stays the fallback for a cell that never
		// got a `held` verdict at all.
		const approval = cell.approvalWait ?? cell.gateApprovalGuess;
		// ⭐ FIX4 (2026-10-25). A held cell carries no time of its own
		// (`pr-pipeline.ts` builds it from `NOTHING`, `since: null`), so the
		// change's wait is dated where the data dates it: its build's arrival
		// one tier upstream (`heldHere`). No upstream arrival, no age: the page
		// leaves it off rather than borrowing the app's figure.
		const held: EnvChange = {
			...base,
			since: cell.since ?? hold?.since ?? null,
			state: approval ? 'awaiting-approval' : 'held-by-rule'
		};
		// A dependency gate refusing THIS build names its provider
		// (`classifyGate`'s RolloutDependency join, the controller-written
		// `dependency-<name>` gate in `status.gates`).
		const dep =
			cell.state === 'waiting-upstream' && cell.gateSubjectKind === 'service'
				? cell.gateSubject
				: null;
		if (!dep) return held;
		const g = cell.gateHint;
		return g
			? {
					...held,
					waitsOn: dep,
					waitsOnHref: `${rolloutPath(g.cluster || 'local', g.namespace, g.rolloutName)}/gates`
				}
			: { ...held, waitsOn: dep };
	}
	if (cell.state === 'live') return { ...base, state: isFirstOccupant ? 'healthy' : 'superseded' };
	return null;
}

/**
 * One app's viewer-change ledger, env by env — fix 3/4/5/7's own home.
 * `rows` must be the viewer's own `ChangeRowVM`s for this app, any order;
 * sorted newest-merged-first internally so the running cap sees "current"
 * before "ancestor" and "frontier wait" before the queue behind it.
 */
function ledgerForApp(
	app: string,
	rows: readonly ChangeRowVM[],
	overrides: Map<string, Map<string, Override>> | undefined,
	holdAt?: (cell: PrCell, cells: readonly PrCell[]) => HeldHere | undefined
): { byEnv: Map<string, EnvChange[]>; merged: EnvChange[] } {
	const sorted = [...rows].sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt));
	const byEnv = new Map<string, EnvChange[]>();
	const merged: EnvChange[] = [];
	const seenByEnv = new Map<string, number>(); // fix 3's running cap (non-exempt entries only)
	// The "is this the current occupant" position, counted over every `live`
	// cell REGARDLESS of an override — an overridden entry (IA2, displayed
	// `'failed'`) still occupies the current-occupant slot operationally; the
	// next `live` cell behind it (IA1) is the dim predecessor, not a second
	// current occupant, even though the override exempted IA2 from the cap.
	const liveSeenByEnv = new Map<string, number>();
	const unfinished: { ref: string; env: string; rank: number; change: EnvChange }[] = [];
	for (const row of sorted) {
		if (row.noRelease) {
			// fix 1 — a noRelease row carries no `services`; `row.repo` alone
			// says which app it's for.
			if (row.repo === app) {
				const ref = row.number != null ? `#${row.number}` : row.shortSha;
				merged.push({
					ref,
					title: row.title,
					href: row.href,
					mergedAt: row.mergedAt,
					since: row.mergedAt,
					checkingMinutesLeft: null,
					state: 'not-deployed',
					repo: row.repo,
					apps: [app]
				});
			}
			continue;
		}
		const svc = (row.services ?? []).find((s) => s.appName === app);
		if (!svc) continue;
		const ref = row.number != null ? `#${row.number}` : row.shortSha;
		const changes = svc.cells.map((cell) => {
			const ov = overrides?.get(cell.envName)?.get(ref);
			let isFirstOccupant = false;
			if (cell.state === 'live') {
				const ln = liveSeenByEnv.get(cell.envName) ?? 0;
				isFirstOccupant = ln === 0;
				liveSeenByEnv.set(cell.envName, ln + 1);
			}
			const hold =
				HELD_STATES.includes(cell.state) && cell.held === true
					? holdAt?.(cell, svc.cells)
					: undefined;
			return cellToEnvChange(cell, ref, row, ov, isFirstOccupant, hold);
		});
		// HC-1: remember this change's furthest REACHED place (see the post-pass
		// below). A held-like entry is a wait, possibly only a queue position the
		// oldest-wins filter drops, so it is never the place a change reached.
		if (svc.cells.some((c) => c.state !== 'live')) {
			let reach = -1;
			changes.forEach((c, i) => {
				if (!c || c.state === 'awaiting-approval' || c.state === 'held-by-rule') return;
				if (reach < 0 || svc.cells[i].envRank >= svc.cells[reach].envRank) reach = i;
			});
			if (reach >= 0)
				unfinished.push({
					ref,
					env: svc.cells[reach].envName,
					rank: svc.cells[reach].envRank,
					change: changes[reach]!
				});
		}
		for (const [i, cell] of svc.cells.entries()) {
			const change = changes[i];
			if (!change) continue;
			const n = seenByEnv.get(cell.envName) ?? 0;
			const isHeldLike = change.state === 'awaiting-approval' || change.state === 'held-by-rule';
			if (change.state !== 'failed' && change.state !== 'rolled-back' && !isHeldLike) {
				// fix 3/5 — exempt failed/rolled-back; a held-like entry is
				// exempted too (round 12 fix) because the cap fills newest-
				// merged-first, which is exactly backwards for a held QUEUE —
				// see the oldest-wins post-filter below, which is what actually
				// narrows a held env down to one entry.
				if (n >= 2) continue;
				seenByEnv.set(cell.envName, n + 1);
			}
			const list = byEnv.get(cell.envName) ?? [];
			list.push(change);
			byEnv.set(cell.envName, list);
		}
	}
	// ⭐ ROUND 12 FIX ("DUPLICATES", second half). `pr-pipeline.ts`'s per-cell
	// `held`/`state` is computed off the ENV's own rollout — the SAME value
	// for every row at that env — so a gate refusing the frontier candidate
	// (IA5/#40 on the stress fixture) reads identically `gated`/`held: true`
	// on every OLDER-released row still queued behind it (IA6-9/#41-44),
	// none of which has even been offered to this env yet. The running cap
	// above (fix 3) could not catch this — it fills its 2 slots with the
	// NEWEST-merged rows first, which is exactly backwards for a held queue
	// (the newest queued build is never the one actually refused; the
	// OLDEST-merged held row is the true frontier, and every held row newer
	// than it is queued behind IT, not independently held). Keep only the
	// oldest-merged held/awaiting-approval entry per env; every other one is
	// the ordinary "hasn't reached its turn" wait `SKIP_STATES` already
	// drops for `queued`/`promoting`.
	for (const [env, list] of byEnv) {
		const held = list.filter((c) => c.state === 'awaiting-approval' || c.state === 'held-by-rule');
		if (held.length <= 1) continue;
		const frontier = held.reduce((a, b) =>
			Date.parse(a.mergedAt) <= Date.parse(b.mergedAt) ? a : b
		);
		byEnv.set(
			env,
			list.filter((c) =>
				c.state !== 'awaiting-approval' && c.state !== 'held-by-rule' ? true : c === frontier
			)
		);
	}
	// ⭐ HC-1 (2026-10-25). Fix 3's cap exists for an ANCESTOR: a change live
	// everywhere it is headed, repeated live in every env because every running
	// build contains it. It must never hide an UNFINISHED change (BRIEF r20 §A:
	// every unfinished change of yours is visible at rest). #41 on the incident
	// fixture was the third live entry at test and staging behind #43 and #42,
	// capped out of both, so it vanished from Home while prod still waited for
	// it. An unfinished change (a cell not live) the cap left with nothing at
	// or beyond its furthest REACHED env is placed there; the page reads
	// "what's next" from that place. A change already shown at or past it (#40
	// waiting for approval in prod, #42 dim in staging) is left alone. Only the
	// missing entry is added, so nothing else moves: exempting it from the cap
	// up front would free its slot and pull an ancestor back in.
	const shownAt = new Map<string, number>();
	for (const [env, list] of byEnv)
		for (const c of list)
			shownAt.set(c.ref, Math.max(shownAt.get(c.ref) ?? -Infinity, getEnvironmentRank(env)));
	for (const u of unfinished) {
		if ((shownAt.get(u.ref) ?? -Infinity) >= u.rank) continue;
		const list = byEnv.get(u.env) ?? [];
		list.push(u.change);
		byEnv.set(u.env, list);
	}
	return { byEnv, merged };
}

// ── APP-LEVEL CURRENT STATE (not a per-change fact — see module doc). ─────

function appEnvState(c: RolloutCard): EnvState {
	if (c.statusKey === 'failed' || c.checkFailure != null) return 'failed';
	// QA #7 (2026-11-09): "rolled back" is the QUIET place state (SEVERITY in
	// state-words.ts ranks it below held/checking/deploying). It used to sit
	// above them, so a rolled-back place that was waiting on an approval, or
	// deploying again, was listed "At rest — Rolled back" and left Waiting.
	// A pin-only hold keeps the rolled-back word (the rollback pins).
	if (c.rolledBack && c.bakeStatus !== 'Deploying' && c.bakeStatus !== 'InProgress' && !c.held)
		return 'rolled-back';
	if (isHeld(c)) return c.heldCause === 'person' ? 'awaiting-approval' : 'held-by-rule';
	if (c.bakeStatus === 'Deploying') return 'deploying';
	if (c.bakeStatus === 'InProgress' || c.stuck != null) return 'checking';
	if (!c.version || c.statusKey === 'pending' || c.bakeStatus === 'None') return 'not-deployed';
	return 'healthy'; // newest or behind — both are a running, unheld deploy
}

function laneEnvLabel(env: string, isProd: boolean): string {
	return isProd ? env.replace(/^prod-?/i, '') || env : env;
}

/** ROUND 12 DATA R3 — `ControlCenter.svelte`'s own `motionMessages`
 *  derivation (`kruiseRolloutsForRollout` + `derivePipeline`), reshaped
 *  into `EnvPipeline`. See that type's own doc comment. */
function buildEnvPipeline(
	card: RolloutCard,
	kustomizations: readonly Kustomization[],
	kruiseRollouts: readonly KruiseRollout[]
): EnvPipeline {
	const rollout = card.rollout;
	const krs = rollout
		? kruiseRolloutsForRollout(
				rollout,
				kustomizations as Kustomization[],
				kruiseRollouts as KruiseRollout[]
			)
		: [];
	const summary = rollout
		? derivePipeline(rollout, krs)
		: { tracks: [{ name: '', stages: ['pending' as StageState] }], bake: 'pending' as StageState };
	const tracks: PipelineTrackVM[] = summary.tracks.map((t) => ({
		name: t.name || null,
		stages: t.stages.map((s) => ({ state: s }))
	}));
	let activeStep: EnvPipeline['activeStep'] = null;
	for (const t of summary.tracks) {
		const idx = t.stages.indexOf('active');
		if (idx >= 0) {
			activeStep = { index: idx + 1, total: t.stages.length };
			break;
		}
	}
	return { tracks, bake: summary.bake, activeStep, isFallback: krs.length === 0 };
}

function buildAppEnvs(
	lane: Lane,
	ledger: { byEnv: Map<string, EnvChange[]> },
	kustomizations: readonly Kustomization[],
	kruiseRollouts: readonly KruiseRollout[]
): AppEnv[] {
	const nodesInOrder: { node: LaneNode; isProdRegion: boolean }[] = [
		...lane.stages.map((node) => ({ node, isProdRegion: false })),
		...lane.prod.map((node) => ({ node, isProdRegion: true }))
	];
	return nodesInOrder.map(({ node, isProdRegion }) => ({
		env: node.card.envName,
		label: laneEnvLabel(node.card.envName, isProdRegion),
		tier: node.tier,
		isProdRegion,
		state: appEnvState(node.card),
		version: node.card.version,
		arrivedAt: node.card.timestamp,
		heldSince: ageKindFor(appEnvState(node.card)) === 'held' ? eventAge(node.card, 'held') : null,
		myChanges: ledger.byEnv.get(node.card.envName) ?? [],
		pipeline: buildEnvPipeline(node.card, kustomizations, kruiseRollouts),
		href: cardHref(node.card)
	}));
}

function pulseWord(kind: FleetSignal['kind']): string {
	return kind;
}

function buildSignals(
	cards: readonly RolloutCard[],
	lanes: readonly Lane[],
	changes: readonly Change[],
	now: Date,
	healthChecks: readonly RolloutHealthChecks[] | null | undefined
): Signal[] {
	const prByShort = new Map<string, Change>();
	for (const c of changes) prByShort.set(c.mergeCommitSha.slice(0, 7).toLowerCase(), c);
	const raw = fleetSignals({
		cards,
		lanes,
		healthChecks: healthChecks ? healthChecksByRollout(healthChecks) : null,
		prFor: (sha7) => {
			const c = prByShort.get(sha7.toLowerCase());
			if (!c) return null;
			return {
				number: c.number != null ? String(c.number) : null,
				title: c.title,
				// the change page, addressed as the Changes list addresses it
				href:
					c.kind === 'pr' && c.number != null
						? changePath(c.owner, c.repo, { number: c.number })
						: changePath(c.owner, c.repo, { sha: c.mergeCommitSha }),
				author: c.author
			};
		},
		isApproval: (c) => c.heldCause === 'person',
		now,
		href: cardHref,
		appHref
	});
	// fix 8 — never idle: `HOME_PULSE_WORTH_LOOK` deliberately excludes 'stall'.
	// ⭐ ROUND 12 FIX. `HOME_PULSE_WORTH_LOOK` is the FLEET PULSE STRIP's own,
	// narrower set (that component's doc: a one-line-per-app scan); this
	// model's `signals` is the broader "actionable" list every round-12
	// mockup reads, and a genuine `failed` deploy/bake belongs in it — it was
	// simply never asked for by that one stricter consumer.
	const HOME_SIGNAL_KINDS = new Set<FleetSignal['kind']>([...HOME_PULSE_WORTH_LOOK, 'failed']);
	return raw
		.filter((s) => HOME_SIGNAL_KINDS.has(s.kind))
		.map((s) => ({
			key: s.key,
			kind: s.kind,
			app: s.app,
			env: s.env,
			phrase: s.evidence || pulseWord(s.kind),
			facts: s.facts ?? null,
			since: s.since,
			ageMs: Math.max(0, now.getTime() - Date.parse(s.since)),
			href: s.href
		}));
}

function causeFromHeldCause(cause: RolloutCard['heldCause']): NeedsYouEntry['cause'] {
	if (cause === 'person') return 'approval';
	if (cause === 'order') return 'order';
	if (cause === 'dependency') return 'dependency';
	return 'other';
}

/** Real verb phrases — round 12 fix ("needsYou phrases read 'a rule this
 *  dashboard cannot attribute' or 'a check'"). `causeLabelForGates`'s own
 *  noun phrases are correct vocabulary for a DIFFERENT job (naming the rule
 *  in a disclosure); `Needs you` is a verb clause about what THIS place is
 *  doing right now. */
function needsYouReason(c: RolloutCard): HoldReason {
	// A failing check is a health-check failure. A failed deploy is one when the
	// card says so, else when its bake message reads like one (`failureKind`,
	// `lib/utils.ts`, the decision behind `failurePhrase` everywhere else).
	if (c.checkFailure) return 'failed-healthcheck';
	if (c.statusKey === 'failed')
		return c.failureCategory === 'healthcheck' || failureKind(c.bakeStatusMessage) === 'healthcheck'
			? 'failed-healthcheck'
			: 'failed-deploy';
	if (c.stuck != null) return 'stuck';
	switch (c.heldCause) {
		case 'person':
			return 'approval';
		case 'dependency':
			return 'dependency';
		case 'order':
			return 'order';
		case 'clock':
			return 'clock';
		case 'check':
			return 'check';
		default:
			return c.pinnedVersion != null ? 'pinned' : 'rule';
	}
}

function needsYouFacts(c: RolloutCard, holdOf?: HoldNamer): NeedsYouEntry['facts'] {
	const reason = needsYouReason(c);
	if (reason === 'check') {
		const checks = holdOf?.(c).checks;
		return checks ? { reason, checks } : { reason };
	}
	if (reason === 'clock') {
		const window = holdOf?.(c).window;
		return window ? { reason, window } : { reason };
	}
	if (reason === 'dependency') {
		const provider = holdOf?.(c).provider;
		return provider ? { reason, provider } : { reason };
	}
	return { reason };
}

/** The verb clause for a `HoldReason` (`waits on a dependency`, `is pinned`), through paraglide. */
export function holdPhrase(r: HoldReason): string {
	switch (r) {
		case 'failed-healthcheck':
			return msg.home_m_evidence_failed_check();
		case 'failed-deploy':
			return msg.home_m_failed_to_deploy();
		case 'stuck':
			return msg.home_m_hold_stuck();
		case 'approval':
			return msg.home_m_hold_approval();
		case 'dependency':
			return msg.home_m_hold_dependency();
		case 'order':
			return msg.home_m_hold_order();
		case 'clock':
			return msg.home_m_hold_clock();
		case 'check':
			return msg.home_m_hold_check();
		case 'pinned':
			return msg.home_m_hold_pinned();
		case 'rule':
			return msg.home_m_waits_on_rule();
	}
}

/** Worst-first rank for picking ONE card per (app, cause) group — a real
 *  failure outranks any hold, and a person-held candidate outranks any
 *  other rule. */
function needsYouRank(c: RolloutCard): number {
	if (isNeedsYou(c)) return 0;
	if (c.heldCause === 'person') return 1;
	return 2;
}

/** The fold key's own "which cause" half — a real failure is always its own
 *  category, a hold's category is its gate cause. */
function needsYouCategory(c: RolloutCard): string {
	return isNeedsYou(c) ? 'failed' : (c.heldCause ?? 'other');
}

/**
 * ⭐ ROUND 12 FIX ("ONE ENTRY PER APP, NOT FOUR REGIONS" — AND NEVER TWO
 * DIFFERENT PROBLEMS FOLDED INTO ONE). The stress fixture's `checkout-api`
 * held across 4 regions on the SAME dependency printed 4 near-identical
 * rows — the repetition `CLAUDE.md`'s "ONE ROW PER CAUSE, NOT ONE PER
 * ENVIRONMENT" rule already named and fixed on `Needs you` once before.
 * `invoice-api` is the sharper case: a health check failing in
 * `prod-eu-west` AND an approval held in `prod-us-east` are TWO distinct
 * problems on one app, in two different places — folding those to one row
 * would be the opposite defect (hiding a real hold behind a louder
 * failure). The fold key is `(app, cause)`, not `app` alone, so same-cause
 * repeats collapse and distinct causes both survive.
 */
/** What a hold waits on, read off the same `blockingStory` the card's verdict
 *  came from: a `'check'` hold's not-passing check gates by name, and a
 *  `'dependency'` hold's provider when its refusing dependency gates name
 *  exactly one (`classifyGate`'s RolloutDependency join, `subjectKind:
 *  'service'`, the same subject `EnvChange.waitsOn` reads off `PrCell`). */
type HoldNamer = (c: RolloutCard) => { checks?: string[]; provider?: string; window?: { label: string; opensAt: string | null } };

function holdNamer(
	gateContext: GateContext,
	contractHoldsFor: (r: Rollout) => ContractHolds | undefined,
	now: Date
): HoldNamer {
	return (c) => {
		const story = blockingStory(c.rollout, gateContext, {
			contractHolds: contractHoldsFor(c.rollout),
			now
		});
		const checks = [...new Set(story.gates.filter((g) => g.clears === 'check').map((g) => g.id))];
		const providers = [
			...new Set(
				story.gates
					.filter((g) => g.kind === 'dependency' && g.subjectKind === 'service' && g.subject)
					.map((g) => g.subject as string)
			)
		];
		const win = story.gates.find((g) => g.clears === 'clock');
		return {
			...(win ? { window: { label: win.label ?? 'deploy window', opensAt: win.clearsAt } } : {}),
			...(checks.length ? { checks } : {}),
			...(providers.length === 1 ? { provider: providers[0] } : {})
		};
	};
}

function buildNeedsYou(cards: readonly RolloutCard[], holdOf?: HoldNamer): NeedsYouEntry[] {
	const byKey = new Map<string, RolloutCard>();
	for (const c of cards) {
		if (!c.envName) continue;
		if (!isNeedsYou(c) && !isHeld(c)) continue;
		const key = `${c.name}|${needsYouCategory(c)}`;
		const existing = byKey.get(key);
		if (!existing || needsYouRank(c) < needsYouRank(existing)) byKey.set(key, c);
	}
	return [...byKey.values()]
		.sort((a, b) => a.name.localeCompare(b.name) || needsYouRank(a) - needsYouRank(b))
		.map((c) => ({
			app: c.name,
			env: c.envName,
			cause: isNeedsYou(c) ? 'other' : causeFromHeldCause(c.heldCause),
			phrase: holdPhrase(needsYouReason(c)),
			facts: needsYouFacts(c, holdOf),
			href: cardHref(c)
		}));
}

function buildFleetSummary(
	cards: readonly RolloutCard[],
	facts: FleetFacts,
	holdOf?: HoldNamer
): FleetSummary {
	// ⭐ ROUND 12 FIX ("25/35 VS 35/35"). Home's own header reads this count as
	// "nothing actually broken" (`home-status.ts`'s `prodTargets`: healthy =
	// total minus failed/stuck), not "nothing held/deploying/checking" — a
	// prod region mid-bake or waiting on an approval is not a FAILURE, and
	// counting it as unhealthy here was the dashboard disagreeing with its own
	// header about the identical number. `prodTargets` is that exact
	// predicate, imported rather than re-derived, so the two can never drift
	// apart again.
	const isApproval = (c: RolloutCard) => c.heldCause === 'person';
	const pt = prodTargets(cards, isApproval);
	return {
		apps: facts.apps,
		mappedApps: facts.mappedApps,
		places: facts.places,
		prodHealthy: { healthy: pt.total - pt.failing, total: pt.total },
		sinceDelta: facts.hasPrev
			? { deploys: facts.deploys.value, deploysPrev: facts.deploys.prev }
			: null,
		needsYou: buildNeedsYou(cards, holdOf)
	};
}

/** `apps` tiering: `'starred'` = caller-named OR has at least one of the
 *  viewer's own changes on it right now; everything else with an
 *  Environment is `'active'`; everything else is `'quiet'` (kept for a
 *  caller that wants to render an empty state, never dropped). */
function appTier(
	app: string,
	hasMyChange: boolean,
	starred: ReadonlySet<string>,
	lane: Lane | undefined
): AppModel['tier'] {
	if (starred.has(app) || hasMyChange) return 'starred';
	if (lane) return 'active';
	return 'quiet';
}

/** `appEnvState`'s own vocabulary mapped onto `event-age.ts`'s coarser
 *  `EventAgeKind` — the one it actually knows how to date. */
function ageKindFor(state: EnvState): EventAgeKind | null {
	if (state === 'failed') return 'failed';
	if (state === 'deploying') return 'deploying';
	if (state === 'checking') return 'checking';
	if (state === 'awaiting-approval' || state === 'held-by-rule') return 'held';
	return null;
}

/** The next-most-urgent OTHER place in the same lane that is itself waiting
 *  on a person — invoice-api's own prod-us-east approval, separate from the
 *  prod-eu-west failure that leads the card. `null` when nothing else in
 *  the lane needs a look. */
function secondaryActionFor(lane: Lane, excludeEnv: string): AppModel['secondaryAction'] {
	for (const node of [...lane.stages, ...lane.prod]) {
		if (node.card.envName === excludeEnv) continue;
		if (appEnvState(node.card) === 'awaiting-approval') {
			return {
				label: msg.home_m_action_review_approval_in({ env: node.card.envName }),
				href: cardHref(node.card)
			};
		}
	}
	return null;
}

/**
 * ⭐ ROUND 12 FIX ("LEAD"). Ported from `design/home-r11-census`'s
 * `kitLead`/`kitLeadRaw` (`ControlCenter.svelte`): every active lead gets a
 * FIGURE (how long it has been in this state — `eventAge` + the product's
 * own compact-age formatter), not just a phrase, and a failing lead also
 * names a SEPARATE place on the same app still worth a look, when one
 * exists (invoice-api: the lead is prod-eu-west failing; prod-us-east is
 * independently waiting on an approval). This is a minimal port, not the
 * full `kitLead` machinery (gate-cause-specific figures, the in-motion-count
 * fallback) — see the module's own "Known gaps" note.
 */
function figureAndPhraseFor(
	lane: Lane | undefined,
	now: Date
): {
	figure: string | null;
	phrase: string | null;
	facts: AppModel['facts'];
	primaryAction: AppModel['primaryAction'];
	secondaryAction: AppModel['secondaryAction'];
} {
	const none = {
		figure: null,
		phrase: null,
		facts: { lead: null, since: null },
		primaryAction: null,
		secondaryAction: null
	};
	if (!lane?.lead) return none;
	const lead = lane.lead;
	const state = appEnvState(lead.card);
	const ageKind = ageKindFor(state);
	const since = ageKind ? eventAge(lead.card, ageKind) : null;
	const figure = since ? formatTimeAgoCompact(since, now) : null;
	const env = lead.card.envName;
	const facts = { lead: state, since: since ?? null };
	if (state === 'failed') {
		return {
			figure,
			phrase: msg.home_m_lead_failing({ env }),
			facts,
			primaryAction: { label: msg.home_m_action_roll_back({ env }), href: cardHref(lead.card) },
			secondaryAction: secondaryActionFor(lane, env)
		};
	}
	if (state === 'awaiting-approval') {
		return {
			figure,
			phrase: msg.home_m_lead_approval({ env }),
			facts,
			primaryAction: { label: msg.home_m_action_review_approval(), href: cardHref(lead.card) },
			secondaryAction: null
		};
	}
	if (state === 'held-by-rule') {
		return {
			figure,
			phrase: msg.home_m_lead_held({ env }),
			facts,
			primaryAction: null,
			secondaryAction: null
		};
	}
	if (state === 'deploying' || state === 'checking') {
		const phrase =
			state === 'deploying'
				? msg.home_m_lead_deploying({ env })
				: msg.home_m_lead_checking({ env });
		return { figure, phrase, facts, primaryAction: null, secondaryAction: null };
	}
	return none;
}

/**
 * A place refusing `cell`'s build: the change has waited there since that
 * build arrived one tier upstream (the latest arrival in an env ranked
 * before this one, `Mine`'s own "waiting since it arrived upstream" rule).
 * `undefined` when the place's card is not held.
 */
function heldHere(
	cell: PrCell,
	cells: readonly PrCell[],
	byEnv: Map<string, RolloutCard> | undefined
): HeldHere | undefined {
	const card = byEnv?.get(cell.envName);
	if (!card?.held) return undefined;
	let since: number | null = null;
	if (cell.revision) {
		const rev = new ShaSet([cell.revision]);
		for (const u of cells) {
			if (u.envRank >= cell.envRank) continue;
			for (const h of byEnv?.get(u.envName)?.rollout?.status?.history ?? []) {
				const r = h.version?.revision;
				const t = h.timestamp ? Date.parse(h.timestamp) : NaN;
				if (r && rev.has(r) && !Number.isNaN(t) && (since == null || t > since)) since = t;
			}
		}
	}
	return { since: since != null ? new Date(since).toISOString() : null };
}

export function buildHomeModel(input: HomeModelInput): HomeModel {
	const { changes, rollouts, environments, rolloutDependencies, me, now } = input;
	const kustomizations = input.kustomizations ?? [];
	const kruiseRollouts = input.kruiseRollouts ?? [];
	const starred = input.starredApps ?? new Set<string>();
	const pulseRange = input.pulseRange ?? '24h';

	// ⭐ ROUND 12 FIX ("STATE AGREEMENT" / "NEEDS-YOU PHRASES" / "DUPLICATES").
	// `buildRolloutCards` with no `gateContext` degrades `classifyGate` to its
	// most conservative branch — no environment/dependency join means it can
	// never prove a bare allow-list gate is a person's approval, so every such
	// gate read `heldCause: 'unknown'` ("a rule this dashboard cannot
	// attribute") instead of `'person'`, and `cell.held`/`approvalWait` were
	// never resolved either (the duplicate-env bug upstream of
	// `cellToEnvChange`'s own fix above). `cardContext` is the ONE shared
	// construction every other list surface already uses (`ControlCenter`,
	// `/apps`, `/environments` — see that module's own doc); Home itself is
	// not asked to build it here (no schedules fetch in this pure model), so
	// `schedulesExpected: false` so a schedule-only check gate reads its own
	// honest "nothing more to say" instead of a perpetual "pending".
	const cardCtx = cardContext({
		rollouts,
		environments: { items: environments },
		rolloutDependencies: rolloutDependencies ?? null,
		schedulesByCluster: input.schedulesByCluster,
		schedulesExpected: input.schedulesByCluster != null
	});
	const cards = withHealthWitness(
		buildRolloutCards(rollouts, environments, now, cardCtx.gateContext, cardCtx.contractHoldsFor)
	);
	const lanes = buildLanes(cards);
	const laneByApp = new Map(lanes.map((l) => [l.app, l] as const));
	const facts = fleetFacts(cards, rollouts, now.getTime(), pulseRange);

	const allRows = buildChangeRows(
		changes,
		rollouts,
		environments,
		rolloutDependencies ?? null,
		now
	);
	const meLower = me.toLowerCase();
	const myRows = allRows.filter((r) => r.author.toLowerCase() === meLower);

	const myRowsByApp = new Map<string, ChangeRowVM[]>();
	for (const row of myRows) {
		const apps = row.noRelease ? [row.repo] : (row.services ?? []).map((s) => s.appName);
		for (const app of new Set(apps)) {
			const list = myRowsByApp.get(app) ?? [];
			list.push(row);
			myRowsByApp.set(app, list);
		}
	}

	// Every app with a lane, PLUS every app that merely has one of the
	// viewer's own changes but no Environment mapped yet (fix 7 — never
	// drop a viewer change for lack of a lane to hang it on).
	const appNames = new Set<string>([...laneByApp.keys(), ...myRowsByApp.keys()]);

	const cardByAppEnv = new Map<string, Map<string, RolloutCard>>();
	for (const c of cards) {
		if (!c.envName) continue;
		const m = cardByAppEnv.get(c.name) ?? new Map<string, RolloutCard>();
		m.set(c.envName, c);
		cardByAppEnv.set(c.name, m);
	}

	const apps: AppModel[] = [...appNames].sort().map((app) => {
		const lane = laneByApp.get(app);
		const rowsForApp = myRowsByApp.get(app) ?? [];
		const overrides = buildOverrides(cards, rowsForApp).get(app);
		const byEnv = cardByAppEnv.get(app);
		const ledger = ledgerForApp(app, rowsForApp, overrides, (cell, cells) =>
			heldHere(cell, cells, byEnv)
		);
		const { figure, phrase, facts, primaryAction, secondaryAction } = figureAndPhraseFor(lane, now);
		return {
			app,
			tier: appTier(app, rowsForApp.length > 0, starred, lane),
			figure,
			phrase,
			facts,
			primaryAction,
			secondaryAction,
			envs: lane ? buildAppEnvs(lane, ledger, kustomizations, kruiseRollouts) : [],
			merged: ledger.merged,
			href: appHref(app)
		};
	});

	return {
		now: now.toISOString(),
		fleet: buildFleetSummary(
			cards,
			facts,
			holdNamer(cardCtx.gateContext, cardCtx.contractHoldsFor, now)
		),
		signals: buildSignals(cards, lanes, changes, now, input.healthChecks),
		apps
	};
}
