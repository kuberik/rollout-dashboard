/** r34 — the review scenario from the URL (owner ruling 2026-11-01: real paths, no /lab/new): `?calm=1` every place healthy,
 *  `?quiet=1` nothing for you, else the incident scenario the mock serves. r39: `?scenario=calm|quiet|incident` says the same, and on live data
 *  the scenario is the MOCK API's (a cookie, see `$lib/demo/scenario-cookie.ts`); this value only drives the pinned fixture in unit tests. */
import type { HomeState } from '$lib/components/home/sketch/home-data';
import { scenarioParam } from '$lib/demo/scenario-cookie';
export const scenarioOf = (url: URL): HomeState => scenarioParam(url) ?? 'incident';
