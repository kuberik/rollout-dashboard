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
			return 'Rules bypassed';
		case 'Unblock':
			return 'Unblocked';
		default:
			return null;
	}
}

/** deployed by a person's explicit choice: the controller never rolls these back (force deploy, pin) */
export const deployedByHand = (kind: string | undefined | null): boolean => kind === 'ForceDeploy' || kind === 'Pin';

const KIND_WORD: Record<string, string> = {
	Alert: 'Alert',
	Incident: 'Incident',
	ApplyFailed: 'Apply failed',
	NotReady: 'Not ready',
	TestFailed: 'Test failed',
	CheckError: 'Check error',
	Unclassified: 'Failed'
};
/** the failure kind as display text; the controller keeps `kind` as a hint only, so a missing one reads "Failed" */
export const kindWord = (k: string | undefined): string => (k ? (KIND_WORD[k] ?? k) : 'Failed');

/** a failure's severity; the controller fills it, and an entry written before severities existed counts as Critical */
export const severityOf = (f: Pick<Failure, 'severity'>): 'Critical' | 'Warning' => (f.severity === 'Warning' ? 'Warning' : 'Critical');

/** WHY a failure does or does not roll back, in the user's words (the row's title) */
export function whyWords(f: Pick<Failure, 'why' | 'rollsBack' | 'severity'>): string {
	switch (f.why) {
		case 'AtOrAboveThreshold':
			return `${severityOf(f)}, at or above the rollout's severity`;
		case 'BelowThreshold':
			return `${severityOf(f)}, below the rollout's severity`;
		case 'CheckErrorNever':
			return 'a check that cannot run never rolls back';
		case 'PredatesDeploy':
			return 'it started failing before this deploy';
		default:
			return f.rollsBack ? 'rolls back' : 'does not roll back';
	}
}

/** the reason in one or two words beside a verdict: the severity, or the rule when the severity did not decide */
export function shortWhy(f: Pick<Failure, 'why' | 'severity'>): string {
	switch (f.why) {
		case 'CheckErrorNever':
			return 'check error';
		case 'PredatesDeploy':
			return 'before deploy';
		default:
			return severityOf(f);
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
	kind?: string;
	/** Critical | Warning */
	severity: 'Critical' | 'Warning';
	rollsBack: boolean;
	/** "rolls back" | "does not roll back" */
	word: string;
	/** "Test failed · Warning, below the rollout's severity" */
	why: string;
	/** the controller's rule, verbatim (`AtOrAboveThreshold`, `BelowThreshold`, `CheckErrorNever`, `PredatesDeploy`) */
	rule: string;
	/** one or two words beside the verdict: the severity, or "check error" / "before deploy" */
	short: string;
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
				severity: severityOf(f),
				rollsBack: f.rollsBack,
				word: f.rollsBack ? 'rolls back' : 'does not roll back',
				why: `${kindWord(f.kind)} · ${whyWords(f)}`,
				rule: f.why,
				short: shortWhy(f),
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
			/** the condition's reason: NotATrigger | Blocked | ManualDeploy | ManualIntent | NoTarget | DeployError */
			reason: string;
			/** state word + reason in one string (titles, aria); the banner draws `why` as its one line */
			headline: string;
			/** the reason alone, one short line */
			why: string;
			failed: HistoryEntry;
			rows: VerdictRow[];
			message?: string;
	  };

const display = (e: HistoryEntry | undefined): string => e?.version?.version || e?.version?.tag || e?.version?.revision || 'this build';

/**
 * WHY a failed bake was NOT rolled back, as one short line (glanceable rule: at most 12 words). The state itself
 * ("Not rolled back") is a separate word the banner draws as a chip, so this never repeats it.
 */
export function notRolledBackWhy(reason: string, failed: HistoryEntry, rows: VerdictRow[]): string {
	switch (reason) {
		case 'ManualDeploy':
			return 'Deployed by hand';
		case 'ManualIntent':
			return 'A deploy was already requested by hand';
		case 'NoTarget':
			return 'No earlier build passed its bake';
		case 'DeployError':
			return 'The rollback deploy could not be written';
		case 'Blocked':
			return 'No earlier build is safe to roll back to';
		case 'NotATrigger': {
			const names = rows.filter((r) => !r.rollsBack);
			if (names.length === 1) return `${shortRef(names[0].ref)} failed`; // the severity is the row's chip; said once
			if (names.length > 1) return `${names.length} failures, none severe enough`;
			return `${display(failed)} failed for a reason that does not roll back`;
		}
		default:
			return '';
	}
}

/** the state word plus its reason, joined for places that print one string (aria labels, titles) */
export function notRolledBackHeadline(reason: string, failed: HistoryEntry, rows: VerdictRow[]): string {
	const why = notRolledBackWhy(reason, failed, rows);
	return why ? `Not rolled back · ${why}` : 'Not rolled back';
}

/** one compact row for a banner's right column: glyph, name, verdict chip (never a sentence) */
export type GlanceRow = { key: string; cls: string; name: string; verdict: string; tone: 'danger' | 'muted' | 'neutral'; title?: string };

/**
 * Verdict rows as glance rows: the chip is the failure's severity (or "check error" / "before deploy" when the severity
 * did not decide). `ran`: the rollback happened, so a trigger is drawn in danger ink; otherwise neutral.
 */
export function glanceRows(rows: VerdictRow[], ran: boolean): GlanceRow[] {
	return rows.map((r) => ({
		key: r.key,
		cls: r.cls,
		name: shortRef(r.ref),
		verdict: r.short,
		tone: r.rollsBack ? (ran ? 'danger' : 'neutral') : 'muted',
		title: `${r.type ? `${r.type} ${r.ref}` : r.ref} · ${r.why}${r.message ? ` · ${r.message}` : ''}`
	}));
}

/** which failure triggered a rollback, in a few words: `smoke failed`, `smoke and 1 more failed` */
export function triggerLine(triggers: VerdictRow[]): string {
	if (triggers.length === 0) return '';
	const first = shortRef(triggers[0].ref);
	return triggers.length === 1 ? `${first} failed` : `${first} and ${triggers.length - 1} more failed`;
}

/**
 * The one line under a rolled-back banner's chips: the trigger, then what the hold DOES (owner, 2026-11-26: "held" does
 * not say what is happening; say it where it acts). At most 12 words.
 */
export function rolledBackLine(triggers: VerdictRow[], failedName: string, held: boolean): string {
	return [triggerLine(triggers), held ? `${failedName} won't auto-deploy again` : ''].filter(Boolean).join(' · ');
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
		return { state: 'not-rolled-back', reason: c.reason, headline: notRolledBackHeadline(c.reason, head, rows), why: notRolledBackWhy(c.reason, head, rows), failed: head, rows, message: c.message };
	}
	return null;
}

/** the controller's hold: this build's newest attempt on this Rollout failed its bake, so automatic selection skips it until a person names it */
export function failedBakeHeld(r: Rollout | null | undefined, tag: string): boolean {
	return !!r?.status?.candidates?.find((c) => c.tag === tag)?.failedBake;
}

/**
 * Did the controller actually roll this failed entry back? Only when a later history entry is an automatic rollback whose
 * `rollbackOf` names this entry. Every other failed entry (rollout not opted in, deployed by hand, skipped as ManualIntent,
 * NoTarget, DeployError, or recorded before deploy kinds existed) was NOT rolled back, so its verdicts read conditionally.
 */
export function entryRolledBack(r: Rollout | null | undefined, entry: HistoryEntry | null | undefined): boolean {
	if (entry?.id == null) return false;
	return (r?.status?.history ?? []).some((e) => e.deployKind === 'AutoRollback' && e.rollbackOf != null && e.rollbackOf === entry.id);
}

/**
 * The one line on a failed History entry: a state word and, at most, a short reason. The verdict rows sit behind
 * Details. `ran` is true only when it rolled back; otherwise a failure that "rolls back" is drawn as "would roll back"
 * in muted ink. The collapsed row already says "Rolled back automatically", so a rolled-back entry names the trigger.
 */
export type EntryRollbackNote = { ran: boolean; word: string; why: string; note: string };
const noteOf = (ran: boolean, word: string, why = ''): EntryRollbackNote => ({ ran, word, why, note: why ? `${word} · ${why}` : word });

export function entryRollbackNote(r: Rollout | null | undefined, entry: HistoryEntry): EntryRollbackNote {
	const rows = verdictRows(entry);
	if (entryRolledBack(r, entry)) return noteOf(true, 'Rolled back', triggerLine(rows.filter((x) => x.rollsBack)));
	if (!r?.spec?.autoRollback) return noteOf(false, rows.some((x) => x.rollsBack) ? 'Would roll back' : 'Not rolled back', 'Automatic rollback is off');
	if (deployedByHand(entry.deployKind)) return noteOf(false, 'Not rolled back', 'Deployed by hand');
	if (!entry.deployKind) return noteOf(false, 'Not rolled back', 'Deployed before rollback decisions were recorded');
	const head = r?.status?.history?.[0];
	const c = cond(r);
	if (head === entry && c?.status === 'False' && c.reason) return noteOf(false, 'Not rolled back', notRolledBackWhy(c.reason, entry, rows));
	return noteOf(false, 'Not rolled back');
}
