/**
 * AUTOMATIC ROLLBACK, AS THE ROLLOUT PAGE SAYS IT (preview, feat/auto-rollback).
 *
 * Reads only what the controller records: `spec.autoRollback`, the `AutoRollback` condition,
 * `status.history[].deployKind` / `rollbackOf`, `history[].failedHealthChecks[].failures[]` (one verdict per failed
 * source: does it roll back, and why) and `status.candidates[].failedBake` (the hold). Never parses a message; the
 * wording of a verdict comes from `kind` + `why`, the only two enums the controller promises.
 *
 * One rule per surface: the banner (`autoRollbackView`), a history row's label (`deployKindLabel`), a held build
 * (`failedBakeHeld`). A failed build is held for every Rollout (not only opted-in ones), so the hold does not read the spec.
 */
import type { Rollout } from '../../types';
import { classOf } from './health-failures';

type Status = NonNullable<Rollout['status']>;
export type HistoryEntry = NonNullable<Status['history']>[number];
type FailedCheck = NonNullable<HistoryEntry['failedHealthChecks']>[number];
type Failure = NonNullable<FailedCheck['failures']>[number];

export type DeployKind = NonNullable<HistoryEntry['deployKind']>;

/** the word on a history row for HOW a build was deployed; `Automatic` is the ordinary case and says nothing */
export function deployKindLabel(kind: string | undefined | null): string | null {
	switch (kind) {
		case 'AutoRollback':
			return 'Automatic rollback';
		case 'ForceDeploy':
			return 'Force deployed';
		case 'Pin':
			return 'Pinned';
		case 'GateBypass':
			return 'Gates bypassed';
		case 'Unblock':
			return 'Unblocked';
		default:
			return null;
	}
}

/** deployed by a person's explicit choice: the controller never rolls these back (force deploy, pin) */
export const deployedByHand = (kind: string | undefined | null): boolean => kind === 'ForceDeploy' || kind === 'Pin';

const KIND_PLURAL: Record<string, string> = {
	Alert: 'alerts',
	Incident: 'incidents',
	ApplyFailed: 'apply failures',
	NotReady: 'resources that are not ready',
	TestFailed: 'test failures',
	CheckError: 'check errors',
	Unclassified: 'unclassified failures'
};
const KIND_WORD: Record<string, string> = {
	Alert: 'Alert',
	Incident: 'Incident',
	ApplyFailed: 'Apply failed',
	NotReady: 'Not ready',
	TestFailed: 'Test failed',
	CheckError: 'Check error',
	Unclassified: 'Failed'
};
export const kindWord = (k: string): string => KIND_WORD[k] ?? k;

/** WHY a failure does or does not roll back, in the user's words; the opt-out names the annotation that did it */
export function whyWords(f: Pick<Failure, 'kind' | 'why' | 'rollsBack'>): string {
	const plural = KIND_PLURAL[f.kind] ?? 'these failures';
	switch (f.why) {
		case 'SourceOptedOut':
			return 'opted out with rollout.kuberik.com/rollback: false';
		case 'SourceOptedIn':
			return 'opted in with rollout.kuberik.com/rollback: true';
		case 'CheckErrorNever':
			return 'a check that cannot run never rolls back';
		case 'NotInRollbackOn':
			return `the check does not roll back on ${plural}`;
		case 'CheckRollbackOn':
			return `the check rolls back on ${plural}`;
		default:
			return f.rollsBack ? 'rolls back' : 'does not roll back';
	}
}

export type VerdictRow = {
	key: string;
	/** the failing check's class (the glyph) */
	cls: string;
	/** `RolloutTest` / `Kustomization` / ...: the source's own type, as the controller wrote it */
	type: string;
	/** `namespace/name` of the source, verbatim */
	ref: string;
	kind: string;
	rollsBack: boolean;
	/** "rolls back" | "does not roll back" */
	word: string;
	/** "Test failed · opted out with ..." */
	why: string;
	message?: string;
};

/** `RolloutTest hello-multi-dev/hello-worker-test` -> type + ref (a source with no space is all ref) */
export function splitSource(source: string): { type: string; ref: string } {
	const i = source.indexOf(' ');
	return i < 0 ? { type: '', ref: source } : { type: source.slice(0, i), ref: source.slice(i + 1) };
}

/** one row per failed source recorded on a history entry, the ones that roll back first */
export function verdictRows(entry: HistoryEntry | null | undefined): VerdictRow[] {
	const rows: VerdictRow[] = [];
	for (const c of entry?.failedHealthChecks ?? []) {
		for (const [i, f] of (c.failures ?? []).entries()) {
			const { type, ref } = splitSource(f.source);
			rows.push({
				key: `${c.namespace}/${c.name}/${f.source}/${i}`,
				cls: classOf({ spec: { class: c.class } } as never),
				type,
				ref,
				kind: f.kind,
				rollsBack: f.rollsBack,
				word: f.rollsBack ? 'rolls back' : 'does not roll back',
				why: `${kindWord(f.kind)} · ${whyWords(f)}`,
				message: f.message
			});
		}
	}
	return rows.sort((a, b) => Number(b.rollsBack) - Number(a.rollsBack));
}

const cond = (r: Rollout | null | undefined) => r?.status?.conditions?.find((c) => c.type === 'AutoRollback');

export type AutoRollbackView =
	| {
			state: 'rolled-back';
			/** the failed build the rollback replaced */
			failed: HistoryEntry;
			/** history[0]: the rollback deploy */
			rollback: HistoryEntry;
			target: string;
			triggers: VerdictRow[];
			spared: VerdictRow[];
			message?: string;
	  }
	| {
			state: 'not-rolled-back';
			/** the condition's reason: NotATrigger | ManualDeploy | ManualIntent | NoTarget | DeployError */
			reason: string;
			/** the sentence the banner leads with */
			headline: string;
			failed: HistoryEntry;
			rows: VerdictRow[];
			message?: string;
	  };

const display = (e: HistoryEntry | undefined): string => e?.version?.version || e?.version?.tag || e?.version?.revision || 'this build';

/** the sentence a failed bake leads with when it was NOT rolled back; ManualDeploy is the design's wording */
export function notRolledBackHeadline(reason: string, failed: HistoryEntry, rows: VerdictRow[]): string {
	switch (reason) {
		case 'ManualDeploy':
			return 'Not rolled back automatically: deployed by hand';
		case 'ManualIntent':
			return 'Not rolled back automatically: a deploy was already requested by hand';
		case 'NoTarget':
			return 'Not rolled back: no earlier build passed its bake';
		case 'DeployError':
			return 'Not rolled back: the rollback deploy could not be written';
		case 'NotATrigger': {
			const names = rows.filter((r) => !r.rollsBack);
			if (names.length === 1) return `Not rolled back: ${shortRef(names[0].ref)} failed, and it does not roll back`;
			if (names.length > 1) return `Not rolled back: none of the ${names.length} failures roll back`;
			return `Not rolled back: ${display(failed)} failed for a reason that does not roll back`;
		}
		default:
			return 'Not rolled back automatically';
	}
}

/** `ns/name` -> `name` */
export const shortRef = (ref: string): string => ref.slice(ref.lastIndexOf('/') + 1);

/** what the rollout page says about automatic rollback right now; null when the controller has said nothing (or it is not opted in) */
export function autoRollbackView(r: Rollout | null | undefined): AutoRollbackView | null {
	const c = cond(r);
	const history = r?.status?.history ?? [];
	const head = history[0];
	if (!c || !head) return null;
	if (c.status === 'True' && c.reason === 'RolledBack' && head.deployKind === 'AutoRollback') {
		const failed = history.find((e) => e.id != null && e.id === head.rollbackOf) ?? history[1];
		if (!failed) return null;
		const rows = verdictRows(failed);
		return { state: 'rolled-back', failed, rollback: head, target: display(head), triggers: rows.filter((x) => x.rollsBack), spared: rows.filter((x) => !x.rollsBack), message: c.message };
	}
	if (c.status === 'False' && head.bakeStatus === 'Failed') {
		const rows = verdictRows(head);
		return { state: 'not-rolled-back', reason: c.reason, headline: notRolledBackHeadline(c.reason, head, rows), failed: head, rows, message: c.message };
	}
	return null;
}

/** the controller's hold: this build's newest attempt on this Rollout failed its bake, so automatic selection skips it until a person names it */
export function failedBakeHeld(r: Rollout | null | undefined, tag: string): boolean {
	return !!r?.status?.candidates?.find((c) => c.tag === tag)?.failedBake;
}
