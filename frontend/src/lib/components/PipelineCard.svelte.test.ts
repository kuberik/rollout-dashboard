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
		...overrides
	};
}

function mkService(cells: PrCell[], overrides: Partial<PrService> = {}): PrService {
	return {
		appName: 'widget-app',
		sourceRepo: 'github.com/acme/widget',
		cells,
		furthest: 'live in dev',
		leadTimeMs: null,
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
	test('header names the service, links to its app page, and shows the rollup', () => {
		const service = mkService([mkCell('live', { since: '2026-09-10T10:00:00Z' })], {
			furthest: 'live in dev'
		});
		renderCard(service);
		const link = screen.getByRole('link', { name: 'widget-app' });
		expect(link).toHaveAttribute('href', '/apps/widget-app');
		expect(screen.getByText('live in dev')).toBeInTheDocument();
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
		expect(screen.getByText('gated by Business Hours Only')).toBeInTheDocument();
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
		expect(screen.getAllByText('held')).toHaveLength(3);
	});

	test('ROLLED BACK names the one state that is one', () => {
		const service = mkService([
			mkCell('rolled-back', { releaseLabel: '2.65.0-64', reason: 'rolled back to 2.65.0-64' })
		]);
		renderCard(service);
		expect(screen.getByText('rolled back')).toBeInTheDocument();
		expect(screen.queryByText('held')).not.toBeInTheDocument();
	});

	test('no "why?" disclosure when the cell names no gate', () => {
		const service = mkService([mkCell('live')]);
		renderCard(service);
		expect(screen.queryByText('why?')).not.toBeInTheDocument();
	});

	test('"why?" fetches the single-rollout endpoint once, lazily, and prints the gate\'s kind', async () => {
		const service = mkService([
			mkCell('gated', {
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

		const fetchMock = vi.fn((_url: string) =>
			Promise.resolve(new Response(JSON.stringify(rolloutResponse), { status: 200 }))
		);
		vi.stubGlobal('fetch', fetchMock);

		renderCard(service);

		// ⛔ NEVER UP FRONT — the row rendered and nothing fetched yet.
		expect(fetchMock).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByText('why?'));

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(fetchMock.mock.calls[0][0]).toContain('/rollouts/widget-dev/widget-app');

		await waitFor(() => expect(screen.getByText('Kind')).toBeInTheDocument());
		expect(screen.getByText('a manual approval')).toBeInTheDocument();

		// Closing and reopening never fires a second fetch (`staleTime: Infinity`).
		await fireEvent.click(screen.getByText('why?'));
		await fireEvent.click(screen.getByText('why?'));
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
