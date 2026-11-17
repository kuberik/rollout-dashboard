/**
 * Svelte action: moves a floating toast into the app's ONE toast dock (`[data-toast-dock]`, mounted by `FailureToasts` in the root layout),
 * so success, loading and failure toasts stack in a single column, oldest first and newest last, instead of sharing coordinates. Without a
 * dock (a test, a specimen) the toast stays where it is and keeps its own fixed position. `onDocked` tells the toast to drop that position.
 */
let seq = 0;
/** A number that grows with every toast, so the dock can keep its children in arrival order. */
export function nextToastOrder(): number {
	return ++seq;
}

export function toDock(node: HTMLElement, opts: { enabled: boolean; onDocked: () => void; order: number }) {
	const dock = opts.enabled && typeof document !== 'undefined' ? document.querySelector('[data-toast-dock]') : null;
	if (dock) {
		node.dataset.order = String(opts.order);
		const later = [...dock.children].find((c) => Number((c as HTMLElement).dataset.order ?? 0) > opts.order);
		dock.insertBefore(node, later ?? null);
		opts.onDocked();
	}
	return {
		destroy() {
			node.remove();
		}
	};
}
