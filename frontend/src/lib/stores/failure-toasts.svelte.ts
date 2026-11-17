/**
 * The failure toasts: ONE app-level list, so a failure the operator walked away from (they closed the confirm, or went to another page)
 * is still on screen until they dismiss it. They persist across navigation on purpose, which is why each one names its target
 * ("orders-hub in prod: Failed to roll back: <reason>"): on another rollout's page it is still clear whose request failed.
 * Success toasts stay page-local and time out; only failures live here.
 */
import { nextToastOrder } from '$lib/toast-dock';

export type FailureToast = { id: number; message: string };

/** the list never grows past this: the oldest give way (a person cannot act on more than a screenful) */
const KEEP = 25;

let items = $state<FailureToast[]>([]);

export const failureToasts = {
	get items(): readonly FailureToast[] {
		return items;
	}
};

/** "orders-hub in prod", or just the name when the place is unknown */
export function failureTarget(name: string | null | undefined, place?: string | null): string {
	const n = (name ?? '').trim();
	const p = (place ?? '').trim();
	return n && p ? `${n} in ${p}` : n;
}

/** The one wording of a failure toast: the target first, then the reason ("orders-hub in prod: Failed to roll back: denied"). */
export function failureToastText(target: string, message: string): string {
	return target ? `${target}: ${message}` : message;
}

/** Shows a failure until it is dismissed. The same sentence twice shows once. */
export function reportFailure(target: string, message: string): void {
	const text = failureToastText(target, message);
	if (items.some((t) => t.message === text)) return;
	items = [...items, { id: nextToastOrder(), message: text }].slice(-KEEP);
}

export function dismissFailure(id: number): void {
	items = items.filter((t) => t.id !== id);
}

export function resetFailureToasts(): void {
	items = [];
}
