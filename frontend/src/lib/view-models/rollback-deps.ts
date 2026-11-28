/**
 * ROLLBACK AND THE DEPENDENCIES AROUND IT, AS THE DASHBOARD SAYS IT.
 *
 * Reads only what the controller records: `status.autoRollback` (where an automatic rollback would go for the newest
 * deploy), `status.history[].autoRollback` (how a rollback target was chosen, or what blocked one), the `AutoRollback`
 * condition's reason (`ConsumerRequires` / `TargetRequires`) and `RolloutDependency.spec.providerRollback`. Never parses
 * a condition message: every sentence here is built from the structured breaks.
 *
 * One function per surface, so a fact reads the same everywhere it is drawn:
 *   blockedWhy / breakRows        the failed-deploy banner, and the dialog's warning (`rollbackWarning`)
 *   nowSafeView                   the banner when the consumer has since moved
 *   skippedLine                   the "Rolled back automatically" panel
 *   previewLine                   the line under a baking build
 *   historyBlockedNote / historyRolledBackNote   History
 *   protectingConsumers           the mark on the provider -> consumer link and the Gates tab rows
 *
 * Names: a build is its OCI version when it has one, else its tag. A break names the build the consumer RUNS
 * (`version`), the constraint it needs (`requires`, verbatim) and the contract (`contract`).
 */
import type { DependencyBreak, RollbackSelection, Rollout } from '../../types';
import type { DetailRow } from './detail-rows';
import { rolloutPath } from '../source-dashboard';

type Status = NonNullable<Rollout['status']>;
type HistoryEntry = NonNullable<Status['history']>[number];

const MAX_NAMED = 2;
const clip = <T>(a: T[]): { shown: T[]; rest: number } => ({ shown: a.slice(0, MAX_NAMED), rest: Math.max(0, a.length - MAX_NAMED) });

/** the name a build is shown by: the OCI version when the history knows one for this tag, else the tag */
export function buildName(r: Rollout | null | undefined, tag: string | null | undefined): string {
	if (!tag) return '';
	for (const e of r?.status?.history ?? []) if (e.version?.tag === tag) return e.version.version || tag;
	return tag;
}

const nameList = (names: string[]): string => {
	const uniq = [...new Set(names)];
	if (uniq.length <= 1) return uniq.join('');
	return `${uniq.slice(0, -1).join(', ')} and ${uniq[uniq.length - 1]}`;
};

/** `checkout` for a break; the same consumer on two contracts is one name */
export const breakNames = (breaks: DependencyBreak[]): string[] => [...new Set(breaks.map((b) => b.rollout))];

const blocking = (breaks: DependencyBreak[] | null | undefined) => (breaks ?? []).filter((b) => b.kind === 'TargetRequires' || !b.allowed);
const isTarget = (b: DependencyBreak) => b.kind === 'TargetRequires';

/** the controller stores at most this many breaks (MaxItems=8): a list that long may have been cut */
export const BREAK_CAP = 8;
/** how many phrases one skipped build lists before "and N more" (the controller's maxVerdictsListed) */
const PHRASES_LISTED = 3;


/** what a TargetRequires break means for the target, as a verb phrase (controller `targetDetail`): "needs ledger ^5.0.0 but ledger-books serves 6.0.0" */
function targetDetail(b: DependencyBreak): string {
	if (b.reason === 'RequirementUnreadable' || !b.requires) return 'has no readable requirements';
	return `needs ${b.contract} ${b.requires} but ${b.rollout} serves ${b.version || 'nothing yet'}`;
}

/** one broken dependency from the consumer's side (controller `breakPhrase`): "checkout needs ledger ^6.0.0" */
function breakPhrase(b: DependencyBreak): string {
	if (b.reason === 'RequirementUnreadable') return `${b.rollout}'s running build has no readable requirements`;
	return b.requires ? `${b.rollout} needs ${b.contract} ${b.requires}` : `${b.rollout} cannot run it`;
}

/**
 * WHY a failed build was not rolled back when no safe earlier build exists (reason ConsumerRequires | TargetRequires), as the
 * banner's one line: what rolling back would do to the user. What each consumer needs is drawn under it (`BreakRows`).
 *   Rolling back would break checkout
 *   Rolling back would break checkout, billing and 1 more
 *   No earlier build can run against its providers
 */
export function blockedWhy(breaks: DependencyBreak[] | null | undefined, code = false): string {
	const names = breakNames(blocking(breaks).filter((b) => !isTarget(b)));
	if (names.length === 0) return 'No earlier build can run against its providers';
	const { shown, rest } = clip(names);
	/* `code`: each service name is marked `like this`, so the banner draws it in the code role and it never breaks at its hyphen */
	const marked = code ? shown.map((n) => '`' + n + '`') : shown;
	return `Rolling back would break ${nameList(marked.concat(rest > 0 ? [`${rest} more`] : []))}`;
}

/** a row is made of pieces; a piece is words and, where it carries one, a version or constraint (mono) */
export type Piece = { lead?: string; code?: string; tail?: string; code2?: string };
export type BreakRow = {
	key: string;
	/** the other rollout: the consumer (links to its page) or, for TargetRequires, the provider */
	name: string;
	namespace: string;
	/** the facts after the name, one piece each: `runs 3.2.0`, `needs ledger ^6.0.0`, `5.1.0 does not satisfy` (the row's title; the row itself is drawn from the fields below) */
	pieces: Piece[];
	/** the drawn row: `checkout [ledger|^6.0.0] -> [5.1.0] x` (consumer: what it needs, then the build that does not serve it) or `ledger-books [ledger|6.0.0] -> [^5.0.0] x` (provider: what it serves, then what the build needs) */
	contract: string;
	left: string;
	right: string;
	/** the same facts as plain strings, name first */
	parts: string[];
	text: string;
};

/** the banner's narrow toggle when it opens on what a rollback would break: a count, never a sentence ("2 services would break") */
export function servicesBreakLabel(n: number): string {
	return `${n} ${n === 1 ? 'service' : 'services'} would break`;
}

/**
 * What a rollback would break, as the report banner's Details rows (`Banner`): the consumer (a link to its rollout, text
 * for this rollout itself), a state word where the rows say why they are there, and what it runs and needs.
 */
export function breakDetailRows(rows: BreakRow[], cluster: string, self = '', tag?: string): DetailRow[] {
	return rows.map((r) => ({
		key: (tag ?? '') + r.key,
		name: r.name,
		mono: true,
		tag,
		tone: 'muted' as const,
		text: r.parts.slice(1).join(' \u00b7 '),
		title: r.text,
		href: r.namespace && r.name !== self ? rolloutPath(cluster, r.namespace, r.name) : undefined
	}));
}

/** the rerouted banner's narrow toggle: "1 skipped build" */
export function skippedBuildsLabel(n: number): string {
	return `${n} skipped ${n === 1 ? 'build' : 'builds'}`;
}

const pieceText = (p: Piece) => `${p.lead ?? ''}${p.code ?? ''}${p.tail ?? ''}${p.code2 ?? ''}`;

/** one row per break: `checkout · runs 3.2.0 · needs ^6.0.0 · 5.1.0 does not satisfy` */
export function breakRows(breaks: DependencyBreak[], target: string): BreakRow[] {
	return breaks.map((b, i) => {
		const pieces: Piece[] = [];
		if (isTarget(b)) {
			pieces.push(b.version ? { lead: 'serves ', code: b.version } : { lead: 'serves nothing yet' });
			if (b.requires) pieces.push({ code: target, tail: ` needs ${b.contract} `, code2: b.requires });
			else pieces.push({ code: target, tail: ' has no readable requirements' });
		} else {
			if (b.version) pieces.push({ lead: 'runs ', code: b.version });
			if (b.deployKind === 'ForceDeploy' || b.deployKind === 'Pin') pieces.push({ lead: 'deployed by hand' });
			if (b.reason === 'RequirementUnreadable') pieces.push({ lead: 'requirements unreadable' });
			else {
				if (b.requires) pieces.push({ lead: `needs ${b.contract} `, code: b.requires });
				pieces.push({ code: target, tail: b.reason === 'InvalidVersion' ? ' cannot be compared' : ' does not satisfy' });
			}
		}
		const parts = [b.rollout, ...pieces.map(pieceText)];
		const unreadable = b.reason === 'RequirementUnreadable' || !b.requires;
		const need = unreadable ? '?' : (b.requires ?? '?');
		const [left, right] = isTarget(b) ? [b.version || '?', need] : [need, target];
		return { key: `${b.kind}/${b.namespace}/${b.rollout}/${b.contract}/${i}`, name: b.rollout, namespace: b.namespace, pieces, parts, text: parts.join(' \u00b7 '), contract: b.contract, left, right };
	});
}

const cond = (r: Rollout | null | undefined) => r?.status?.conditions?.find((c) => c.type === 'AutoRollback');

/** the controller's blocked-selection for the failed head: the recorded one on the entry, else the live preview for that build */
export function blockedSelection(r: Rollout | null | undefined): RollbackSelection | null {
	const head = r?.status?.history?.[0];
	if (!head) return null;
	const live = r?.status?.autoRollback;
	if (head.autoRollback?.blockedBy?.length) return head.autoRollback;
	if (live && live.for === head.version?.tag && (live.blockedBy?.length || live.target)) return live;
	return null;
}

export type NowSafe = {
	/** the build a rollback would go to */
	target: string;
	targetTag: string;
	headline: string;
	/** the consumers whose requirement the target now satisfies, for the row list */
	consumers: string[];
};

/** the live preview's account of a consumer that moved: its build now, and what that build needs of the contract */
export type ConsumerNow = { version?: string; requires?: string };

/**
 * The block has lifted: the preview for this very failed build now has a target and nothing blocks it, though the decision
 * is made once and nothing rolls back by itself. `lookup` reads the consumer's current build (the dashboard has every rollout);
 * without it the sentence names the consumer and says it moved.
 */
export function nowSafeView(r: Rollout | null | undefined, lookup?: (namespace: string, name: string, contract: string) => ConsumerNow | null): NowSafe | null {
	const head = r?.status?.history?.[0];
	const live = r?.status?.autoRollback;
	const c = cond(r);
	if (!head || !live || head.bakeStatus !== 'Failed' || c?.status !== 'False') return null;
	if (live.for !== head.version?.tag || !live.target || (live.blockedBy?.length ?? 0) > 0) return null;
	const was = head.autoRollback?.blockedBy ?? [];
	if (was.length === 0) return null;
	const target = buildName(r, live.target) || live.target;
	const first = was[0];
	const now = lookup?.(first.namespace, first.rollout, first.contract) ?? null;
	const more = breakNames(was).length - 1; // consumers the preview no longer blocks on, named
	const tail = now?.version ? ` moved to \`${now.version}\`` : ' moved';
	return { target, targetTag: live.target, consumers: breakNames(was), headline: `Rollback to \`${target}\` is now safe: ${first.rollout}${more > 0 ? ` and ${more} more` : ''}${tail}` };
}


/** what stopped one skipped build, the controller's phrases ("checkout needs ledger ^6.0.0", "it needs ledger ^5.0.0 but ledger-books serves 6.0.0"), a few then "and N more" */
function skippedReason(breaks: DependencyBreak[]): string {
	if (breaks.length === 0) return 'it would break a dependency';
	const phrases = breaks.map((b) => (isTarget(b) ? `it ${targetDetail(b)}` : breakPhrase(b)));
	return phrases.length <= PHRASES_LISTED ? phrases.join(', ') : `${phrases.slice(0, PHRASES_LISTED).join(', ')} and ${phrases.length - PHRASES_LISTED} more`;
}

/** the skipped builds as drawn rows for the "Rolled back automatically" panel: `Skipped [5.1.0]`, then one `BreakRows` row per break */
export function skippedBreakRows(sel: RollbackSelection | null | undefined): { build: string; rows: BreakRow[] }[] {
	return (sel?.skipped ?? []).map((s) => ({ build: s.version || s.tag, rows: breakRows(s.breaks, s.version || s.tag) }));
}

/** the skipped builds as Details rows: one per break (the consumer, what it runs and needs) */
export function skippedDetailRows(sel: RollbackSelection | null | undefined, cluster: string, self = ''): DetailRow[] {
	return skippedBreakRows(sel).flatMap((sk) => breakDetailRows(sk.rows, cluster, self));
}

/** the banner's clause for the skipped builds, the first named in the code role: "skipped `5.1.0` and 1 more"; '' when nothing was skipped */
export function skippedSentence(sel: RollbackSelection | null | undefined): string {
	const sk = sel?.skipped ?? [];
	if (sk.length === 0) return '';
	return `skipped \`${sk[0].version || sk[0].tag}\`${sk.length > 1 ? ` and ${sk.length - 1} more` : ''}`;
}

/** "Skipped 5.1.0: checkout needs ledger ^6.0.0." (the drawn rows' title), one sentence per skipped build as the controller says it; null when nothing was skipped */
export function skippedLine(sel: RollbackSelection | null | undefined): string | null {
	const sk = sel?.skipped ?? [];
	if (sk.length === 0) return null;
	return sk.map((s) => `Skipped ${s.version || s.tag}: ${skippedReason(s.breaks)}.`).join(' ');
}

/**
 * The line under a baking build (never when there is nothing to say: the norm is not painted). Glanceable: where a failure
 * would go, or what rolling back would break; the reasons are on the Gates tab.
 *   Rollback goes to 6.0.2, skipping 5.1.0
 *   Rolling back would break checkout
 *   No earlier build can run against its providers
 */
export function previewLine(r: Rollout | null | undefined): string | null {
	const head = r?.status?.history?.[0];
	const live = r?.status?.autoRollback;
	if (!head || !live || live.for !== head.version?.tag) return null;
	if (head.bakeStatus === 'Failed' || head.bakeStatus === 'Succeeded') return null;
	if (live.target) {
		const sk = live.skipped ?? [];
		if (sk.length === 0) return null;
		const { shown, rest } = clip(sk);
		const builds = nameList(shown.map((s) => s.version || s.tag).concat(rest > 0 ? [`${rest} more`] : []));
		return `Rollback goes to ${buildName(r, live.target)}, skipping ${builds}`;
	}
	const bb = blocking(live.blockedBy);
	if (bb.length === 0) return null;
	return blockedWhy(bb);
}

/** History, the reason beside "Not rolled back" on a failed entry a dependency kept from rolling back: "Rolling back would break checkout" */
export function historyBlockedNote(entry: HistoryEntry | null | undefined): string | null {
	const bb = blocking(entry?.autoRollback?.blockedBy);
	if (bb.length === 0 || entry?.autoRollback?.target) return null;
	return blockedWhy(bb);
}

/** History, the part of a rollback entry that says what it passed over: "skipped 5.1.0 (checkout needs ^6.0.0)"; null when nothing was skipped */
export function historySkippedTail(entry: HistoryEntry | null | undefined): string | null {
	const sk = entry?.autoRollback?.skipped ?? [];
	if (entry?.deployKind !== 'AutoRollback' || sk.length === 0) return null;
	const { shown, rest } = clip(sk);
	const one = (s: (typeof sk)[number]) => {
		const b = s.breaks[0];
		const why = !b ? 'would break a dependency' : b.reason === 'RequirementUnreadable' || !b.requires ? `would break ${b.rollout}` : `${b.rollout} needs ${b.contract} ${b.requires}`;
		return `${s.version || s.tag} (${why})`;
	};
	return `skipped ${shown.map(one).join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`;
}

/** History row, the short form: the builds an automatic rollback passed over ("skipped 5.1.0"), each set in mono by the row; the reasons go in the row's title (historySkippedTail). null when none */
export function historySkippedBuilds(entry: HistoryEntry | null | undefined): { builds: string[]; rest: number } | null {
	const sk = entry?.autoRollback?.skipped ?? [];
	if (entry?.deployKind !== 'AutoRollback' || sk.length === 0) return null;
	const { shown, rest } = clip(sk);
	return { builds: shown.map((s) => s.version || s.tag), rest };
}

/** History, an automatic rollback entry that passed over builds: "Rolled back to 6.0.2 \u00b7 skipped 5.1.0 (checkout needs ^6.0.0)"; null when none were skipped */
export function historyRolledBackNote(entry: HistoryEntry | null | undefined): string | null {
	const tail = historySkippedTail(entry);
	return tail ? `Rolled back to ${entry?.version?.version || entry?.version?.tag} \u00b7 ${tail}` : null;
}

/** a consumer the provider's block is protecting right now: the mark on the provider -> consumer link */
export type Protected = { namespace: string; name: string; contract: string };

/**
 * The consumers a provider's failed build is being held for. Active only while the head failed, the controller named
 * ConsumerRequires and the blockers have not cleared (a preview for this build that shows a target and no blockers is "now safe").
 */
export function protectingConsumers(r: Rollout | null | undefined): Protected[] {
	const head = r?.status?.history?.[0];
	const c = cond(r);
	if (!head || head.bakeStatus !== 'Failed' || c?.status !== 'False' || c.reason !== 'ConsumerRequires') return [];
	const live = r?.status?.autoRollback;
	const list = live && live.for === head.version?.tag ? (live.blockedBy ?? []) : (head.autoRollback?.blockedBy ?? []);
	return blocking(list)
		.filter((b) => b.kind === 'ConsumerRequires')
		.map((b) => ({ namespace: b.namespace, name: b.rollout, contract: b.contract }));
}

/** the failed build the provider holds, for "ledger-core 7.0.0 failed and was not rolled back" */
export function heldBuildName(r: Rollout | null | undefined): string {
	const head = r?.status?.history?.[0];
	return head?.version?.version || head?.version?.tag || '';
}

/** the mark on the provider side of an edge, worded as the provider node's note: "Kept on 7.0.0 so checkout keeps working" */
export function protectingMark(r: Rollout | null | undefined, consumerName: string): string {
	return protectedConsumersNote(r, [consumerName]);
}

/** the provider node's one note, what the block means for the people on the other side: "Kept on 6.0.0 so checkout and billing keep working" */
export function protectedConsumersNote(r: Rollout | null | undefined, consumers: string[]): string {
	const { shown, rest } = clip([...new Set(consumers)]);
	const names = shown.concat(rest > 0 ? [`${rest} more`] : []);
	return `Kept on ${heldBuildName(r)} so ${nameList(names)} keep${names.length === 1 && rest === 0 ? 's' : ''} working`;
}

/** the consumer's side of the same block, on the provider's own row (which already names the provider): "Stays on 7.0.0 for this service" */
export function protectedByMark(build: string): string {
	return `Stays on ${build} for this service`;
}

/** the provider's per-consumer verdict on the Gates tab, on the consumer's own row (which already names it): "A rollback to 5.1.0 would break this" */
export function rollbackVerdict(targetName: string): string {
	return `A rollback to ${targetName} would break this`;
}


/**
 * The Roll back dialog's warning for the build the person picked: never a refusal. One sentence; who would break and what they
 * need are drawn under it (`BreakRows` from `breakRows`).
 *   5.1.0 would break 1 consumer.
 *   5.1.0 would break 3 consumers, 2 you can't see.
 *   5.1.0 can't run against its providers.
 * Edges that allow it are not warned about (the person has already said that is fine). `hidden` counts breaking consumers in
 * namespaces the viewer cannot list: they are not named, only counted. Null when nothing blocks.
 */
export function rollbackWarning(target: string, breaks: DependencyBreak[] | null | undefined, hidden = 0): string | null {
	const w = rollbackWarningParts(target, breaks, hidden);
	return w ? [w.lead, w.rest].filter(Boolean).join(' ') : null;
}

/** the warning's sentence (`lead`, full ink) and the breaks to draw under it (`rows`); `rest` stays for the dialog's callout shape and is empty */
export function rollbackWarningParts(target: string, breaks: DependencyBreak[] | null | undefined, hidden = 0): { lead: string; rest: string; rows: BreakRow[] } | null {
	const bb = blocking(breaks);
	if (bb.length === 0 && hidden <= 0) return null;
	const cons = breakNames(bb.filter((b) => !isTarget(b))).length;
	const n = cons + Math.max(0, hidden);
	const unseen = hidden > 0 ? `, ${hidden} you can't see` : '';
	const lead = n > 0 ? `${target} would break ${n} consumer${n === 1 ? '' : 's'}${unseen}.` : `${target} can't run against its providers.`;
	return { lead, rest: '', rows: breakRows(bb, target) };
}

/** the consumer's build now, read off the fleet: what it runs and what that build needs of the contract (for "now safe") */
export function consumerNowLookup(fleet: Rollout[] | null | undefined): (namespace: string, name: string, contract: string) => ConsumerNow | null {
	return (namespace, name, contract) => {
		const r = (fleet ?? []).find((x) => x.metadata?.namespace === namespace && x.metadata?.name === name);
		const v = r?.status?.history?.[0]?.version as { version?: string; tag?: string; requires?: Record<string, string> } | undefined;
		if (!v) return null;
		return { version: v.version || v.tag, requires: v.requires?.[contract] };
	};
}

/**
 * The provider's Gates tab, per consumer: what a rollback would break, read from the same selection the banner and the
 * preview read (the block while it stands, else the preview for the build baking now). consumer name -> "a rollback to 5.1.0 would break checkout".
 */
export function consumerVerdicts(r: Rollout | null | undefined): Map<string, string> {
	const out = new Map<string, string>();
	const head = r?.status?.history?.[0];
	const live = r?.status?.autoRollback;
	const sel = protectingConsumers(r).length > 0 ? blockedSelection(r) : live && live.for === head?.version?.tag && head?.bakeStatus !== 'Succeeded' ? live : null;
	if (!sel) return out;
	const usual = buildName(r, sel.usualTarget);
	for (const b of blocking(sel.blockedBy)) if (b.kind === 'ConsumerRequires' && !out.has(b.rollout)) out.set(b.rollout, rollbackVerdict(usual));
	for (const s of sel.skipped ?? []) for (const b of blocking(s.breaks)) if (b.kind === 'ConsumerRequires' && !out.has(b.rollout)) out.set(b.rollout, rollbackVerdict(s.version || s.tag));
	return out;
}
