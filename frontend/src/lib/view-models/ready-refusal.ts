/**
 * THE READY=FALSE BANNER (owner 2026-11-21: "Add it to the banner"). When the controller sets the Rollout's
 * `Ready` condition False, the rollout page's banner names the reason and the message. A field conflict is DRAWN
 * (owner 2026-11-26: the prose form was "a wall of text"), one short next step under it, the rest behind Details:
 *   Deploy refused
 *   [HelmRelease|shop] spec.values.image.tag  [gitops-demo] → [kuberik] ✕
 *   Stop the other writer from setting it to continue.          › Details
 * Before this the refusal was visible only through `kubectl describe`; the page showed "Held" or nothing.
 *
 * Which reasons it speaks for: EVERY Ready=False reason, except the ones another surface on the rollout page already
 * states, so one fact is printed once (`OWNED_ELSEWHERE`; pinned by ready-refusal.test.ts and
 * ready-banner-page.svelte.test.ts):
 *   BakeTimeFailed         -> FailurePanel (the failing / failed banner; history[0].bakeStatus is Failed)
 *   BakeTimeRetrying       -> nothing to say: the retry someone just asked for; the deploy's own progress shows it
 *   ReleaseSourceRequired  -> ReleaseSourceNotice ("No release source"; the controller writes this reason on BOTH
 *                             ReleasesUpdated and Ready, rollout-controller rollout_slices.go blockOnRelease)
 *   NoReleases (+ the legacy RolloutSucceeded/"No releases available" shape) -> the builds card's "No releases yet"
 *                             (catalogue.ts noReleasesFrom, kind 'empty'); not a banner, ReleaseSourceNotice is for no source
 *   NoReleaseCandidates while a gate holds or a pin is set -> the held / pinned banner (that IS why nothing is a candidate)
 * ReleaseCatalogueUnavailable (the release-controller CRDs are not installed) has no other surface, so this banner
 * states it ("Not ready").
 *
 * Kinds: a write the controller refused to make (a field conflict, a HelmRelease whose Helm upgrade remediation another
 * tool keeps on, an annotation it cannot apply) is "Deploy refused"; any other reason (RolloutFailed, GateListFailed, HealthCheckListFailed, a reason a newer
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
	/** the printed consequence line, as plain text (copy, aria, tests) */
	line: string;
	/**
	 * a field conflict, DRAWN (glanceable-UI rule, owner 2026-11-26: "a wall of text"): the object (`kind` + `name`, e.g.
	 * HelmRelease shop), the contested path, and who else sets it — `[HelmRelease|shop] spec.values.image.tag [gitops-demo] → [kuberik] ✕`.
	 * `by` is the person-readable writer (`managerName`). The controller's message carries no values, so none are drawn. Null otherwise.
	 */
	conflict: {
		kind: string;
		name: string;
		path: string;
		by: string;
		/** the raw field manager the controller named (`by` is its readable form); null for an unnamed manager */
		manager: string | null;
		/** what the controller said after naming the writer (its fix hint), for the record; '' when it said nothing more */
		hint: string;
	} | null;
	/** one short next step (12 words or fewer): generic for a field conflict (owner 2026-11-25: no per-writer advice), its own
	 * for a remediation conflict (owner 2026-11-26); null for every other reason */
	nextStep: string | null;
	/** the controller's full message, disclosed; null when `line` already is the whole message */
	detail: string | null;
	since: string | null;
};

/** reasons another surface on the rollout page already states (see the table above) */
export const OWNED_ELSEWHERE: ReadonlySet<string> = new Set(['BakeTimeFailed', 'BakeTimeRetrying', 'ReleaseSourceRequired', 'NoReleases']);
/** the three conflict reasons the controller writes; deliberately one sentence for all of them */
const FIELD_CONFLICT = /FieldConflict$/;
export const CONFLICT_NEXT_STEP = 'Stop the other writer from setting it to continue.';
/** HelmReleaseRemediationConflict: kuberik turns Helm's upgrade remediation off, and another tool sets it to something else.
 * Setting the same values is a fix too, so the generic "stop setting it" is only half the answer. */
const REMEDIATION_CONFLICT = /RemediationConflict$/;
export const REMEDIATION_NEXT_STEP = 'Set it to 0, or remove it.';
/** remediateLastFailure is a boolean: "off" is false, not 0 */
export const REMEDIATION_LAST_FAILURE_NEXT_STEP = 'Set it to false, or remove it.';
const LEGACY_NO_RELEASES = { reason: 'RolloutSucceeded', message: 'No releases available' };
/** the controller's write refusals: rollout-controller `deployWriteIssue` reasons */
const REFUSED = /(?:FieldConflict|RemediationConflict|InvalidAnnotation)$/;
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

/**
 * A field path split after each "." so the page can put a `<wbr>` there: the path wraps only at its separators on a
 * phone, never mid-segment (design R1-DES-1), and a copied path is the plain path (R2-DES-1: break points are markup,
 * never characters in the string, as in DependencyNode / EventsCard / FactList).
 *   "spec.values.image.tag" -> ["spec.", "values.", "image.", "tag"]
 */
export const pathParts = (path: string): string[] => path.split(/(?<=\.)(?=[A-Za-z0-9_])/);

/** "a; b. c (d)" -> "a": the controller's hint up to its first `;`, sentence end or parenthesis */
export function firstClause(text: string): string {
	const cut = text.search(/;|\.\s|\s\(/);
	return (cut === -1 ? text : text.slice(0, cut)).replace(/\.$/, '');
}

/**
 * The banner's record (the right column at banner widths, `Details` on a phone): what the drawn row does not already say.
 * The reason code, the raw field manager when the row shows a friendlier name, the controller's own hint, and since when.
 */
export function readyFacts(issue: ReadyIssue, ago: (iso: string) => string): { label: string; value: string }[] {
	const facts: { label: string; value: string }[] = [{ label: 'Reason', value: issue.reason }];
	const c = issue.conflict;
	if (c?.manager && c.manager !== c.by) facts.push({ label: 'Field manager', value: c.manager });
	// Trimmed to its first clause: the record is a side column, not a second paragraph. The whole message is the row's title.
	if (c?.hint) facts.push({ label: 'Controller', value: firstClause(c.hint) });
	else if (!c && issue.detail) facts.push({ label: 'Controller', value: issue.detail });
	if (issue.since) facts.push({ label: 'Since', value: `${ago(issue.since)} ago` });
	return facts;
}

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
	let nextStep = REMEDIATION_CONFLICT.test(reason) ? REMEDIATION_NEXT_STEP : FIELD_CONFLICT.test(reason) ? CONFLICT_NEXT_STEP : null;
	const title = refused ? 'Deploy refused' : 'Not ready';
	const conflict = CONFLICT.exec(message);
	if (conflict) {
		const [, objKind, id, path, manager, hint] = conflict;
		const by = managerName(manager);
		if (nextStep === REMEDIATION_NEXT_STEP && path.endsWith('.remediateLastFailure')) nextStep = REMEDIATION_LAST_FAILURE_NEXT_STEP;
		const name = id.slice(id.indexOf('/') + 1);
		// The reason code and the controller's whole message are the disclosed record, never printed (glanceable-UI rule).
		return {
			kind: refused ? 'refused' : 'not-ready',
			reason,
			title,
			line: `${objKind} ${name} ${path}, also set by ${by}`,
			conflict: { kind: objKind, name, path, by, manager: manager ?? null, hint: hint.trim() },
			nextStep,
			detail: `${reason}: ${message}`,
			since
		};
	}
	const body = message.replace(OBJECT_LEAD, '');
	const line = body ? `${reason}: ${body}` : reason;
	return { kind: refused ? 'refused' : 'not-ready', reason, title, line, conflict: null, nextStep, detail: body !== message ? message : null, since };
}
