/**
 * r34 r3-approve — THE ONE APPROVE ACTION'S STATE. Every surface that shows the approval action (Rollouts In flight and rows,
 * Changes lead / rows / cards, Apps tiles and lead, Needs you, Environments and Envs, the rollout tab's Gates) calls
 * `askApprove(target, event)` and nothing else; `ApprovalLayer` (mounted once in the root layout) owns the confirm popover and the
 * after-state toast. Flow: ask -> confirm (one step, in the same surface) -> optimistic grant (data.ts applies it to the fixture,
 * every page re-derives) + one POST per place (src/lib/api/approvals.ts) -> toast "Approved · deploying" with Undo for 8 s.
 * A failed request rolls the optimistic grant back and says so.
 */
import { approvalTarget, grantApproval, revokeApproval, type ApprovalTarget, type HomeState, type TRow } from './data';
import { postApproval, rolloutOfHref, approvalsQueryKey, type ApprovalReply } from '$lib/api/approvals';
import { rolloutQueryKey } from '$lib/api/rollouts';
import { grantInRollout } from '$lib/view-models/approval-write';
import type { QueryClient } from '@tanstack/svelte-query';
import { approversWords } from '$lib/view-models/approval-identity';
import type { Act } from '$lib/components/ActRow.svelte';

export const UNDO_MS = 8000;

export const approvalUi = $state<{
	ask: { target: ApprovalTarget; anchor: { top: number; left: number; right: number; bottom: number } | null; trigger: HTMLElement | null } | null;
	/** `still`: an Undo that the server answered `stillApproved`: the build stays approved (by whom: `who`), nothing was reverted */
	done: { target: ApprovalTarget; error: string | null; still?: { who: string; title: string; headline: string } } | null;
}>({ ask: null, done: null });

/**
 * THE PLACE'S OWN COPY OF THE GATE. Home reads the fleet fixture (`grantApproval`), a place's page reads `['rollout', ns, name, cluster]`:
 * one click must write both, or the place says "held, releases when someone approves" under a toast that says it was approved.
 * `ApprovalLayer` installs the app's QueryClient; the grant patches each place's cached rollout (remembering what it replaced), Undo puts the
 * snapshot back, and once the requests settle the rollout and approvals queries are refetched (the real gate, and who approved).
 */
let qc: QueryClient | null = null;
export const installApprovalCache = (c: QueryClient | null): void => { qc = c; };
const cacheSnaps = new Map<string, { key: readonly unknown[]; data: unknown }[]>();
const keyOfPlace = (href: string): { rollout: readonly unknown[]; approvals: readonly unknown[] } | null => {
	const r = rolloutOfHref(href);
	return r ? { rollout: rolloutQueryKey(r.namespace, r.name, r.cluster), approvals: approvalsQueryKey(r.namespace, r.name, r.cluster) } : null;
};
export function patchPlaceCaches(t: ApprovalTarget): void {
	if (!qc) return;
	const snaps: { key: readonly unknown[]; data: unknown }[] = [];
	for (const p of t.places) {
		const k = keyOfPlace(p.href);
		const old = k && qc.getQueryData(k.rollout);
		if (!k || !old) continue;
		snaps.push({ key: k.rollout, data: old });
		qc.setQueryData(k.rollout, grantInRollout(old as never, p.tag));
	}
	cacheSnaps.set(t.key, snaps);
}
export function restorePlaceCaches(t: ApprovalTarget): void {
	if (!qc) return;
	for (const s of cacheSnaps.get(t.key) ?? []) qc.setQueryData(s.key, s.data);
	cacheSnaps.delete(t.key);
}
/** the server has answered: read the real gate and the real approvers (who approved) back */
export function refreshPlaceCaches(t: ApprovalTarget): void {
	if (!qc) return;
	for (const p of t.places) {
		const k = keyOfPlace(p.href);
		if (!k) continue;
		void qc.invalidateQueries({ queryKey: k.approvals });
		void qc.invalidateQueries({ queryKey: k.rollout });
	}
}

let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<unknown> = Promise.resolve();
const clearTimer = () => { if (timer) clearTimeout(timer); timer = null; };
/** the row's Approve button the confirm opened from; where focus returns when the toast goes (if it still exists) */
let returnTo: HTMLElement | null = null;
/** the toast keeps its 8 s only while nobody is on it: hovering or focusing it pauses, leaving restarts */
/** hover and focus are separate holds: the timer runs only when neither holds (a pointer leaving never closes the toast under a keyboard user on Undo) */
const holds = { hover: false, focus: false };
function syncTimer(): void {
	if (holds.hover || holds.focus) clearTimer();
	else if (approvalUi.done && !timer) timer = setTimeout(dismissDone, UNDO_MS);
}
export function holdDone(kind: 'hover' | 'focus', on: boolean): void { holds[kind] = on; syncTimer(); }
export const pauseDone = (kind: 'hover' | 'focus' = 'hover'): void => holdDone(kind, true);
export const resumeDone = (kind: 'hover' | 'focus' = 'hover'): void => holdDone(kind, false);
/** Where focus lands when the toast is gone: the row's trigger if it is still mounted, else the page's main heading. Never BODY. */
export function stableFocusTarget(): HTMLElement | null {
	if (returnTo?.isConnected) return returnTo;
	const h = (document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('h1') ?? document.querySelector<HTMLElement>('main'));
	if (h && !h.matches('a,button,input,[tabindex]')) h.setAttribute('tabindex', '-1');
	return h;
}

/** the approval one row asks for (null when nothing waits on the viewer there) */
export const targetOf = (row: Pick<TRow, 'app' | 'tier' | 'href' | 'regions'>, state: HomeState): ApprovalTarget | null => approvalTarget(row, state);

/** the confirm sentence: "Approve f4a2c19 for 5 prod regions?" / "Approve f4a2c19 in eu-west?" */
export const askSentence = (t: ApprovalTarget): string => `Approve ${t.build} ${t.count > 1 ? 'for' : 'in'} ${t.where}?`;
/** The toast after Approve. It says what is TRUE: a build a dependency (or another rule) still holds is approved, not deploying. */
export const doneWords = (t: ApprovalTarget): { title: string; detail: string } => {
	/* THE one cause formatter (data.ts `holdCause`): the row prints the same string */
	const cause = t.cause ?? (t.waitsOn ? `Held by ${t.waitsOn}` : null);
	const detail = cause ? `${t.app}: ${cause} · ${t.where}` : t.deploys ? `${t.app} is deploying ${t.deploys} to ${t.where}` : `${t.app} is deploying to ${t.where}`;
	return { title: `Approved ${t.build}`, detail };
};

/** open the confirm next to the pressed control (a phone gets a sheet; the layer decides from the viewport) */
export function askApprove(target: ApprovalTarget | null, ev?: Event | null): void {
	if (!target) return;
	const el = (ev?.currentTarget ?? null) as HTMLElement | null;
	const r = el?.getBoundingClientRect?.();
	approvalUi.ask = { target, anchor: r ? { top: r.top, left: r.left, right: r.right, bottom: r.bottom } : null, trigger: el };
}
/** Cancel / Escape / click-away-onto-nothing: close, and hand focus back to the button that opened the confirm (never leave it on BODY). */
export function cancelApprove(): void {
	const trigger = approvalUi.ask?.trigger;
	approvalUi.ask = null;
	if (trigger?.isConnected) trigger.focus();
}
/** Click-away: close without moving focus (the pointer already chose where focus goes). */
export const closeApprove = (): void => { approvalUi.ask = null; };
/** The confirm is `position: fixed`; `<main>` scrolls from sm up, so re-measure the trigger (the same follow-on-scroll RulePopover does). */
export function refreshAnchor(): void {
	const a = approvalUi.ask;
	if (!a?.trigger) return;
	// The button unmounted under the open confirm (a re-render, a navigation): nothing to anchor to, so close rather than float.
	if (!a.trigger.isConnected) { approvalUi.ask = null; return; }
	const r = a.trigger.getBoundingClientRect();
	a.anchor = { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
}

export function confirmApprove(f?: typeof fetch): void {
	const a = approvalUi.ask;
	if (!a) return;
	const t = a.target;
	returnTo = a.trigger;
	holds.hover = holds.focus = false; // a new toast never inherits a held state
	approvalUi.ask = null;
	clearTimer();
	grantApproval(t);
	patchPlaceCaches(t);
	approvalUi.done = { target: t, error: null };
	inflight = Promise.all(t.places.map((p) => postApproval(p.href, p.tag, false, f))).then(() => refreshPlaceCaches(t)).catch((e: Error) => {
		revokeApproval(t);
		restorePlaceCaches(t);
		approvalUi.done = { target: t, error: e.message || 'Approval failed' };
	});
	timer = setTimeout(dismissDone, UNDO_MS);
}
/**
 * The words of an Undo the server declined to complete: another approval (git, a colleague) still stands for the build at `kept` places.
 * Names the PLACE and the REASON: "ap-south stays approved" + "also approved by wyatt" (a verified `by`) or "also approved by
 * payments-core-c0d3e88-git" (an approval with no `by`: named by its RolloutApproval, never claimed to come from git). `where` is every kept place.
 */
export function stillApprovedWords(t: ApprovalTarget, replies: readonly ApprovalReply[], keptLabels: readonly string[] = []): { title: string; who: string; full: string } {
	const all = replies.flatMap((r) => r.approvals ?? []);
	const who = approversWords(all);
	const partial = keptLabels.length > 0 && keptLabels.length < t.places.length;
	return { title: partial ? `${joinPlaces(keptLabels)} ${keptLabels.length > 1 ? 'stay' : 'stays'} approved` : `${t.build} stays approved`, who, full: [...new Set(all.map((a) => a.by ?? a.name))].join(', ') };
}
const joinPlaces = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/**
 * Undo is optimistic (the places read held again at once, `revokeApproval`) and then listens to the server: a place whose revoke answered
 * `stillApproved` is approved by someone else too (git, a colleague), so its optimistic approval is put back (never left reverted) and the
 * toast says the build stays approved and by whom.
 */
export function undoApprove(f?: typeof fetch): void {
	const d = approvalUi.done;
	if (!d || d.error) return;
	const t = d.target;
	holds.hover = holds.focus = false;
	clearTimer();
	revokeApproval(t);
	restorePlaceCaches(t);
	approvalUi.done = null;
	handOffFocus();
	void inflight
		.then(() => Promise.allSettled(t.places.map((p) => postApproval(p.href, p.tag, true, f))))
		.then((results) => {
			// a place whose revoke was rejected (the server may still approve it) or answered stillApproved is put back: never left reverted
			const kept = t.places.filter((_, i) => { const r = results[i]; return r.status === 'rejected' || r.value?.stillApproved; });
			if (!kept.length) { refreshPlaceCaches(t); return; }
			const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
			// another toast took over meanwhile: its own timer and words stay; the places are still re-granted
			const other = approvalUi.done && approvalUi.done.target.key !== t.key;
			const again = { ...t, key: `${t.key}#still`, places: kept };
			grantApproval(again);
			patchPlaceCaches(again);
			refreshPlaceCaches(t);
			if (other) return;
			clearTimer();
			if (rejected) {
				const e = rejected.reason as Error | undefined;
				approvalUi.done = { target: t, error: e?.message || 'Undo failed, the approval stands' };
			} else {
				const replies = results.flatMap((r) => (r.status === 'fulfilled' && r.value?.stillApproved ? [r.value] : []));
				const w = stillApprovedWords(t, replies, kept.map((p) => p.label));
				approvalUi.done = { target: t, error: null, still: { who: w.who, title: w.full, headline: w.title } };
			}
			timer = setTimeout(dismissDone, UNDO_MS);
		});
}
/** the toast is going (auto-dismiss, Dismiss, Undo): if focus was on it or nowhere, hand it to a stable target, never BODY */
function handOffFocus(): void {
	if (typeof document === 'undefined') return;
	const a = document.activeElement;
	if (!a || a === document.body || !a.isConnected || a.closest('[data-approve-toast]')) stableFocusTarget()?.focus();
}
export function dismissDone(): void { holds.hover = holds.focus = false; clearTimer(); approvalUi.done = null; handOffFocus(); }

/** the banner / slipway form of the action: an ActRow `Act` that opens the same confirm */
export function approveAct(target: ApprovalTarget | null, o: Partial<Act> = {}): Act | undefined {
	return target ? { label: 'Approve', key: 'approve', onclick: (e?: MouseEvent) => askApprove(target, e), ...o, data: { 'data-approve-open': '', 'data-href': `${target.href.replace(/\/$/, '')}/gates`, ...(o.data ?? {}) } } : undefined;
}
