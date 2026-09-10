import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import ChangeHistoryCard from './ChangeHistoryCard.svelte';
import type { ChangeHistoryRow } from '$lib/view-models/pr-pipeline';

const NOW = new Date('2026-09-10T12:00:00Z');

function mkRow(overrides: Partial<ChangeHistoryRow> = {}): ChangeHistoryRow {
	return {
		key: 'k1',
		appName: 'widget-app',
		envName: 'dev',
		theme: null,
		href: '/rollouts/hub/widget-dev/widget-app',
		displayVersion: '1.66.0-66',
		shortRevision: 'abc1234',
		bakeStatus: 'Succeeded',
		actorName: null,
		actorKind: null,
		timestamp: '2026-09-10T10:00:00Z',
		act: null,
		...overrides
	};
}

describe('ChangeHistoryCard', () => {
	test('the header names the card and rolls up the deploy count', () => {
		render(ChangeHistoryCard, { props: { rows: [mkRow(), mkRow({ key: 'k2' })] } });
		expect(screen.getByText('History')).toBeInTheDocument();
		expect(screen.getByText('2 deploys')).toBeInTheDocument();
	});

	test('singular "1 deploy" for one row', () => {
		render(ChangeHistoryCard, { props: { rows: [mkRow()] } });
		expect(screen.getByText('1 deploy')).toBeInTheDocument();
	});

	test('a row names the environment, the build, and — when known — the actor and time', () => {
		render(ChangeHistoryCard, {
			props: {
				rows: [
					mkRow({
						envName: 'staging',
						displayVersion: '1.66.0-66',
						shortRevision: 'abc1234',
						actorName: 'sam',
						actorKind: 'User',
						timestamp: '2026-09-10T10:00:00Z'
					})
				],
				now: NOW
			}
		});
		// `.t-chip` uppercases the label in CSS, not in the DOM's own text —
		// same convention every other `Chip` label in this product follows.
		expect(screen.getByText('staging')).toBeInTheDocument();
		expect(screen.getByText('1.66.0-66')).toBeInTheDocument();
		expect(screen.getByText('abc1234')).toBeInTheDocument();
		expect(screen.getByText('sam')).toBeInTheDocument();
		expect(screen.getByText('2h ago')).toBeInTheDocument();
	});

	test('a rollback entry carries the product\'s existing rollback mark, not a new one', () => {
		render(ChangeHistoryCard, {
			props: {
				rows: [
					mkRow({
						act: {
							kind: 'rollback',
							by: 2,
							from: '1.68.0-70',
							to: '1.66.0-66',
							word: 'Rolled back',
							sentence: 'Rolled back 2 releases: 1.68.0-70 → 1.66.0-66.'
						}
					})
				]
			}
		});
		expect(screen.getByText('Rolled back')).toBeInTheDocument();
	});

	test('no rollback chip on a plain forward deploy', () => {
		render(ChangeHistoryCard, {
			props: {
				rows: [
					mkRow({
						act: { kind: 'forward', by: 1, from: '1.65.0', to: '1.66.0-66', word: 'Moved forward', sentence: 'x' }
					})
				]
			}
		});
		expect(screen.queryByText('Rolled back')).not.toBeInTheDocument();
	});

	test('an empty feed states the fact rather than drawing an empty list', () => {
		render(ChangeHistoryCard, { props: { rows: [] } });
		expect(screen.getByText(/has not deployed anywhere on this cluster/)).toBeInTheDocument();
	});

	test('the retention caveat prints once, at the foot, only when passed', () => {
		const { unmount } = render(ChangeHistoryCard, { props: { rows: [mkRow()] } });
		expect(screen.queryByText(/History keeps the last/)).not.toBeInTheDocument();
		unmount();

		render(ChangeHistoryCard, {
			props: {
				rows: [mkRow()],
				retentionNote: 'History keeps the last 10 deploys per service; a build deployed earlier is not recorded.'
			}
		});
		expect(
			screen.getByText('History keeps the last 10 deploys per service; a build deployed earlier is not recorded.')
		).toBeInTheDocument();
	});
});
