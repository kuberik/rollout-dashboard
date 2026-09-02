import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import ControlCenter from '$lib/ControlCenter.svelte';
import RolloutGrid from '$lib/RolloutGrid.svelte';
import Apps from '../routes/apps/+page.svelte';
import Activity from '../routes/activity/+page.svelte';
import Environments from '../routes/environments/+page.svelte';
import Versions from '../routes/versions/+page.svelte';

/**
 * ⭐ FINDING 2 OF THE 2026-08-31 OPERATOR CRITIQUE, PINNED.
 *
 * A critic scaled `deploy/rollout-dashboard` to 0 so every `/api/rollouts`
 * answered 503, then loaded the product page by page. `/rollouts` and rollout
 * detail sat on grey placeholders; `/`, `/apps`, `/apps/<name>` and
 * `/activity` rendered **a title and nothing else** — measured here before the
 * fix as the single string `Home Failed to load: Request failed (503)`.
 *
 * The charge, in the critic's words: *"At 3am a blank Rollouts page reads as
 * 'the cluster has no rollouts'"* — the product inventing an all-clear out of
 * a failure, which is the most dangerous thing this dashboard can do.
 *
 * **A failure that renders as a skeleton, or as a status code in 12px, is
 * exactly the class of defect that comes back.** So it is a test, per page,
 * and the assertions are on the WORDS a woken operator would read.
 */

const outage = () =>
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('upstream connect error', { status: 503 }))
	);

afterEach(() => vi.unstubAllGlobals());

const pages: [string, unknown][] = [
	['/', ControlCenter],
	['/rollouts', RolloutGrid],
	['/apps', Apps],
	['/activity', Activity],
	['/environments', Environments],
	['/versions', Versions]
];

describe('a 503 from the API is a terminal, legible failure on every page', () => {
	beforeEach(outage);

	for (const [name, Comp] of pages) {
		test(`${name} says the server is unreachable, not nothing`, async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			render(WithQueryClient, { props: { component: Comp as any } });

			// 1. WHAT HAPPENED, in the operator's terms rather than a status code.
			await waitFor(() =>
				expect(screen.getByText('Cannot reach the dashboard server')).toBeInTheDocument()
			);

			// 2. NOT MISTAKABLE FOR AN EMPTY FLEET. This is the whole finding: the
			//    page must state that the blank is a failed request and not a
			//    reading of the cluster.
			expect(
				screen.getByText(/nothing on this page is a reading of your cluster/i)
			).toBeInTheDocument();

			// 3. THE SERVER'S OWN WORDS WHERE THERE ARE ANY — and where there are
			//    none (Envoy's 503 carries no JSON body), it says so instead of
			//    inventing a cause, and names the address it asked for.
			//
			//    ⭐ IT IS A RECORD NOW, NOT A SENTENCE. (2026-09-02) `errorDetail`
			//    joined three machine facts with an em dash; `errorFacts` gives
			//    each a label and `FactList` aligns them. BOTH DIRECTIONS ARE
			//    PINNED HERE, which is the property `AlertPanel.svelte.test.ts`
			//    exists for: the facts are DISCLOSED (a closed `<details>`, so a
			//    future edit cannot quietly print them back into the first
			//    second of reading) AND they are REACHABLE (in the DOM, so a
			//    future edit cannot quietly drop one while the suite stays green).
			const address = screen.getAllByText('/api/rollouts')[0];
			expect(address).toBeInTheDocument();
			const record = address.closest('details');
			expect(record).not.toBeNull();
			expect((record as HTMLDetailsElement).open).toBe(false);
			expect(record?.textContent).toContain('HTTP 503');
			expect(record?.textContent).toContain('nothing');

			// 4. A WAY OUT.
			expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
		});

		test(`${name} leaves the skeleton behind — no placeholder outlives the failure`, async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const { container } = render(WithQueryClient, { props: { component: Comp as any } });
			await waitFor(() =>
				expect(screen.getByText('Cannot reach the dashboard server')).toBeInTheDocument()
			);
			expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
		});
	}

	test('the page tells you it is still trying, rather than staying silent', async () => {
		render(WithQueryClient, { props: { component: RolloutGrid as never } });
		await waitFor(() =>
			expect(screen.getByText('Cannot reach the dashboard server')).toBeInTheDocument()
		);
		// `pollWhenHealthy` keeps a 30s recovery poll alive on a retryable
		// failure. That promise is worthless if the reader cannot see it.
		expect(screen.getByText(/rechecking every 30s|checking now/i)).toBeInTheDocument();
	});
});

/**
 * ⭐ RECOVERY — the state the critic could not reach and named explicitly:
 * *"if the API comes back while the tab is open, does the page heal itself, or
 * does the operator have to know to reload?"*
 */
describe('the page heals when the server comes back', () => {
	test('a retry after recovery replaces the failure with real rows, no reload', async () => {
		let down = true;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				if (down) return new Response('upstream connect error', { status: 503 });
				return new Response(
					JSON.stringify({
						rollouts: {
							items: [
								{
									metadata: { name: 'recovered-app', namespace: 'demo' },
									spec: {},
									status: { history: [] }
								}
							]
						},
						environments: { items: [] }
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } }
				);
			})
		);

		render(WithQueryClient, { props: { component: RolloutGrid as never } });
		await waitFor(() =>
			expect(screen.getByText('Cannot reach the dashboard server')).toBeInTheDocument()
		);

		down = false;
		await fireEvent.click(screen.getByRole('button', { name: /try again/i }));

		await waitFor(() => expect(screen.getByText('recovered-app')).toBeInTheDocument());
		expect(screen.queryByText('Cannot reach the dashboard server')).not.toBeInTheDocument();
	});
});

/**
 * ⭐ THE SAME LIE IN MINIATURE. The hub fans out to its spokes and FAILS SOFT:
 * `/api/rollouts` answers 200 with whoever replied and names the rest in
 * `clusterErrors`. A page that renders that payload without a word is claiming
 * a whole-fleet reading it does not have — and a rollout on the missing spoke
 * is absent from every count, not healthy in it. Before this pass only `/` and
 * `/rollouts` said anything, as a 12px aside.
 */
describe('a partial answer is declared, on every page that renders one', () => {
	beforeEach(() => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							rollouts: { items: [] },
							environments: { items: [] },
							clusters: [{ name: 'spoke-a', url: 'https://a' }],
							clusterErrors: [{ name: 'spoke-b', url: 'https://b', error: 'dial tcp: i/o timeout' }]
						}),
						{ status: 200, headers: { 'Content-Type': 'application/json' } }
					)
			)
		);
	});

	for (const [name, Comp] of pages) {
		test(`${name} names the cluster that did not answer`, async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			render(WithQueryClient, { props: { component: Comp as any } });
			await waitFor(() =>
				expect(
					screen.getByText(/spoke-b did not answer — this page is incomplete/i)
				).toBeInTheDocument()
			);
			// Absent is not healthy — said in words, not left to inference.
			expect(
				screen.getByText(/missing from these counts, not healthy in them/i)
			).toBeInTheDocument();
			// The hub's own sentence, verbatim.
			expect(screen.getByText(/dial tcp: i\/o timeout/)).toBeInTheDocument();
		});
	}
});
