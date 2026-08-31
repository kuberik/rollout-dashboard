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
				// This clause sits inside `Automatic promotion is paused right
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
	return `Automatic promotion is paused right now — ${autoDeployWhy(state)}. That does not hold this deploy: it applies immediately.`;
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
