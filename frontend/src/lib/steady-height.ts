import { steadyStep, type SteadyState } from '$lib/view-models/pipeline-card';

/**
 * Svelte action: the node's min-height only ratchets up while `key` is unchanged (one deploy), so content
 * that needs less room at a later step leaves the room there instead of pulling the page up. A new key
 * (a new deploy) starts from its own height. The rule itself is `steadyStep` (unit-tested).
 */
export function steadyHeight(node: HTMLElement, key: string) {
	let state: SteadyState = { key, max: 0 };
	let width = node.offsetWidth;
	const apply = () => {
		/* a width change (rotate, resize) re-flows the content: start over instead of holding a height the old width needed */
		if (node.offsetWidth !== width) {
			width = node.offsetWidth;
			state = { key: state.key, max: 0 };
			node.style.minHeight = '';
		}
		const measured = node.offsetHeight;
		const next = steadyStep(state, state.key, measured);
		if (next.max !== state.max || node.style.minHeight === '') node.style.minHeight = `${next.max}px`;
		state = next;
	};
	const ro = new ResizeObserver(apply);
	ro.observe(node);
	return {
		update(nextKey: string) {
			if (nextKey === state.key) return;
			state = { key: nextKey, max: 0 };
			node.style.minHeight = '';
		},
		destroy() {
			ro.disconnect();
		}
	};
}
