/**
 * ONE form for all the lag words of a strip (moved out of Facia.svelte, apps-11): "1 build behind" when every cell fits ONE row, else "1 behind" in every cell
 * (the full words stay in the node's title). Wrapping counts as not fitting. The text node is rewritten in place and the strip re-measured on resize and on Svelte writes.
 */
export function lagFit(root: HTMLElement) {
	const run = () => {
		mo.disconnect();
		const lags = [...root.querySelectorAll<HTMLElement>('.env-lag')];
		const set = (short: boolean) => { for (const l of lags) { const t = l.firstChild; if (t?.nodeType !== 3) continue; const v = t.nodeValue ?? ''; if (/ builds? behind$/.test(v)) l.dataset.full = v; const full = l.dataset.full ?? v; const next = short ? full.replace(/ builds?( behind)$/, '$1') : full; if (v !== next) t.nodeValue = next; } };
		const wrapped = () => { const cs = [...root.querySelectorAll<HTMLElement>('.env-cell')].filter((c) => c.offsetParent); return cs.length > 1 && new Set(cs.map((c) => c.offsetTop)).size > 1; };
		const clipped = () => wrapped() || [...root.querySelectorAll<HTMLElement>('.env-box')].some((n) => n.scrollWidth > n.clientWidth + 1);
		root.removeAttribute('data-wrap');
		set(false);
		if (clipped()) {
			set(true);
			if (clipped()) root.setAttribute('data-wrap', '');
		}
		mo.observe(root, { childList: true, subtree: true, characterData: true });
	};
	const mo = new MutationObserver(() => run());
	const ro = new ResizeObserver(run);
	ro.observe(root);
	run();
	return { destroy() { ro.disconnect(); mo.disconnect(); } };
}
