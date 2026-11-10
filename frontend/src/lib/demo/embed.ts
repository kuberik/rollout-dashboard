/**
 * THE EMBED CONTRACT — THREE THINGS, DELIBERATELY.
 *
 * kuberik.com's landing embeds this build in a same-origin iframe per
 * showcase and drives a short guided tour over it. Everything the parent
 * needs is:
 *
 *   window.kuberikDemo.ready          resolves once the first page has painted
 *   window.kuberikDemo.goto(path)     client-side navigation, base-aware
 *   postMessage({type:'kuberik-demo-ready'})  to window.parent, once
 *
 * ⛔ AND NOTHING ELSE. The parent reads the iframe's DOM itself to find
 * hotspots — it is same-origin, so it can. Every API we add here is an API the
 * dashboard then has to keep working for a page that does not ship in this
 * repo; the DOM is a contract we already owe our users.
 *
 * `goto` takes an app path WITHOUT the base (`/rollouts/dev/default/hello-world`)
 * and adds `base` itself, so the parent never has to know the build is hosted
 * under `/demo`.
 *
 * ── `data-tour` — THE ANCHORS THE TOUR POINTS AT ────────────────────────────
 *
 * The parent finds its highlight targets by `querySelectorAll('[data-tour]')`
 * on the iframe's document. It used to match VISIBLE TEXT, which is how this
 * list came to exist: this product renames its own vocabulary (`baking` →
 * `checking` moved seven strings in one pass), and a text matcher answers a
 * rename by silently pointing the label at the wrong element. These attributes
 * are plain markup in the real dashboard, not demo-only, and they are a
 * CONTRACT WITH kuberik.com — renaming or removing one breaks a tour step in
 * another repo, which nothing here will fail on.
 *
 *   Home                 needs-you, in-motion, recent-activity (on the
 *                        headings), retry-deploy / promote-now / investigate /
 *                        reconcile (the card's action, one per card — the id
 *                        comes from the card's STATE, never from the button's
 *                        label), how-its-going
 *   Rollout detail       pipeline, health-checks, change-version
 *   Dependencies         builds-held, network, waiting-on, where-running
 *   Activity             activity-chart, range-switch, range-1d
 *
 * ⚠️ AN ANCHOR THAT REPEATS IS ON EVERY INSTANCE. `retry-deploy` is on each
 * failing card, so `querySelectorAll` gives the parent all of them and a
 * first-match gives it the topmost. Do not special-case the first.
 *
 * ⛔ THESE ARE DURABLE, NOT IMMORTAL. Someone refactoring a component can
 * still drop one. The parent's side of the bargain is to resolve every anchor
 * before starting the tour and skip it loudly if one is missing, rather than
 * fall back to authored coordinates and mislabel the page.
 */

import { goto } from '$app/navigation';
import { base } from '$app/paths';

export type KuberikDemo = {
	goto(path: string): Promise<void>;
	ready: Promise<void>;
};

declare global {
	// eslint-disable-next-line no-var
	var kuberikDemo: KuberikDemo | undefined;
}

let resolveReady: (() => void) | null = null;
let announced = false;

export function installDemoEmbed(): void {
	if (typeof window === 'undefined' || window.kuberikDemo) return;
	const ready = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});
	window.kuberikDemo = {
		goto: (path: string) => goto(`${base}${path.startsWith('/') ? path : `/${path}`}`),
		ready
	};
}

/**
 * Called once from the root layout after the first paint. Two frames, not one:
 * the first lands after the layout commits, the second after the page
 * component inside it has painted, which is what the parent actually waits for
 * before it fades the placeholder out.
 */
export function announceDemoReady(): void {
	if (announced || typeof window === 'undefined') return;
	announced = true;
	requestAnimationFrame(() =>
		requestAnimationFrame(() => {
			resolveReady?.();
			if (window.parent && window.parent !== window) {
				// ⚠️ NAMED, NOT `'*'`. The landing embeds this build SAME-ORIGIN, so
				// the origin is known and there is no reason to broadcast a message
				// to whatever page happens to be framing us. It also means that if
				// someone ever frames the demo from another origin, the handshake
				// fails loudly at the boundary instead of silently working.
				window.parent.postMessage({ type: 'kuberik-demo-ready' }, window.location.origin);
			}
		})
	);
}
