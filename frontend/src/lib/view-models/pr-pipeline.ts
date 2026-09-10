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
 * TRUNCATED (`containedInAll: false`) set without being absent — that is
 * what `containment()` below's `release.created` vs `mergedAt` fallback is
 * for, and it applies ONLY there (rule 3/4's boundary), never to a history
 * entry.
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
import { groupRolloutsByApp, repoKeyFromSource, repoLabel, type AppCell } from '$lib/version-utils';
import { gateAllows } from './promotion';
import { buildGateContext, classifyGate, type GateContext } from './blocking-story';
import { median, leadTime, type LeadEnv, type LeadDeploy } from './lead-time';

export type PrState =
	| 'not-built'
	| 'gated'
	| 'pinned'
	| 'waiting-upstream'
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
};

export type PrService = {
	appName: string;
	/** `github.com/owner/repo`, this app's OWN `status.source`, normalised. */
	sourceRepo: string;
	cells: PrCell[];
	/** The rollup sentence, e.g. "live in dev · baking in staging". */
	furthest: string;
	/** This app's own dev→prod lead time, `null` with fewer than 2 samples. */
	leadTimeMs: number | null;
};

export type PrPipelineVM = {
	services: PrService[];
	/** The page's one verdict line, e.g. "live everywhere". */
	verdict: string;
};

/** The PR facts `fetchPull` (`api/pulls.ts`) resolves, plus the repo it is on. */
export type PrPipelineMeta = {
	owner: string;
	repo: string;
	number: number;
	mergedAt: string | null;
	mergeCommitSha: string | null;
	containedIn: readonly string[];
	containedInAll: boolean;
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
 */
function containment(release: ReleaseLike, set: Set<string>, meta: PrPipelineMeta): Containment {
	if (release.revision && set.has(release.revision)) return 'contained';
	if (meta.containedInAll) return 'not-contained';
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

const NOTHING: Pick<PrCell, 'since' | 'bakeLeftMs' | 'superseded' | 'gateHint'> = {
	since: null,
	bakeLeftMs: null,
	superseded: false,
	gateHint: null
};

function buildCell(
	rollout: Rollout,
	envName: string,
	cluster: string,
	set: Set<string>,
	meta: PrPipelineMeta,
	gateCtx: GateContext,
	now: Date
): PrCell {
	const status = rollout.status ?? {};
	const history = status.history ?? [];
	const head = history[0];
	const headRevision = head?.version?.revision ?? null;
	const ns = rollout.metadata?.namespace ?? '';
	const name = rollout.metadata?.name ?? '';
	const envRank = getEnvironmentRank(envName);
	const usuallyMs = cellUsuallyMs(rollout);

	const cell = (partial: Omit<PrCell, 'cluster' | 'envName' | 'envRank' | 'usuallyMs'>): PrCell => ({
		cluster,
		envName,
		envRank,
		usuallyMs,
		...partial
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
		if (releaseMetadataUnresolved(candidate)) {
			return cell({
				...NOTHING,
				state: 'gated',
				reason: 'manifest unreadable',
				releaseLabel,
				revision: candidate.revision ?? null
			});
		}

		const gates = status.gates ?? [];
		const blocking = gates.filter((g) => !gateAllows(g, candidateKey));
		if (blocking.length > 0) {
			const classified = blocking.map((g) => classifyGate(g, ns, gateCtx));
			// `waiting-upstream` OUTRANKS `gated` — a dependency/promotion gate
			// (`clears === 'upstream'`) is never described as merely "gated"
			// when one is present, even alongside an approval/check gate.
			const upstream = classified.find((c) => c.clears === 'upstream');
			const pick = upstream ?? classified[0];
			return cell({
				...NOTHING,
				state: upstream ? 'waiting-upstream' : 'gated',
				reason: pick.short,
				releaseLabel,
				revision: candidate.revision ?? null,
				gateHint: { cluster, namespace: ns, rolloutName: name, gateName: pick.id }
			});
		}

		// A build containing the PR is deployable by every current gate and
		// simply has not been promoted yet — a real, if usually brief, window.
		return cell({
			...NOTHING,
			state: 'gated',
			reason: 'built and ready — nothing is blocking it, it just has not promoted yet',
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
	gated: 'gated',
	pinned: 'pinned',
	'waiting-upstream': 'waiting',
	deploying: 'deploying',
	baking: 'baking',
	retrying: 'retrying',
	failed: 'failed',
	cancelled: 'cancelled',
	'rolled-back': 'rolled back',
	live: 'live'
};

/** How far a state has actually progressed — for "furthest" and the verdict. */
const STATE_PROGRESS: Record<PrState, number> = {
	'not-built': 0,
	gated: 1,
	pinned: 1,
	'waiting-upstream': 1,
	'rolled-back': 1.5,
	deploying: 2,
	failed: 2,
	cancelled: 2,
	baking: 2.5,
	retrying: 2.5,
	live: 3
};

function furthestSentence(cells: PrCell[]): string {
	if (cells.length === 0) return 'no environments';
	return [...cells]
		.sort((a, b) => a.envRank - b.envRank || a.cluster.localeCompare(b.cluster))
		.map((c) => `${STATE_VERB[c.state]} in ${c.envName}`)
		.join(' · ');
}

function buildVerdict(services: PrService[]): string {
	const allCells = services.flatMap((s) => s.cells);
	if (allCells.length === 0) return 'No service on this cluster deploys this repository';
	if (allCells.every((c) => c.state === 'live')) return 'Live everywhere';

	// The worst-progressed cell; ties broken toward the DEEPER environment —
	// being blocked in prod is more news than being blocked in dev.
	const worst = allCells.reduce((acc, c) => {
		const a = STATE_PROGRESS[acc.state];
		const b = STATE_PROGRESS[c.state];
		if (b < a) return c;
		if (b === a && c.envRank > acc.envRank) return c;
		return acc;
	});

	switch (worst.state) {
		case 'not-built':
			return 'Not built yet';
		case 'pinned':
			return `Pinned away from it in ${worst.envName}`;
		case 'waiting-upstream':
		case 'gated':
			return `Waiting in ${worst.envName} on ${worst.reason}`;
		case 'failed':
			return `Failed in ${worst.envName}`;
		case 'cancelled':
			return `Cancelled in ${worst.envName}`;
		case 'rolled-back':
			return `Rolled back in ${worst.envName}`;
		default:
			return `${STATE_VERB[worst.state][0].toUpperCase()}${STATE_VERB[worst.state].slice(1)} in ${worst.envName}`;
	}
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

	// The PR's own repo, normalised the SAME way every rollout's own
	// `status.source` is — so `https://github.com/o/r.git` and `o/r` agree.
	const expectedRepoKey = repoKeyFromSource(`github.com/${meta.owner}/${meta.repo}`, '');

	const groups = groupRolloutsByApp(rollouts, environments);
	const services: PrService[] = [];

	for (const group of groups.values()) {
		const matching = group.cells.filter((c) => c.repoKey === expectedRepoKey);
		if (matching.length === 0) continue;

		const cells = matching
			.map((c) => buildCell(c.rollout, c.envName, c.sourceCluster, set, meta, gateCtx, now))
			.sort((a, b) => a.envRank - b.envRank || a.cluster.localeCompare(b.cluster));

		const leadVm = leadTime(buildLeadEnvs(matching));

		services.push({
			appName: group.appName,
			sourceRepo: repoLabel(matching[0].repoKey),
			cells,
			furthest: furthestSentence(cells),
			leadTimeMs: leadVm?.medianMs ?? null
		});
	}

	return { services, verdict: buildVerdict(services) };
}
