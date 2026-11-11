/**
 * Vite dev server plugin that mocks the backend API for visual testing.
 *
 * Usage: `MOCK_API=1 pnpm exec vite dev` (see `vite.config.ts`), then navigate
 * to e.g. https://localhost:5173/rollouts/dev/default/hello-world
 *
 * ⭐ THE FIXTURES AND THE ROUTING NO LONGER LIVE HERE. (2026-09-12) They moved
 * to `src/lib/demo/mock-data.ts` and `src/lib/demo/respond.ts`, which are pure
 * and browser-safe, because the DEMO BUILD (`VITE_DEMO=1`, embedded by
 * kuberik.com under `/demo/`) serves the very same mock from an in-browser
 * `fetch` shim with no server at all. What is left in this file is exactly the
 * part that cannot be shared: the Node request/response adaptation and the
 * env-var outage harness below.
 */

import { stampGateKinds } from './src/lib/demo/gate-kind';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { respond, type MockResult } from './src/lib/demo/respond';
import { staleMockMode } from './src/lib/demo/cluster-errors-mock';
import {
	homeScenarioFixture,
	homeScenarioOf,
	respondHomeIncident,
	type HomeFixture,
	type HomeScenario
} from './src/lib/demo/home-incident';

/**
 * `MOCK_SCENARIO=home-incident` — opt-in: serves the pinned Home fixture in
 * front of `respond()` (see `src/lib/demo/home-incident.ts`). Read once at
 * plugin start; without that value the fixture is never read and every route
 * answers exactly as before. `bootScenario` (state.ts) does not know this
 * value and boots `calm` underneath, which only the fall-through routes see.
 */
function loadHomeFixture(): HomeFixture | null {
	if (!homeScenarioOf(process.env.MOCK_SCENARIO)) return null;
	const path = fileURLToPath(
		new URL('./src/lib/view-models/home/fixtures/incident-input.json', import.meta.url)
	);
	return JSON.parse(readFileSync(path, 'utf8')) as HomeFixture;
}

/**
 * Buffers the raw Node request body for a non-GET/HEAD request — `respond()`
 * itself must stay free of Node APIs (`req`/streams), so this is the one
 * place in the dev adapter allowed to touch `req` directly. Resolves to
 * `undefined` for a method that never carries a body, so `MockOptions.body`
 * downstream is `undefined` rather than `''` for the common case (a plain
 * GET), matching `install.ts`'s own contract.
 */
function readRequestBody(req: NodeJS.ReadableStream & { method?: string }): Promise<string | undefined> {
	if (req.method === 'GET' || req.method === 'HEAD') return Promise.resolve(undefined);
	return new Promise((resolve) => {
		let data = '';
		req.on('data', (chunk: Buffer) => {
			data += chunk;
		});
		req.on('end', () => resolve(data));
		// A body we couldn't read is the same as no body — the mutation routes
		// all have sensible defaults for a missing field (see `parseBody` in
		// `./src/lib/demo/respond.ts`), not a hard failure.
		req.on('error', () => resolve(data));
	});
}

export function mockApiPlugin(): Plugin {
	const homeFixture = loadHomeFixture();
	/**
	 * ⭐ SCENARIO PER REQUEST (r39). `MOCK_SCENARIO=home-incident|home-calm|home-quiet` is the default; the `kuberik_scenario` cookie (set by
	 * the page when its URL carries `?scenario=calm`, `?calm=1` or `?quiet=1`, see `$lib/demo/scenario-cookie.ts`) overrides it per request, so one
	 * server shows all three over the same fixture. Without MOCK_SCENARIO=home-* the mock serves its generic fleet, as before.
	 */
	const byScenario = new Map<HomeScenario, HomeFixture>();
	const fixtureFor = (cookie: string | undefined): HomeFixture | null => {
		if (!homeFixture) return null;
		const m = /(?:^|;\s*)kuberik_scenario=([^;]+)/.exec(cookie ?? '');
		const sc = homeScenarioOf(m?.[1]) ?? homeScenarioOf(process.env.MOCK_SCENARIO) ?? 'home-incident';
		if (!byScenario.has(sc)) byScenario.set(sc, homeScenarioFixture(homeFixture, sc));
		return byScenario.get(sc)!;
	};
	return {
		name: 'mock-api',
		configureServer(server) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			server.middlewares.use(async (req: any, res: any, next: () => void) => {
				if (!req.url?.startsWith('/api/')) return next();

				res.setHeader('Content-Type', 'application/json');
				const body = await readRequestBody(req);

				/**
				 * ⚠️ THE OUTAGE HARNESS, ENV-GATED AND INERT BY DEFAULT.
				 *
				 * A UX critic reproduced finding 2 by scaling `deploy/rollout-dashboard`
				 * to 0 on the live hub — which works, and takes the dashboard away from
				 * everyone else sharing the cluster. These three flags reproduce the
				 * same three states on your own port, so nobody has to break a shared
				 * environment to look at a failed page:
				 *
				 *   MOCK_OUTAGE=1   every /api answers 503 with no body, exactly as
				 *                   Envoy does when the deployment has no endpoints.
				 *   MOCK_SLOW=<ms>  every /api answers after <ms>, for the "is it still
				 *                   trying, or is it stuck?" state.
				 *   MOCK_PARTIAL=1  the hub FAILS SOFT: 200 with one spoke's rollouts
				 *                   missing and the spoke named in `clusterErrors`.
				 *                   The page is then PARTLY true, which is the same lie
				 *                   in miniature.
				 *   MOCK_PARTIAL=slow|unreachable  one cluster's LAST-KNOWN data stays on the
				 *                   page, flagged stale with that typed reason.
				 *   MOCK_FAIL=1     the rollout's events list gains a Normal/Warning
				 *                   pair, so `EventsCard`'s info glyph is reachable.
				 *
				 * Without them this block does nothing at all.
				 */
				// `MOCK_OUTAGE=1` plus `rm/touch .mock-up` lets you bring the API back
				// WITHOUT restarting Vite — which matters, because a Vite restart
				// reloads the page and a reload is precisely what the recovery
				// question is asking about ("does it heal, or must I know to reload?").
				if (process.env.MOCK_OUTAGE && !existsSync('.mock-up')) {
					res.statusCode = 503;
					res.setHeader('Content-Type', 'text/plain');
					return res.end('upstream connect error or disconnect/reset before headers');
				}
				const slowMs = Number(process.env.MOCK_SLOW || 0);
				if (slowMs > 0) {
					const url = req.url;
					setTimeout(() => {
						req.url = url;
						handle(req, res, body);
					}, slowMs);
					return;
				}
				return handle(req, res, body);
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			function handle(req: any, res: any, body?: string) {
				let fx: HomeFixture | null;
				const result: MockResult =
					((fx = fixtureFor(req.headers?.cookie)) && respondHomeIncident(req.method ?? 'GET', req.url, fx, new Date(), staleMockMode(process.env.MOCK_PARTIAL))) ||
					respond(req.method ?? 'GET', req.url, {
					partial: !!process.env.MOCK_PARTIAL && !staleMockMode(process.env.MOCK_PARTIAL),
					stale: staleMockMode(process.env.MOCK_PARTIAL),
					fail: !!process.env.MOCK_FAIL,
					body
				});

				res.statusCode = result.status;
				for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);

				if (result.stream) {
					// ⛔ THE TEARDOWN IS NOT OPTIONAL. An SSE route that keeps its
					// timers after the browser navigates away is the same leak the
					// dev proxy shipped (1038 subscribers, see `vite.config.ts`).
					const stop = result.stream.start((chunk) => res.write(chunk));
					req.on('close', stop);
					return;
				}
				return res.end(stampGateKinds(result.body) ?? '{}');
			}
		}
	};
}
