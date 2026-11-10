/**
 * The monogram of an app, told apart from the other apps of the fleet (QA2 #11). ONE fleet-wide name set feeds every AppGlyph on every
 * page: the root layout mounts `FleetAppNames`, which publishes the rollouts list's names here (same query as the Navbar's, so no extra
 * request); a page's own live fleet source adds to it. An app therefore prints the same letters on rollout detail, /apps, /envs, Home,
 * /activity and the palette. With neither (unit tests) the name stands alone and keeps its default monogram.
 */
import { monogramOf, monogramsFor } from '$lib/app-identity';
import { liveSource } from '$lib/components/home/sketch/fleet-source.svelte';

let published = $state.raw<string[]>([]);
/** the root layout has asked for the fleet and it has not answered: glyphs draw no letters yet (a default monogram that later changes is a late pop-in) */
let awaiting = $state(false);
export function expectFleetAppNames(): void { awaiting = true; }
export function publishFleetAppNames(names: string[]): void {
	awaiting = false;
	if (names.length !== published.length || names.some((n, i) => n !== published[i])) published = names;
}

/** the final letters, or null while the fleet's names are still on their way (AppGlyph then draws its letterless placeholder) */
export function monogramFor(name: string): string | null {
	const live = liveSource();
	if (awaiting && !live) return null;
	const names = new Set<string>(published);
	for (const r of live?.rollouts ?? []) if (r.metadata?.name) names.add(r.metadata.name);
	names.add(name);
	return monogramsFor([...names]).get(name) ?? monogramOf(name);
}
