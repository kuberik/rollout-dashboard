import { describe, test, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import PipelineCard from './PipelineCard.svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import type { PrCell, PrService } from '$lib/view-models/pr-pipeline';
import type { RolloutResponse } from '$lib/api/rollouts';

const NOW = new Date('2026-09-10T12:00:00Z');

function mkCell(state: PrCell['state'], overrides: Partial<PrCell> = {}): PrCell {
	return {
		cluster: '',
		envName: 'dev',
		namespace: 'widget-dev',
		rolloutName: 'widget-app',
		theme: null,
		envRank: 1,
		state,
		reason: '',
		since: null,
		usuallyMs: null,
		bakeLeftMs: null,
		releaseLabel: '',
		revision: null,
		superseded: false,
		gateHint: null,
		gateLabel: null,
		gateSubject: null,
		gateSubjectKind: null,
		gatePending: false,
		gateApprovalGuess: false,
		gateContract: null,
		gateRequiredVersion: null,
		gateProvidedVersion: null,
		providerHasNoBuild: false,
		containmentKnown: true,
		historyMatches: [],
		historyAtLimit: false,
		versionHistoryLimit: 10,
		...overrides
	};
}

function mkService(cells: PrCell[], overrides: Partial<PrService> = {}): PrService {
	return {
		appName: 'widget-app',
		sourceRepo: 'github.com/acme/widget',
		cells,
		furthest: 'live in dev',
		furthestCompact: '1 of 1 live',
		leadTimeMs: null,
		builtElsewhere: false,
		...overrides
	};
}

function renderCard(service: PrService) {
	return render(WithQueryClient, {
		props: {
			component: PipelineCard as never,
			props: {
				service,
				localClusterName: 'hub',
				environments: [],
				// `{ items: [] }`, NOT `null` — `buildGateContext`'s `sources`
				// tells "consulted, found nothing" apart from "never asked"
				// (`blocking-story.ts`'s own rule), and the "why?" test below
				// needs FULL provenance to reach the `approval` branch rather
				// than the honest-but-vaguer `unknown` fallback.
				rolloutDependencies: { items: [] },
				now: NOW
			}
		}
	});
}

describe('PipelineCard', () => {
	// ⛔ FIX PASS ITEM 14, 2026-09-11 — THE ROLLUP IS THE COMPACT FORM AT
	// EVERY WIDTH now, not just below 560px: the card passes only
	// `furthestCompact` as `verdict` (no `verdictCompact` prop), so
	// `furthest`'s clause-list form never renders at all.
	test('header names the service, links to its app page, and shows the compact rollup', () => {
		const service = mkService([mkCell('live', { since: '2026-09-10T10:00:00Z' })], {
			furthest: 'live in dev',
			furthestCompact: '1 of 1 live'
		});
		renderCard(service);
		const link = screen.getByRole('link', { name: 'widget-app' });
		expect(link).toHaveAttribute('href', '/apps/widget-app');
		expect(screen.getByText('1 of 1 live')).toBeInTheDocument();
		expect(screen.queryByText('live in dev')).toBeNull();
	});

	test('one row per cell, each a link to that cluster/env rollout', () => {
		const service = mkService([
			mkCell('live', { envName: 'dev', since: '2026-09-10T10:00:00Z' }),
			mkCell('gated', {
				envName: 'staging',
				envRank: 4,
				gateLabel: 'Business Hours Only',
				reason: 'Outside the Business Hours Only deploy window'
			})
		]);
		renderCard(service);
		expect(screen.getByRole('link', { name: /DEV rollout for widget-app/i })).toHaveAttribute(
			'href',
			'/rollouts/hub/widget-dev/widget-app'
		);
		expect(screen.getByRole('link', { name: /STAGING rollout for widget-app/i })).toBeInTheDocument();
		expect(screen.getByText('live since 2h ago')).toBeInTheDocument();
		expect(screen.getByText('held by Business Hours Only')).toBeInTheDocument();
	});

	test('a cluster prefix appears only when more than one cluster is present', () => {
		const oneCluster = mkService([mkCell('live', { cluster: 'prod' })]);
		const { unmount } = renderCard(oneCluster);
		expect(screen.queryByText('prod/')).not.toBeInTheDocument();
		unmount();

		const twoClusters = mkService([
			mkCell('live', { cluster: 'prod', envName: 'prod', envRank: 7 }),
			mkCell('not-built', { cluster: 'dev-cluster', envName: 'dev' })
		]);
		renderCard(twoClusters);
		expect(screen.getByText('prod/')).toBeInTheDocument();
		expect(screen.getByText('dev-cluster/')).toBeInTheDocument();
	});

	test('HELD names a build that cannot land yet: gated, waiting-upstream and pinned all carry it', () => {
		const service = mkService([
			mkCell('gated', { envName: 'dev', gateLabel: 'a-rule', releaseLabel: '2.66.0-66' }),
			mkCell('waiting-upstream', {
				envName: 'staging',
				envRank: 4,
				gateSubject: 'hello-api-app',
				releaseLabel: '2.66.0-66'
			}),
			mkCell('pinned', { envName: 'prod', envRank: 7, reason: 'pinned to 2.65.0-64' })
		]);
		renderCard(service);
		expect(screen.getAllByText('HELD')).toHaveLength(3);
	});

	test('ROLLED BACK names the one state that is one', () => {
		const service = mkService([
			mkCell('rolled-back', { releaseLabel: '2.65.0-64', reason: 'rolled back to 2.65.0-64' })
		]);
		renderCard(service);
		expect(screen.getByText('rolled back')).toBeInTheDocument();
		expect(screen.queryByText('held')).not.toBeInTheDocument();
	});

	test('item 7: the row names the release carrying the PR (label + short sha), and prints nothing when not built', () => {
		const service = mkService([
			mkCell('live', {
				envName: 'dev',
				since: '2026-09-10T10:00:00Z',
				releaseLabel: '2.66.0-66',
				revision: 'abc1234def5678'
			}),
			mkCell('not-built', { envName: 'staging', envRank: 4 })
		]);
		renderCard(service);
		expect(screen.getByText('2.66.0-66')).toBeInTheDocument();
		expect(screen.getByText('abc1234')).toBeInTheDocument();
	});

	test('item 5: no bare "usually" em dash on live/not-built/held rows — only deploying/baking print an estimate', () => {
		const service = mkService([
			mkCell('live', { envName: 'dev', since: '2026-09-10T10:00:00Z', usuallyMs: 5 * 60_000 }),
			mkCell('not-built', { envName: 'staging', envRank: 4, usuallyMs: null }),
			mkCell('baking', {
				envName: 'prod',
				envRank: 7,
				usuallyMs: 8 * 60_000,
				since: '2026-09-10T11:56:00Z',
				bakeLeftMs: 6 * 60_000
			})
		]);
		renderCard(service);
		expect(screen.queryByText('—')).not.toBeInTheDocument();
		expect(screen.getByText(/usually \d+ min/)).toBeInTheDocument();
	});

	test('no "Why is it held?" disclosure when the cell names no gate', () => {
		const service = mkService([mkCell('live')]);
		renderCard(service);
		expect(screen.queryByText('Why is it held?')).not.toBeInTheDocument();
	});

	test('gatePending: a SkeletonBar stands in for the reason, "held by a rule" not the raw gate id', () => {
		const service = mkService([
			mkCell('gated', {
				gateLabel: null,
				gatePending: true,
				reason: '',
				gateHint: {
					cluster: '',
					namespace: 'widget-dev',
					rolloutName: 'widget-app',
					gateName: 'schedule-gate-fk44d'
				}
			})
		]);
		renderCard(service);
		expect(screen.getByText('held by a rule')).toBeInTheDocument();
		expect(screen.queryByText(/schedule-gate-fk44d/)).not.toBeInTheDocument();
	});

	test('"Why is it held?" fetches the single-rollout endpoint AND this rollout\'s schedules once, lazily, and prints the gate\'s kind', async () => {
		// ⭐ CHANGES-2026-09-10 §7, ITEM 2 — a `not-built` cell in `dev` is now
		// the FRONTIER (first not-yet-live cell), so this held `staging` cell
		// is deliberately NOT the frontier — the disclosure it tests stays
		// exactly as lazy as before. See the two tests below for the frontier
		// cell's own eager-fetch behaviour.
		const service = mkService([
			mkCell('not-built', { envName: 'dev', envRank: 1 }),
			mkCell('gated', {
				envName: 'staging',
				envRank: 4,
				gateLabel: 'hello-world-manual-approval',
				gateHint: {
					cluster: '',
					namespace: 'widget-dev',
					rolloutName: 'widget-app',
					gateName: 'hello-world-manual-approval'
				}
			})
		]);

		const rolloutResponse: RolloutResponse = {
			rollout: {
				metadata: { name: 'widget-app', namespace: 'widget-dev' },
				status: { gates: [{ name: 'hello-world-manual-approval', allowedVersions: [] }] }
			} as never,
			rolloutGates: { items: [] }
		};

		const fetchMock = vi.fn((url: string) => {
			if (url.includes('/schedules')) {
				return Promise.resolve(
					new Response(JSON.stringify({ rolloutSchedules: { items: [] } }), { status: 200 })
				);
			}
			return Promise.resolve(new Response(JSON.stringify(rolloutResponse), { status: 200 }));
		});
		vi.stubGlobal('fetch', fetchMock);

		renderCard(service);

		// ⛔ NEVER UP FRONT — the row rendered and nothing fetched yet.
		expect(fetchMock).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByText('Why is it held?'));

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/rollouts/widget-dev/widget-app') && !String(c[0]).includes('/schedules'))).toBe(true);
		expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/rollouts/widget-dev/widget-app/schedules'))).toBe(true);

		await waitFor(() => expect(screen.getByText('Kind')).toBeInTheDocument());
		expect(screen.getByText('a manual approval')).toBeInTheDocument();

		// Closing and reopening never fires a second fetch (`staleTime: Infinity`).
		await fireEvent.click(screen.getByText('Why is it held?'));
		await fireEvent.click(screen.getByText('Why is it held?'));
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test('CHANGES-2026-09-10 §7, item 2: a HELD FRONTIER cell fetches eagerly, no click, and promotes "opens in …" to the row', async () => {
		const service = mkService([
			mkCell('gated', {
				envName: 'dev',
				envRank: 1,
				gateLabel: 'Business Hours Only',
				gateHint: {
					cluster: '',
					namespace: 'widget-dev',
					rolloutName: 'widget-app',
					gateName: 'business-hours-gate'
				}
			})
		]);

		const rolloutResponse: RolloutResponse = {
			rollout: {
				metadata: { name: 'widget-app', namespace: 'widget-dev' },
				status: { gates: [{ name: 'business-hours-gate' }] }
			} as never,
			rolloutGates: { items: [] }
		};
		const nextTransition = new Date(NOW.getTime() + 28 * 60 * 60_000).toISOString(); // 1d 4h out
		const schedulesResponse = {
			rolloutSchedules: {
				items: [
					{
						metadata: { name: 'business-hours', annotations: {} },
						spec: { action: 'Allow', timezone: 'America/New_York' },
						status: { active: false, nextTransition, managedGates: ['business-hours-gate'] }
					}
				]
			}
		};

		const fetchMock = vi.fn((url: string) => {
			if (url.includes('/schedules')) {
				return Promise.resolve(new Response(JSON.stringify(schedulesResponse), { status: 200 }));
			}
			return Promise.resolve(new Response(JSON.stringify(rolloutResponse), { status: 200 }));
		});
		vi.stubGlobal('fetch', fetchMock);

		renderCard(service);

		// ⛔ NO CLICK — this is the one cell in the service, so it is the
		// frontier by construction, and item 2 asks for exactly one eager
		// fetch here.
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(screen.getByText(/opens in 1d 4h/)).toBeInTheDocument());
	});

	// ⭐ ROUND 3 (2026-09-10, third operator walk, "NO TIMER IS COUNTING THIS
	// DOWN") REFINES item 1: only a NORMAL ORDER wait (`queued`/`promoting`)
	// is an honest estimate of WHEN. The frontier cell here is `queued`
	// (waiting its own turn), not `gated` — see the dedicated test below for
	// why a `gated` frontier must now stay silent even with samples.
	test('CHANGES-2026-09-10 §7, item 1: the frontier cell prints "usually N min once it starts" — every other held/not-built cell stays silent', () => {
		const service = mkService([
			mkCell('queued', { envName: 'dev', envRank: 1, gateSubject: 'staging', usuallyMs: 12 * 60_000 }),
			mkCell('not-built', { envName: 'staging', envRank: 4, usuallyMs: 9 * 60_000 })
		]);
		renderCard(service);
		expect(screen.getByText('usually 12 min once it starts')).toBeInTheDocument();
		// The non-frontier `not-built` cell prints nothing, per item 1's own
		// "everywhere else stays silent" — never a second estimate on this row.
		expect(screen.queryByText(/usually 9 min/)).not.toBeInTheDocument();
	});

	// ⭐ ROUND 3 (2026-09-10, third operator walk). Live bug: PR #4's own
	// dependency wait on `api ^1.68.0` (nobody has released it) printed
	// "usually 1 min once it starts" directly beside a verdict that ALSO
	// says "will not move on its own" — a direct contradiction. A `gated`
	// hold clears on a rule, not a countdown, so it must stay silent even
	// when `usuallyMs` is set.
	test('ROUND 3: a gated (or waiting-upstream/pinned) frontier never prints "usually N min" — no timer is counting it down', () => {
		const service = mkService([
			mkCell('gated', { envName: 'dev', envRank: 1, gateLabel: 'a-rule', usuallyMs: 12 * 60_000 })
		]);
		renderCard(service);
		expect(screen.queryByText(/usually 12 min/)).not.toBeInTheDocument();
	});

	// ══ ROUND 2, R2.3 — THE STAGE-ROW GRAMMAR ═══════════════════════════════

	test('R2.3: every row draws a 28px status disc', () => {
		const service = mkService([
			mkCell('live', { envName: 'dev', since: '2026-09-10T10:00:00Z' }),
			mkCell('gated', { envName: 'staging', envRank: 4, gateLabel: 'a-rule' })
		]);
		const { container } = renderCard(service);
		const discs = container.querySelectorAll('.rounded-full.h-7.w-7, .h-7.w-7.rounded-full');
		expect(discs.length).toBe(2);
	});

	test('R2.3: a connector joins consecutive STAGE rows only, never into or within the production SET', () => {
		// ⚠️ Deliberately NOT four identical `live` cells — `PipelineCard`'s
		// own item-7 fold collapses a service whose every cell prints the
		// SAME `cellStateSentence` into one line with no rows at all, which
		// would make this test pass for the wrong reason (no rows, so no
		// connectors either). Four distinct states keep the per-row list
		// rendering, which is what this test is actually about.
		const service = mkService([
			mkCell('live', { envName: 'dev', envRank: 1, since: '2026-09-10T10:00:00Z' }),
			mkCell('deploying', { envName: 'staging', envRank: 4 }),
			mkCell('live', { envName: 'prod-us', envRank: 7, since: '2026-09-10T09:00:00Z' }),
			mkCell('baking', { envName: 'prod-eu', envRank: 7, since: '2026-09-10T11:56:00Z', bakeLeftMs: 4 * 60_000 })
		]);
		const { container } = renderCard(service);
		// One connector segment sits BETWEEN the two stage rows (dev/staging);
		// none reaches into the prod set and none joins the two prod regions.
		const connectors = container.innerHTML.match(/left-\[29px\]/g) ?? [];
		expect(connectors.length).toBe(2); // dev's "below" stub + staging's "above" stub
	});

	test('R2.3: a queued/promoting row draws a neutral clock disc, never the held pause icon', () => {
		const service = mkService([
			mkCell('live', { envName: 'dev', envRank: 1, since: '2026-09-10T10:00:00Z' }),
			mkCell('queued', { envName: 'staging', envRank: 4, gateSubject: 'dev' }),
			mkCell('promoting', { envName: 'prod', envRank: 7 })
		]);
		const { container } = renderCard(service);
		// Caught live on `0afab6f35627`'s `hello-api-app`: the queued/promoting
		// discs used to route through `BakeStatusIcon`'s `'None'` case, which
		// draws the SAME `PauseSolid` glyph this table reserves for `held` —
		// the exact "amber reserved for stuck" ambiguity R2.5(b) already
		// fixed once for the landing grid. Neither row may render it here.
		const pauseIcons = container.querySelectorAll('svg path[d*="M8 5a2 2 0 0 0-2 2v10"]');
		expect(pauseIcons.length).toBe(0);
		expect(screen.getByText('queued', { selector: '.chip' })).toBeInTheDocument();
		expect(screen.getByText('promoting', { selector: '.chip' })).toBeInTheDocument();
	});

	// ⭐ ROUND 3, ITEM 5 (2026-09-10) — HELD NEVER FOLDS, EVEN WHEN EVERY CELL
	// AGREES. Live bug: PR #4's `hello-frontend-app` was held on the SAME
	// dependency gate in dev/staging/prod (identical `cellStateSentence` AND
	// `reasonTail`), and the old fold collapsed all three into one line with
	// no disc, no env chip, no HELD chip and no per-row time — the exact
	// facts a held row exists to carry. Folding stays for a row with nothing
	// to say (`queued`/`live`, tested elsewhere in this file); a held row
	// always draws its full stage-row grammar.
	test('ROUND 3, item 5: three identically-held cells draw three rows, not one folded line', () => {
		const service = mkService([
			mkCell('gated', {
				envName: 'dev',
				envRank: 1,
				gateSubject: 'hello-api-app',
				reason: 'waiting on hello-api-app'
			}),
			mkCell('gated', {
				envName: 'staging',
				envRank: 4,
				gateSubject: 'hello-api-app',
				reason: 'waiting on hello-api-app'
			}),
			mkCell('gated', {
				envName: 'prod',
				envRank: 7,
				gateSubject: 'hello-api-app',
				reason: 'waiting on hello-api-app'
			})
		]);
		const { container } = renderCard(service);
		const discs = container.querySelectorAll('.rounded-full.h-7.w-7, .h-7.w-7.rounded-full');
		expect(discs.length).toBe(3);
		expect(screen.getAllByText('HELD', { selector: '.chip' })).toHaveLength(3);
	});

	test('R2.3: the state chip prints HELD for gated/waiting-upstream/pinned, and the plain state word otherwise', () => {
		const service = mkService([
			mkCell('gated', { envName: 'dev', envRank: 1, gateLabel: 'a-rule' }),
			mkCell('live', { envName: 'staging', envRank: 4, since: '2026-09-10T10:00:00Z' }),
			mkCell('failed', { envName: 'prod', envRank: 7 })
		]);
		renderCard(service);
		expect(screen.getAllByText('HELD', { selector: '.chip' })).toHaveLength(1);
		expect(screen.getByText('live', { selector: '.chip' })).toBeInTheDocument();
		expect(screen.getByText('failed', { selector: '.chip' })).toBeInTheDocument();
	});
});
