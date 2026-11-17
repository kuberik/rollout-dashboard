/**
 * Svelte action: moves a floating toast into the app's ONE toast dock (`[data-toast-dock]`, mounted by `FailureToasts` in the root layout),
 * so success, loading and failure toasts stack in a single column, newest last, instead of sharing coordinates. Without a dock (a test, a
 * specimen) the toast stays where it is and keeps its own fixed position. `onDocked` tells the toast to drop that position.
 */
export function toDock(node: HTMLElement, opts: { enabled: boolean; onDocked: () => void }) {
	const dock = opts.enabled && typeof document !== 'undefined' ? document.querySelector('[data-toast-dock]') : null;
	if (dock) {
		dock.appendChild(node);
		opts.onDocked();
	}
	return {
		destroy() {
			node.remove();
		}
	};
}
