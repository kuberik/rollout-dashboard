/**
 * THE READY=FALSE BANNER (owner 2026-11-21: "Add it to the banner"). When the controller sets the Rollout's
 * `Ready` condition False, the rollout page's banner names the reason and the message, e.g.
 *   Deploy refused · HelmReleaseFieldConflict on spec.values.image.tag, also set by gitops-demo
 * Before this the refusal was visible only through `kubectl describe`; the page showed "Held" or nothing.
 *
 * Which reasons it speaks for: EVERY Ready=False reason, except the ones another banner on the page already
 * states, so one fact is printed once:
 *   BakeTimeFailed, BakeTimeRetrying  -> FailurePanel (the failing / failed banner)
 *   NoReleases (+ the legacy RolloutSucceeded/"No releases available" shape) -> ReleaseSourceNotice
 *   NoReleaseCandidates while a gate holds -> the held banner (the hold IS why nothing is a candidate)
 *
 * Kinds: a write the controller refused to make (a field conflict, an annotation it cannot apply) is
 * "Deploy refused"; any other reason (RolloutFailed, GateListFailed, HealthCheckListFailed, a reason a newer
 * controller adds) is "Not ready". The first line is short; the controller's whole message (object, fix hint)
 * is the banner's disclosed footnote when the line shortened it.
 *
 * Controller source of the messages: rollout-controller internal/controller/helmrelease_write.go
 * `describeFieldConflict` ("<Kind> <ns/name>: <path> is also set by "<manager>". <hint>") and
 * `updateRolloutStatusOnError`.
 */

type Cond = { type: string; status: string; reason?: string; message?: string; lastTransitionTime?: string };

export type ReadyIssue = {
	kind: 'refused' | 'not-ready';
	reason: string;
	/** the banner's headline */
	title: string;
	/** the printed consequence line */
	line: string;
	/** the controller's full message, disclosed; null when `line` already is the whole message */
	detail: string | null;
	since: string | null;
};

/** reasons another banner on the rollout page already states */
const OWNED_ELSEWHERE = new Set(['BakeTimeFailed', 'BakeTimeRetrying', 'NoReleases']);
const LEGACY_NO_RELEASES = { reason: 'RolloutSucceeded', message: 'No releases available' };
/** the controller's write refusals: rollout-controller `deployWriteIssue` reasons */
const REFUSED = /(?:FieldConflict|InvalidAnnotation)$/;
/** describeFieldConflict's shape */
const CONFLICT = /^(\S+) (\S+): (\S+) is also set by (?:"([^"]+)"|another field manager)\.\s*([\s\S]*)$/;
/** a "<Kind> <ns/name>: " lead the controller puts on every write issue */
const OBJECT_LEAD = /^(?:HelmRelease|Kustomization|OCIRepository) \S+: /;
/** the legacy shared manager another rollout wrote under: rollout-controller/<namespace>/<rollout> */
const OTHER_ROLLOUT = /^rollout-controller\/[^/]+\/([^/]+)$/;

/** who the conflict names, as a person says it: another rollout by its name, else the field manager */
export function managerName(manager: string | undefined): string {
	if (!manager) return 'another field manager';
	const m = OTHER_ROLLOUT.exec(manager);
	return m ? `Rollout ${m[1]}` : manager;
}

/** a field path wraps only at its "." separators on a phone (a zero-width space after each dot inside a word), never mid-segment (design R1-DES-1) */
export const breakAtDots = (s: string): string => s.replace(/\.(?=[A-Za-z0-9_])/g, '.\u200B');

export function readyIssue(conditions: readonly Cond[] | null | undefined, o: { held?: boolean } = {}): ReadyIssue | null {
	const c = conditions?.find((x) => x.type === 'Ready');
	if (!c || c.status !== 'False') return null;
	const reason = c.reason?.trim() || 'Unknown';
	const message = (c.message ?? '').trim();
	if (OWNED_ELSEWHERE.has(reason)) return null;
	if (reason === LEGACY_NO_RELEASES.reason && message === LEGACY_NO_RELEASES.message) return null;
	if (reason === 'NoReleaseCandidates' && o.held) return null;

	const since = c.lastTransitionTime ?? null;
	const refused = REFUSED.test(reason);
	const title = refused ? 'Deploy refused' : 'Not ready';
	const conflict = CONFLICT.exec(message);
	if (conflict) {
		const [, , , path, manager] = conflict;
		return { kind: refused ? 'refused' : 'not-ready', reason, title, line: `${reason} on ${path}, also set by ${managerName(manager)}`, detail: message, since };
	}
	const body = message.replace(OBJECT_LEAD, '');
	const line = body ? `${reason}: ${body}` : reason;
	return { kind: refused ? 'refused' : 'not-ready', reason, title, line, detail: body !== message ? message : null, since };
}
