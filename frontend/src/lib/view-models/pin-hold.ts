/**
 * THE FACTS A PIN HOLD IS MADE OF, ONE PLACE. A pin (`spec.wantedVersion`) holds
 * every newer build a rollout could have taken; each surface that says so (the
 * Gates tab's pin box, the Clear pin dialog, the app banner, the count chip)
 * reads these helpers instead of re-deciding.
 */
import type { Rollout } from '../../types';
import type { RolloutCard } from '$lib/rollout-cards';
import type { EnvState } from './home-model';
import { isTrailing } from './fleet-groups';
import { isFieldManagedByManager, isFieldManagedByOtherManager } from '$lib/utils';
import { liveForPlace, type Fleet } from './failed-builds';
import { promotionCandidates, type ReleaseRef } from './promotion';

/** WHO: `rollout.kuberik.com/deploy-user`, set by the same `/pin` / `/change-version` call that writes `wantedVersion`. Null when absent (a service-account pin); never invented. */
export function pinnedByWho(rollout: Rollout | null | undefined): string | null {
	return rollout?.metadata?.annotations?.['rollout.kuberik.com/deploy-user'] || null;
}

/**
 * The header sentence of a pinned rollout's Gates tab: the pin's own words, never the
 * gate-only "<builds> can deploy" (a pin refuses every one of those builds, so none can).
 * Null when the rollout is not pinned.
 */
export function pinLeadSentence(
	story: { pinnedTo: string | null; headline: string; consequence: string }
): { headline: string; consequence: string } | null {
	if (!story.pinnedTo) return null;
	return { headline: story.headline, consequence: story.consequence };
}

/** The one phrase for a build a pin holds, on every row that states a hold's cause. */
export const HELD_BY_PIN = 'Held by the pin';

/** A place a pin holds builds at: pinned, and newer builds exist that the pin refuses. The one predicate every count of held places reads (a pin with nothing newer holds nothing). */
export const pinHoldsBuilds = (c: Pick<RolloutCard, 'pinnedVersion'> & Partial<RolloutCard>): boolean => c.pinnedVersion != null && isTrailing(c as RolloutCard);

/**
 * A place's state as every COUNT of held places reads it: a place a pin holds is held, even though its own state word is quiet
 * (rolled back, or healthy and behind). A separate view over the state, never a change to it: the approval counts, the ink and
 * the per-place state words keep reading the raw `EnvState`.
 */
export const placeStateWithPin = (state: EnvState, pinned: boolean | undefined): EnvState =>
	pinned && (state === 'rolled-back' || state === 'healthy' || state === 'superseded') ? 'held-by-rule' : state;


/**
 * May the dashboard write `spec.wantedVersion`? False only when ANOTHER manager owns the field (clearing it would be fought over). The ONE
 * predicate behind every Clear pin: the Overview's header, banner and compact row, the Gates tab's pin box and the dialog all disable on it,
 * so no surface offers a clear the others refuse.
 */
export function dashboardManagesWantedVersion(rollout: Rollout | null | undefined): boolean {
	if (!rollout) return false;
	if (rollout.spec?.wantedVersion === undefined) return true;
	const managed = rollout.metadata?.managedFields;
	if (managed) {
		if (isFieldManagedByManager(managed, 'rollout-dashboard', 'spec.wantedVersion')) return true;
		if (isFieldManagedByOtherManager(managed, 'rollout-dashboard', 'spec.wantedVersion')) return false;
	}
	return true;
}

/**
 * THE ONE LIST OF NEWER BUILDS A ROLLOUT SHOWS: the candidates minus the ones that failed here or upstream in the wave chain. The header's
 * "N newer" is this list's length and the Gates tab's pin card is this list, so they cannot disagree. Until the fleet has answered
 * (`settled` false) the whole candidate list stays; a list that would come out empty keeps the whole list too (the old `newerCountShown` zero
 * rule). The rules live here, once, for both surfaces.
 */
export function newerBuildsShown(rollout: Rollout | null | undefined, fleet: Fleet | null | undefined, settled: boolean): ReleaseRef[] {
	const all = promotionCandidates(rollout);
	if (!settled) return all;
	const live = liveForPlace(rollout as never, all as never, fleet) as unknown as ReleaseRef[];
	return live.length > 0 ? live : all;
}

/**
 * THE GATES TAB'S PIN BOX, ONE MAPPING. The tab draws one box per gate (and one for the pin); this decides what each says it holds and what the
 * Held-here node and Clear pin button read, so the rules are testable without the route:
 *  - a blocked gate box names only the builds held HERE (`hereBuilds`), not every candidate the gate refuses;
 *  - a blocked PIN box names `newerBuildsShown` (the list the header counts), never the gate list: a build that failed here or upstream is not held by the pin;
 *  - the focus node's held builds are the pin box's list while pinned, and the builds held here otherwise (a pinned place must not tell you to approve);
 *  - Clear pin is disabled exactly when `dashboardManagesWantedVersion` says another manager owns the field.
 */
export function gatesPinBox<B extends { kind: string; state: string; held: string[] }>(a: {
	boxes: B[];
	rollout: Rollout | null | undefined;
	fleet: Fleet | null | undefined;
	settled: boolean;
	hereBuilds: string[];
	pinnedTo: string | null | undefined;
	displayVersion: (c: ReleaseRef) => string;
}): { boxes: B[]; heldBuildsOverride: string[]; clearPinDisabled: boolean } {
	const here = new Set(a.hereBuilds);
	const pinHeld = [...new Set(newerBuildsShown(a.rollout, a.fleet, a.settled).map(a.displayVersion))];
	const boxes = a.boxes.map((b) => (b.kind === 'pin' ? (b.state === 'blocked' ? { ...b, held: pinHeld } : b) : b.state === 'blocked' ? { ...b, held: b.held.filter((x) => here.has(x)) } : b));
	const pinBoxHeld = boxes.find((b) => b.kind === 'pin')?.held ?? [];
	return { boxes, heldBuildsOverride: a.pinnedTo ? pinBoxHeld : a.hereBuilds, clearPinDisabled: !dashboardManagesWantedVersion(a.rollout) };
}
