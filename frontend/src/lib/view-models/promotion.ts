import type { Rollout } from '$lib/../types';
import { getDisplayVersion } from '$lib/utils';
// ⛔ THIS IMPORT IS CIRCULAR, AND THAT IS DELIBERATE — SEE THE NOTE ON
// `detectStuckPromotion` BELOW. `blocking-story.ts` imports `promotionBlock`/
// `promotionCandidates` FROM this file; this file imports only the pure
// per-gate CLASSIFIER back. Both sides are function declarations (hoisted at
// module instantiation, before either module's body runs), so the cycle
// resolves cleanly under ESM — verified by `npx vitest run`, which would
// throw at import time if it did not. `classifyGate` never runs at either
// module's top level, only inside a call, by which point both modules have
// finished initialising.
import { classifyGate, EMPTY_GATE_CONTEXT, type GateContext } from './blocking-story';

export type ReleaseRef = { version?: string; revision?: string; created?: string; tag?: string };

// Threshold shared with detectStuckBehind (utils.ts) — see comment on
// detectStuckPromotion below for why we don't invent a new one.
const DEFAULT_STUCK_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Number of releases newer than the rollout's current version that THIS
 * rollout could take.
 *
 * `status.releaseCandidates` is the oracle: it's the controller's own,
 * already-computed answer to "what could this rollout deploy next", scoped
 * to the rollout's own retention/version window. Ranking a rollout against
 * its OWN releaseCandidates/availableReleases list is the only thing that
 * makes sense here — prod's lag is a question about what PROD could
 * deploy, so prod's own list is the right denominator. Ranking prod
 * against, say, dev's list would be a category error (dev may have a
 * shorter or differently-windowed retention history).
 *
 * Falls back to an index computation against `availableReleases` (which is
 * OLDEST-FIRST) only when `releaseCandidates` is absent from the payload.
 * Returns null — not a fabricated number — when neither list lets us place
 * the current version, e.g. it aged out of its own retention window.
 */
export function newerReleaseCount(rollout: Rollout | null | undefined): number | null {
	const status = rollout?.status;
	if (!status) return null;

	const cur = status.history?.[0] ? getDisplayVersion(status.history[0].version) : null;
	const available = Array.isArray(status.availableReleases) ? status.availableReleases : null;

	// ── VALIDITY GUARD — runs BEFORE we trust releaseCandidates ──────────
	// `releaseCandidates` is empty in TWO different situations, and the
	// field alone cannot tell them apart. rollout-controller does:
	//
	//     idx := IndexFunc(releases, r.Tag == currentRelease)
	//     if idx != -1 { return releases[:idx] }
	//     else         { return []VersionInfo{} }   // "we don't know how to upgrade"
	//
	// so an empty/absent list means EITHER (a) we're at the head and
	// genuinely in sync, OR (b) our current version was garbage-collected
	// out of availableReleases and the controller has no idea how far
	// behind we are. Reading (b) as "0 behind / newest" is exactly the
	// stale-environment-labelled-NEWEST bug this whole change exists to
	// remove — and it fails in the worst direction, because the further
	// behind a rollout falls the likelier its version has aged out.
	//
	// So: if we can see availableReleases and our current version is NOT
	// in it, the lag is UNKNOWN. Return null; callers must show age and
	// emit no number, never "newest" or "in sync".
	if (available && cur !== null) {
		const idx = available.findIndex((r) => getDisplayVersion(r) === cur);
		if (idx === -1) return null; // aged out of its own retention window — unknowable
		if (Array.isArray(status.releaseCandidates)) return status.releaseCandidates.length;
		// availableReleases is OLDEST-FIRST, so distance to head is the
		// number of entries after idx. Verified to agree with
		// releaseCandidates.length on all 15 live rollouts.
		return available.length - 1 - idx;
	}

	// No availableReleases to validate against. releaseCandidates is still
	// the controller's own answer, so use it when present; otherwise we
	// have nothing to go on.
	if (Array.isArray(status.releaseCandidates)) return status.releaseCandidates.length;
	return null;
}

/** The newest release waiting to be deployed, or null. */
export function newestCandidate(rollout: Rollout | null | undefined): ReleaseRef | null {
	const status = rollout?.status;
	if (!status) return null;

	// releaseCandidates is NEWEST-FIRST.
	if (Array.isArray(status.releaseCandidates)) {
		return status.releaseCandidates[0] ?? null;
	}

	// Fall back to availableReleases (OLDEST-FIRST → newest is the last
	// element), but only when we actually know there's something newer —
	// otherwise the "last element" is just the rollout's own current
	// version and calling it a "candidate" would be misleading.
	const count = newerReleaseCount(rollout);
	if (count && count > 0 && Array.isArray(status.availableReleases)) {
		return status.availableReleases[status.availableReleases.length - 1] ?? null;
	}

	return null;
}

/**
 * Whether `gate` allows `version` through. Mirrors `getBlockingGates` in
 * `routes/rollouts/[cluster]/[namespace]/[name]/+page.svelte` (the
 * pre-existing, hand-verified rule) — kept in sync rather than reinvented.
 */
export function gateAllows(
	gate: { passing?: boolean; allowedVersions?: string[] | null },
	version: string
): boolean {
	if (Array.isArray(gate.allowedVersions)) return gate.allowedVersions.includes(version);
	return gate.passing !== false; // no allow-list published — fall back to passing
}

// ReleaseRef declares `tag` optional (per the API contract), but
// getDisplayVersion's signature requires it — real payload objects always
// have it. Delegates to getDisplayVersion rather than reimplementing it.
// Use this for DISPLAY only, never for gate matching.
function versionOf(r: ReleaseRef): string {
	return getDisplayVersion(r as { version?: string; revision?: string; tag: string });
}

/**
 * The key `gate.allowedVersions` is actually keyed on. **It is the TAG**, not
 * the display version:
 *
 *   candidate = {version: "9f10e49",
 *                tag:     "main-1785344304-9f10e494d560c1db68aef5203e3afdc5fd9e1e10"}
 *   ghd-cmppc.allowedVersions[0] = "main-1785344304-9f10e494d560c1db68aef5203e3afdc5fd9e1e10"
 *
 * Comparing the display version against that list makes EVERY gate with an
 * allow-list look like it blocks everything, which silently mis-attributes the
 * block: on the live payload `ghd-cmppc` allows 15 of 24 candidates by tag and
 * 0 by display version. The overall "blocked" verdict came out right anyway
 * (two other gates really do block all 24) — right answer, wrong reason, and a
 * confidently wrong gate name sent the operator to chase a green gate.
 *
 * The rollout detail page already keys on `.tag`
 * (`routes/rollouts/[cluster]/[namespace]/[name]/+page.svelte:1488`:
 * `{@const version = releaseCandidate.tag}`); this matches it.
 */
function gateKeyOf(r: ReleaseRef): string {
	return r.tag ?? r.version ?? r.revision ?? '';
}

export type PromotionBlock = {
	candidateCount: number; // newer releases available to this rollout (0 when unknown)
	deployableCount: number; // of those, how many every gate allows
	blocked: boolean; // candidateCount > 0 && deployableCount === 0
	blockingGates: string[]; // gate NAMES, sorted, that block every candidate
	// `blockingGates` split by what would actually clear them. The split is
	// STRUCTURAL, not name-based (gate names like `schedule-gate-q25wv` are
	// generated and must not be pattern-matched):
	//
	//   awaitingApproval — the gate published an allow-list and no candidate is
	//     on it. It has an opinion and the answer is no. Only a PERSON (or an
	//     external system) changes that; no amount of waiting will.
	//   notPassing — the gate published no allow-list at all and is simply not
	//     passing right now. That is the time-/condition-bounded kind: a
	//     schedule window, a health check. It clears on its own.
	//
	// This is what lets the UI tell "waiting" apart from "wedged" — the entire
	// job of a region titled "needs a decision". Amber belongs only to the
	// first kind.
	awaitingApprovalGates: string[];
	notPassingGates: string[];
};

/**
 * Every release newer than the rollout's current one, **NEWEST FIRST**.
 *
 * Extracted so `promotionBlock` and `newestDeployableCandidate` cannot
 * disagree about what the candidate set is — the button that promotes and
 * the count that justifies it must be derived from one list.
 *
 * The normalisation matters: `releaseCandidates` arrives newest-first,
 * while the `availableReleases` fallback slice is oldest-first. Order is
 * irrelevant to a count and decisive to a `[0]`, which is exactly the kind
 * of difference that survives review and ships inverted.
 */
export function promotionCandidates(rollout: Rollout | null | undefined): ReleaseRef[] {
	const status = rollout?.status;
	if (!status) return [];
	// Honour the same validity guard as newerReleaseCount: when the lag is
	// unknowable we must not claim anything, blocked or otherwise.
	if (newerReleaseCount(rollout) === null) return [];

	if (Array.isArray(status.releaseCandidates)) return status.releaseCandidates;

	const count = newerReleaseCount(rollout);
	if (count && count > 0 && Array.isArray(status.availableReleases) && status.history?.[0]) {
		const cur = getDisplayVersion(status.history[0].version);
		const idx = status.availableReleases.findIndex((r) => getDisplayVersion(r) === cur);
		// availableReleases is OLDEST-FIRST; the tail after idx is everything
		// newer than current. Reversed so this function has ONE contract.
		return idx >= 0 ? status.availableReleases.slice(idx + 1).reverse() : [];
	}
	return [];
}

/**
 * The newest candidate that EVERY gate allows, or null.
 *
 * This is the only thing a `Promote` control may ever preselect, and the
 * `!== null` test is the only thing that may ever put one on screen. Note
 * it is not `newestCandidate()`: a gate can hold the newest build back
 * while allowing an older one through, and preselecting a build the gates
 * refuse would send the operator into a modal that cannot succeed.
 *
 * This predicate is the difference between this page and the defect found
 * on the rollout detail page, which printed "Deployments currently
 * blocked" above 24 enabled Deploy buttons: there the control was rendered
 * from the candidate list, here it is rendered from the DEPLOYABLE list.
 */
export function newestDeployableCandidate(rollout: Rollout | null | undefined): ReleaseRef | null {
	const gates = rollout?.status?.gates ?? [];
	for (const c of promotionCandidates(rollout)) {
		if (gates.every((g) => gateAllows(g, gateKeyOf(c)))) return c;
	}
	return null;
}

/**
 * Can THIS rollout deploy THIS tag right now?
 *
 * The set-row promote control needs a different question from a stage
 * row's: not "what is newest" but "can this one straggler be brought up to
 * the build the rest of the fan-out is already running". Both halves are
 * required — the tag must be a candidate for this rollout (it may be
 * BEHIND the straggler, in which case promotion is the wrong verb
 * entirely), and every gate must allow it.
 */
export function isDeployable(rollout: Rollout | null | undefined, tag: string | null): boolean {
	if (!tag) return false;
	const gates = rollout?.status?.gates ?? [];
	if (!promotionCandidates(rollout).some((c) => gateKeyOf(c) === tag)) return false;
	return gates.every((g) => gateAllows(g, tag));
}

export function promotionBlock(rollout: Rollout | null | undefined): PromotionBlock {
	const status = rollout?.status;
	const empty: PromotionBlock = {
		candidateCount: 0,
		deployableCount: 0,
		blocked: false,
		blockingGates: [],
		awaitingApprovalGates: [],
		notPassingGates: []
	};
	if (!status) return empty;

	const candidates = promotionCandidates(rollout);
	if (candidates.length === 0) return empty;

	const gates = status.gates ?? [];
	// gateKeyOf, NOT versionOf — allowedVersions is keyed on the tag.
	const deployableCount = candidates.filter((c) =>
		gates.every((g) => gateAllows(g, gateKeyOf(c)))
	).length;
	const blocked = candidates.length > 0 && deployableCount === 0;

	const blockingGateObjs = gates.filter((g) =>
		candidates.every((c) => !gateAllows(g, gateKeyOf(c)))
	);
	let blockingGates = blockingGateObjs.map((g) => g.name).sort();

	// Fallback: every candidate is blocked, but no single gate blocks ALL
	// of them (e.g. each candidate is blocked by a different gate). In
	// that case attribute the block to whatever gates stop the newest
	// candidate — that's the one a user actually cares about promoting.
	let classifiedFrom = blockingGateObjs;
	if (blocked && blockingGates.length === 0) {
		const newest = newestCandidate(rollout);
		const newestKey = newest ? gateKeyOf(newest) : null;
		if (newestKey) {
			classifiedFrom = gates.filter((g) => !gateAllows(g, newestKey));
			blockingGates = classifiedFrom.map((g) => g.name).sort();
		}
	}

	// Structural split — see the comment on PromotionBlock.
	const awaitingApprovalGates = classifiedFrom
		.filter((g) => Array.isArray(g.allowedVersions))
		.map((g) => g.name)
		.sort();
	const notPassingGates = classifiedFrom
		.filter((g) => !Array.isArray(g.allowedVersions))
		.map((g) => g.name)
		.sort();

	return {
		candidateCount: candidates.length,
		deployableCount,
		blocked,
		blockingGates,
		awaitingApprovalGates,
		notPassingGates
	};
}

/**
 * Promotion-level stuck reason. Deliberately NOT added to the `StuckReason`
 * union in `$lib/utils`: several call sites (e.g. ControlCenter.svelte:214)
 * narrow that union by elimination and would silently mistype a new member.
 * <StuckBadge> accepts `StuckReason | PromotionStuckReason` instead.
 */
export type PromotionStuckReason = {
	kind: 'promotion';
	candidateCount: number;
	waitingMs: number;
	blockingGates: string[];
};

/**
 * Promotion-level stuck: releases are waiting and have been waiting a long
 * time. Shaped to feed the existing <StuckBadge>.
 *
 * ── THE TRUTH BUG THIS GUARD EXISTS TO KILL (2026-09-02, commit b3cfb15) ──
 *
 * The old guard read `block.awaitingApprovalGates.length === 0` — and
 * `awaitingApprovalGates` means only *"this gate published an allow-list"*.
 * THREE of the four gate writers publish one (`RolloutSchedule` is the only
 * one that does not): the environment controller's promotion gate and
 * `RolloutDependency`'s contract gate both do, and neither is a person.
 * `hello-frontend-app` in prod is the live proof — every gate reports
 * `passing: true`, the rollout is on the newest build its contract admits
 * (`rel-67` needs `api ^1.67.0`, `hello-api-app` serves `1.66.0`), and this
 * guard alone called it `stuck` in amber while `/apps/<name>` and rollout
 * detail both correctly said "waiting on another deploy".
 *
 * A GATE THAT PUBLISHED AN ALLOW-LIST IS NOT EVIDENCE OF A PERSON. Whether
 * one is needed is a JOIN on who wrote the gate — `blocking-story.ts`'s
 * `classifyGate` — and amber is earned only by `clears === 'person'` (a
 * human wrote it) or `clears === 'unknown'` (we could not tell, and not
 * knowing is not benign). `upstream` (environment/dependency) and `clock`/
 * `check` gates are excluded, matching `blockingStory`'s own `person`/
 * `unknown` buckets — the ones a caller with a real `GateContext` gets.
 *
 * ⚠️ WITH NO `gateContext` SUPPLIED (the default), every gate holding an
 * allow-list classifies `unknown` against `EMPTY_GATE_CONTEXT` — nothing is
 * joined, so nothing can be attributed to `upstream` — which is exactly the
 * old, more conservative behaviour. A caller that cannot build a
 * `GateContext` (no `environments`/`rolloutDependencies` in scope) gets the
 * SAME answer as before; only a caller that supplies the join gets the fix.
 * Every surface that renders `stuck` from this function should supply one.
 */
export function detectStuckPromotion(
	rollout: Rollout | null | undefined,
	options?: { now?: Date; thresholdMs?: number; gateContext?: GateContext }
): PromotionStuckReason | null {
	if (rollout?.spec?.wantedVersion) return null; // pinned — by user choice, mirrors detectStuckBehind

	const block = promotionBlock(rollout);
	if (block.candidateCount === 0) return null;
	// Amber is reserved for `stuck` = wedged, i.e. it will not clear on its
	// own WITHOUT A PERSON. See the note above this function for why the
	// structural `awaitingApprovalGates` test alone cannot decide that — a
	// gate is excused only when EVERY gate holding the block classifies as
	// `upstream`/`clock`/`check`, never `person` or `unknown`.
	//
	// ⚠️ ONLY WHEN `block.blocked` IS TRUE. A gateless-but-stagnant rollout
	// (`block.blocked === false` — nothing is refusing it, it simply has not
	// moved) is a DIFFERENT wedge this predicate has always caught and must
	// keep catching: there are no blocking gates to classify, so `holding` is
	// empty and `needsPerson` would be vacuously false, wrongly clearing it.
	if (block.blocked) {
		const namespace = rollout?.metadata?.namespace;
		const ctx = options?.gateContext ?? EMPTY_GATE_CONTEXT;
		const holding = new Set(block.blockingGates);
		const needsPerson = (rollout?.status?.gates ?? [])
			.filter((g) => g?.name && holding.has(g.name))
			.map((g) => classifyGate(g, namespace, ctx))
			.some((g) => g.clears === 'person' || g.clears === 'unknown');
		if (!needsPerson) return null;
	}

	const now = options?.now ?? new Date();
	// Same 24h constant detectStuckBehind already uses. This demo pipeline
	// is frozen (nothing built for 24 days), so any threshold from 1h to
	// 30d gives the same answer against the live data — not tuned against
	// it, just reusing the existing convention.
	const thresholdMs = options?.thresholdMs ?? DEFAULT_STUCK_THRESHOLD_MS;

	const candidate = newestCandidate(rollout);
	let waitingSinceIso: string | undefined = candidate?.created;
	if (!waitingSinceIso) waitingSinceIso = rollout?.status?.history?.[0]?.timestamp;
	if (!waitingSinceIso) return null;

	const waitingSince = new Date(waitingSinceIso).getTime();
	if (Number.isNaN(waitingSince)) return null;
	const waitingMs = now.getTime() - waitingSince;
	if (waitingMs <= thresholdMs) return null;

	return {
		kind: 'promotion',
		candidateCount: block.candidateCount,
		waitingMs,
		blockingGates: block.blockingGates
	};
}
