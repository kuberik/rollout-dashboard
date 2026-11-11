/**
 * r34 r3-approve — THE ONE APPROVE ACTION'S STATE. Every surface that shows the approval action (Rollouts In flight and rows,
 * Changes lead / rows / cards, Apps tiles and lead, Needs you, Environments and Envs, the rollout tab's Gates) calls
 * `askApprove(target, event)` and nothing else; `ApprovalLayer` (mounted once in the root layout) owns the confirm popover and the
 * after-state toast. Flow: ask -> confirm (one step, in the same surface) -> optimistic grant (data.ts applies it to the fixture,
 * every page re-derives) + one POST per place (src/lib/api/approvals.ts) -> toast "Approved · deploying" with Undo for 8 s.
 * A failed request rolls the optimistic grant back and says so.
 */
import { approvalTarget, grantApproval, revokeApproval, type ApprovalTarget, type HomeState, type TRow } from './data';
import { postApproval } from '$lib/api/approvals';
import type { Act } from '$lib/components/ActRow.svelte';

export const UNDO_MS = 8000;

export const approvalUi = $state<{
	ask: { target: ApprovalTarget; anchor: { top: number; left: number; right: number; bottom: number } | null; trigger: HTMLElement | null } | null;
	done: { target: ApprovalTarget; error: string | null } | null;
}>({ ask: null, done: null });

let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<unknown> = Promise.resolve();
const clearTimer = () => { if (timer) clearTimeout(timer); timer = null; };

/** the approval one row asks for (null when nothing waits on the viewer there) */
export const targetOf = (row: Pick<TRow, 'app' | 'tier' | 'href' | 'regions'>, state: HomeState): ApprovalTarget | null => approvalTarget(row, state);

/** the confirm sentence: "Approve f4a2c19 for 5 prod regions?" / "Approve f4a2c19 in eu-west?" */
export const askSentence = (t: ApprovalTarget): string => `Approve ${t.build} ${t.count > 1 ? 'for' : 'in'} ${t.where}?`;
/** The toast after Approve. It says what is TRUE: a build a dependency (or another rule) still holds is approved, not deploying. */
export const doneWords = (t: ApprovalTarget): { title: string; detail: string } => ({ title: `Approved ${t.build}`, detail: t.waitsOn ? `${t.app} waits on ${t.waitsOn} for ${t.where}` : `${t.app} is deploying to ${t.where}` });

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
	approvalUi.ask = null;
	clearTimer();
	grantApproval(t);
	approvalUi.done = { target: t, error: null };
	inflight = Promise.all(t.places.map((p) => postApproval(p.href, p.tag, false, f))).catch((e: Error) => {
		revokeApproval(t);
		approvalUi.done = { target: t, error: e.message || 'Approval failed' };
	});
	timer = setTimeout(dismissDone, UNDO_MS);
}
export function undoApprove(f?: typeof fetch): void {
	const d = approvalUi.done;
	if (!d || d.error) return;
	const t = d.target;
	clearTimer();
	revokeApproval(t);
	approvalUi.done = null;
	void inflight.then(() => Promise.all(t.places.map((p) => postApproval(p.href, p.tag, true, f)))).catch(() => {});
}
export function dismissDone(): void { clearTimer(); approvalUi.done = null; }

/** the banner / slipway form of the action: an ActRow `Act` that opens the same confirm */
export function approveAct(target: ApprovalTarget | null, o: Partial<Act> = {}): Act | undefined {
	return target ? { label: 'Approve', key: 'approve', onclick: (e?: MouseEvent) => askApprove(target, e), ...o, data: { 'data-approve-open': '', 'data-href': `${target.href.replace(/\/$/, '')}/gates`, ...(o.data ?? {}) } } : undefined;
}
