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
		// ⭐ ROUND 3, ITEM 5 (2026-09-10) — THE FAMILY WORD, NOT THE RAW ENV
		// NAME (`envFamilyWord('staging')` → `'STG'`) — see the component's
		// own doc for why. `.t-chip` uppercases in CSS, not in the DOM's own
		// text — same convention every other `Chip` label in this product
		// follows.
		expect(screen.getByText('STG')).toBeInTheDocument();
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
		expect(screen.getByText('not deployed anywhere yet')).toBeInTheDocument();
	});

	// ⭐ ROUND 3, ITEM 1(b) (2026-09-10 fix pass) — the retention caveat names
	// the ROLLOUT's own history buffer, a fact independent of whether this
	// change ever ran here; pairing it with "0 deploys" read as a second,
	// confusing claim, so it never renders alongside the empty-feed line.
	test('the retention caveat never prints beside an empty feed', () => {
		render(ChangeHistoryCard, {
			props: {
				rows: [],
				retentionNote: 'History keeps the last 10 deploys per service; a build deployed earlier is not recorded.'
			}
		});
		expect(screen.queryByText(/History keeps the last/)).not.toBeInTheDocument();
	});

	// ⭐ ROUND 3, ITEM 5 (2026-09-10)
	test('caps at 6 rows and shows the rest behind "Show N more"', async () => {
		const { fireEvent } = await import('@testing-library/svelte');
		const rows = Array.from({ length: 11 }, (_, i) =>
			mkRow({ key: `k${i}`, timestamp: new Date(Date.parse(NOW.toISOString()) - i * 3600_000).toISOString() })
		);
		render(ChangeHistoryCard, { props: { rows, now: NOW } });
		expect(screen.getAllByText('1.66.0-66')).toHaveLength(6);
		const more = screen.getByText('Show 5 more ›');
		await fireEvent.click(more);
		expect(screen.getAllByText('1.66.0-66')).toHaveLength(11);
		expect(screen.queryByText(/Show \d+ more/)).not.toBeInTheDocument();
	});

	test('the sha prints once, not duplicated, when it equals the display version', () => {
		render(ChangeHistoryCard, {
			props: { rows: [mkRow({ displayVersion: 'f7a46ae', shortRevision: 'f7a46ae' })] }
		});
		expect(screen.getAllByText('f7a46ae')).toHaveLength(1);
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
