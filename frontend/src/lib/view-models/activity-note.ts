/**
 * THE DEPLOY'S OWN REASON, AND WHETHER A PERSON DID IT (QA #14).
 *
 * A history entry's `message` is the audit record of why a deploy happened. The controller's own boilerplate ("Automatic deployment")
 * and the dashboard's defaults for a blank reason field ("Force deploy version …", `isSystemDefaultNote`) are not reasons; anything else
 * a person typed (the reason) is. `manual` is "a person pressed deploy" — the same actor split every activity surface uses —
 * so a manual deploy is never indistinguishable from the controller promoting a build.
 */
import { plainMessage } from '$lib/utils';
import { isSystemDefaultNote } from '$lib/history-marks';

export function deployReason(message: string | null | undefined): string | null {
	const text = plainMessage(message);
	if (!text) return null;
	if (/^automatic deployment$/i.test(text)) return null;
	if (isSystemDefaultNote(text)) return null;
	return text;
}

export function isManualDeploy(actorKind: 'person' | 'ci' | 'controller'): boolean {
	return actorKind === 'person';
}

/**
 * MANUAL (QA #14, owner decision 2026-11-09). A deploy a person pressed reads "manual", whatever path it took. Force deploy is no
 * different from bypassing a gate, and the bypass feature was removed because it brought no value: there is NO separate "override"
 * mark. The reason, when the person typed one, is `deployReason`. A rule held the build is said in the deploy dialog (deploy-risk.ts).
 */
export type DeployMark = 'manual' | null;
export function deployMark(e: { actorKind: 'person' | 'ci' | 'controller' }): DeployMark {
	return e.actorKind === 'person' ? 'manual' : null;
}
