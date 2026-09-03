/**
 * ⛔ "DEPLOYMENTS CURRENTLY BLOCKED" WAS FALSE FOR THE ACTION THE READER WAS
 * ABOUT TO TAKE. THIS FILE IS THE ONE PLACE THAT KNOWS WHAT IS ACTUALLY HELD.
 *
 * A live UX critique read a full-width amber banner saying *"Deployments
 * currently blocked. Will be allowed in 2d 1h."*, saw a `Blocked` chip on every
 * version row, then pressed the blue `Deploy` and **production changed
 * immediately**. The page went on rendering the new version `Deploying` with
 * the blocked banner still above it. The mirror image was on the other side of
 * the same screen: *"Clear Version Pin"* promised *"the rollout will advance to
 * the latest release candidate"* and it advanced **zero**, because the gate
 * really does block automatic promotion.
 *
 * Both sentences were guesses about a distinction the controller makes
 * explicitly. `rollout_controller.go`:
 *
 *     if !r.hasManualDeployment(&rollout) && len(rollout.Status.History) > 0 {
 *         if !gatesPassing              { return ctrl.Result{}, nil }
 *         if len(gatedCandidates) == 0  { return ctrl.Result{}, nil }
 *     }
 *     ...
 *     if !r.hasManualDeployment(&rollout) && ... && !healthChecksHealthy { return }
 *
 * and `hasManualDeployment` is `spec.wantedVersion != nil || annotations
 * ["rollout.kuberik.com/force-deploy"] != ""` — which is precisely what this
 * dashboard sets when a person presses `Deploy` or `Pin & Deploy`
 * (`pkg/kubernetes/client.go`, `ChangeVersion`).
 *
 * **So every one of these conditions holds back AUTOMATIC PROMOTION and none
 * of them holds back a deploy a person starts.** One fact, four sources, and
 * the product was spelling it as "blocked" on three surfaces and as "will
 * advance" on a fourth.
 *
 * Pure functions over the rollout object. No fetch, no component, so the
 * banner, the row chip, the deploy confirmation and the clear-pin dialog can
 * all read the same answer and cannot drift apart again.
 */

import type { Rollout, RolloutGate } from '../../types';

export type AutoDeployReason = 'gates' | 'health' | 'pin' | 'failed';

export type AutoDeployState = {
	/**
	 * True when the controller will not move this rollout forward on its own.
	 * It says NOTHING about whether a person can deploy — that is the whole
	 * point of the file.
	 */
	paused: boolean;
	/** Every reason that is true right now, in the order a reader should hear them. */
	reasons: AutoDeployReason[];
	/**
	 * The blocking gates' HUMAN names — `gate.kuberik.com/pretty-name` ONLY.
	 *
	 * ⛔ A GENERATED NAME IS NEVER PROMOTED INTO THIS LIST. `DESIGN.md`'s
	 * standing charge is *"an opaque generated gate name presented as an
	 * explanation"*, and `schedule-gate-zvsqr` explains nothing. When the
	 * cluster published no readable name the sentence simply stops at the
	 * consequence — the generated name still has a home on this page, in the
	 * gate popover, where it reads as a handle to go look up.
	 */
	gateNames: string[];
};

export const AUTO_DEPLOY_RUNNING: AutoDeployState = { paused: false, reasons: [], gateNames: [] };

function prettyGateName(gate: RolloutGate | undefined): string | null {
	return gate?.metadata?.annotations?.['gate.kuberik.com/pretty-name'] || null;
}

/**
 * `gates` is the FULL gate objects (for their pretty names); the blocking set
 * comes from `rollout.status.gates`, which is the controller's own evaluation.
 */
export function autoDeployState(
	rollout: Rollout | null | undefined,
	gates: RolloutGate[] = []
): AutoDeployState {
	if (!rollout) return AUTO_DEPLOY_RUNNING;

	const reasons: AutoDeployReason[] = [];
	const conditions = rollout.status?.conditions ?? [];
	const cond = (type: string) => conditions.find((c) => c.type === type);

	const gatesPassing = cond('GatesPassing');
	const blocking = (rollout.status?.gates ?? []).filter((g) => g.passing === false);
	if (gatesPassing?.status === 'False' || blocking.length > 0) reasons.push('gates');

	// Health checks. `DeploymentBlocked=True` is the controller's own name for
	// "health checks are unhealthy", and it too is only consulted for
	// automatic deploys.
	if (cond('DeploymentBlocked')?.status === 'True') reasons.push('health');

	// ⚠️ A PIN IS NOT A BLOCK, IT IS A CHOICE — but it has the same
	// consequence for automatic promotion, which is the question this object
	// answers. Naming it here is what makes the clear-pin dialog able to say
	// what will really happen when the pin comes off.
	if (rollout.spec?.wantedVersion) reasons.push('pin');

	// A failed bake stops automatic deploys until someone unblocks it.
	const latest = rollout.status?.history?.[0];
	const unblocked = rollout.metadata?.annotations?.['rollout.kuberik.com/unblock-failed'] === 'true';
	if (latest?.bakeStatus === 'Failed' && !unblocked) reasons.push('failed');

	const gateNames = blocking
		.map((g) => prettyGateName(gates.find((full) => full.metadata?.name === g.name)))
		.filter((n): n is string => n !== null);

	return { paused: reasons.length > 0, reasons, gateNames: [...new Set(gateNames)].sort() };
}

/**
 * What is holding it, in ordinary English, consequence first. Never a
 * generated object name on its own — the gate names ride inside the sentence
 * only when the cluster published readable ones.
 */
export function autoDeployWhy(state: AutoDeployState): string {
	const parts: string[] = [];
	for (const r of state.reasons) {
		switch (r) {
			case 'gates':
				parts.push(
					state.gateNames.length > 0
						? `a rule is holding it (${state.gateNames.join(', ')})`
						: 'a rule is holding it'
				);
				break;
			case 'health':
				parts.push('health checks are failing');
				break;
			case 'pin':
				parts.push('it is pinned to one version');
				break;
			case 'failed':
				// NOT `failed its bake`. `bake` is the CRD's field name and the
				// product's word for that phase is `checking` (`bake-status.ts`).
				// This clause sits inside `Automatic promotion is held right
				// now — …`, which is prose an operator reads, so it takes the
				// product's spelling like every other sentence.
				parts.push('the last deploy failed its checks');
				break;
		}
	}
	return parts.join(', and ');
}

/**
 * THE SENTENCE THAT GOES WHERE THE DECISION IS MADE.
 *
 * The critique's demand was literal: *"the deploy confirmation must restate the
 * gate state INSIDE the modal, where the decision is made"*. Returns null when
 * automatic promotion is running normally — a modal that says "nothing is
 * blocking" on every deploy teaches the reader to stop reading it.
 */
export function manualDeployNote(state: AutoDeployState): string | null {
	if (!state.paused) return null;
	return `Automatic promotion is held right now — ${autoDeployWhy(state)}. That does not hold this deploy: it applies immediately.`;
}

/**
 * What clearing the pin will REALLY do. The old dialog promised the rollout
 * "will advance to the latest release candidate" unconditionally, and on the
 * live cluster it advanced zero.
 *
 * `state` must be the state INCLUDING the pin; this function reasons about the
 * world after the pin is gone, which is why it ignores the `pin` reason.
 */
export function clearPinOutcome(state: AutoDeployState): string {
	const rest = { ...state, reasons: state.reasons.filter((r) => r !== 'pin') };
	if (rest.reasons.length === 0) {
		return 'Automatic promotion resumes, and the rollout moves to the newest allowed version.';
	}
	return `Automatic promotion resumes, but nothing will move yet — ${autoDeployWhy(rest)}. The rollout stays on the version it is running until that clears.`;
}

/**
 * ⛔ A ROLLBACK AND ITS PIN ARE ONE ACT, AND ROLLOUT DETAIL WAS TELLING
 * NEITHER HALF. (2026-08-31)
 *
 * The human, on a phone, on `/rollouts/dev/hello-dep-dev/hello-frontend-app`:
 * *"The rollout list has the rollback icon but here it's not clear that it was
 * rolled back. Moreover, usually the version is pinned when we rollback."*
 * The page rendered a green tick and `deploy succeeded`, which is true and
 * radically incomplete — the deploy did succeed, at going backwards.
 *
 * ── WHY THE PIN IS PART OF THE SENTENCE AND NOT A SECOND BADGE ────────────
 *
 * The human's instinct is the product's own rule. `ChangeVersionModal`'s
 * `mustPin` is `isPinVersionMode || direction === 'rollback' || intent.custom`
 * and `isPinVersionToggleDisabled` is `mustPin || …`, so **a rollback started
 * in this product always pins, and the toggle is on and greyed**. Verified on
 * the live hub: opening `Rollback to 991829b` on
 * `hello-world-prod/hello-world-app` yields one checkbox reading `Pin Version
 * / Going back pins the version`, `checked: true`, `disabled: true`.
 *
 * So `pinned` is not a coincidence that co-occurs with `rolled back`; it is
 * what the rollback DID. Two badges would make the reader assemble one act
 * out of two marks. One sentence states it.
 *
 * ── AND THE UNPINNED ROLLBACK, WHICH IS A DIFFERENT FACT ──────────────────
 *
 * It is reachable, in two clicks, and it is NOT exotic: `Rollback` pins, and
 * the `Clear pin` button on the very same card POSTs `/pin` with
 * `version: null` (`ClearPinModal`), which clears `spec.wantedVersion` and
 * touches nothing else. History still shows the rollback; nothing holds it.
 *
 * What that state MEANS comes from `rollout_controller.go`, not from a guess.
 * With `spec.wantedVersion == nil`, `hasManualDeployment` is false, so
 * `selectWantedRelease` falls through to `gatedReleaseCandidates[0]` — and
 * `getNextReleaseCandidates` REVERSES `availableReleases` and returns
 * everything strictly NEWER than what is running. After a rollback that set
 * is never empty: the build you rolled away from is in it, and the controller
 * takes the NEWEST of it. **An unpinned rollback is a rollback the controller
 * will undo the moment the gates allow.**
 *
 * ⚠️ AND IT MUST NOT BE SAID AS THOUGH IT WERE HAPPENING. On the live rollout
 * `GatesPassing=False / NoAllowedVersions` — a dependency gate holds `rel-67`
 * — so `will re-promote` is FALSE today. That is a property of the gate state,
 * not of the rollback, so the sentence names the condition. The product's
 * standing rule is that a temporary state may not be phrased as permanent;
 * this is its inverse and it binds just as hard.
 */
export function rollbackWent(
	back: { from: string; to: string; by: number },
	state: AutoDeployState
): string {
	const plural = back.by === 1 ? '' : 's';
	return state.reasons.includes('pin')
		? `Went back ${back.by} release${plural}, ${back.from} → ${back.to}, and pinned there.`
		: `Went back ${back.by} release${plural}, ${back.from} → ${back.to}, and it is not pinned there.`;
}

/**
 * ⭐ THE SECOND HALF — WHAT HAPPENS NEXT, WHICH IS A DIFFERENT TIER FROM WHAT
 * HAPPENED. (2026-08-31)
 *
 * Measured at 390 on `hello-dep-dev/hello-frontend-app`, the rollback banner
 * was **198px and 237 characters** sitting directly under a 226px gate banner
 * — 456px of an 844px viewport before the status card that says what is
 * deployed. And on that rollout the two fields SAID THE SAME THING: the amber
 * one *"Nothing promotes itself until hello-api-app ships a newer api than
 * 1.66.0"*, the blue one *"It will not move today — a rule is holding it"*.
 * One fact, twice, in two colours, stacked.
 *
 * `rollbackWent` is the fact and its subject — it names BOTH versions, which
 * is the thing the banner exists to say. This is the mechanism behind it, and
 * mechanism is the disclosure tier everywhere else in `AlertPanel` now.
 *
 * ⛔ SPLIT, NOT SHORTENED. `rollbackStory` still composes and returns the
 * identical assembled sentence, so `truth.test.ts`'s assertions on it are
 * untouched and every clause is still produced by a state. Nothing here got
 * quieter about anything.
 */
export function rollbackNext(
	back: { from: string; to: string; by: number },
	state: AutoDeployState
): string {
	if (state.reasons.includes('pin')) {
		return `Nothing moves off ${back.to} until the pin is cleared.`;
	}
	// Reason about the world WITHOUT the pin, exactly as `clearPinOutcome`
	// does — the pin is absent here, so anything left is a real hold.
	const rest = state.reasons.filter((r) => r !== 'pin');
	if (rest.length === 0) {
		return 'Automatic promotion is running, so the newest allowed build deploys here again.';
	}
	// Hoisted, not inlined: `scan.ts` collapses an interpolation to one
	// character only when it can find the closing brace, and a nested object
	// literal inside `${…}` defeats it. An un-collapsed hole makes the census
	// entry unmatchable, so the string looks unreachable when it is not.
	const why = autoDeployWhy({ ...state, reasons: rest });
	return `It will not move today — ${why} — but the newest allowed build deploys here again as soon as that clears.`;
}

export function rollbackStory(
	back: { from: string; to: string; by: number },
	state: AutoDeployState
): string {
	return `${rollbackWent(back, state)} ${rollbackNext(back, state)}`;
}
