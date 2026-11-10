import { describe, test, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import CadenceStrip from './CadenceStrip.svelte';

const NOW = new Date('2026-10-09T12:00:00Z').getTime();

const history = [
	{
		timestamp: new Date(NOW - 60_000).toISOString(),
		bakeStatus: 'InProgress',
		version: { tag: 'b-3', version: '3' }
	},
	{
		timestamp: new Date(NOW - 3_600_000).toISOString(),
		bakeEndTime: new Date(NOW - 3_000_000).toISOString(),
		bakeStatus: 'Failed',
		bakeStatusMessage: 'HealthCheck failed: warmup timed out',
		version: { tag: 'b-2', version: '2' }
	},
	{
		timestamp: new Date(NOW - 7_200_000).toISOString(),
		bakeEndTime: new Date(NOW - 6_900_000).toISOString(),
		bakeStatus: 'Succeeded',
		version: { tag: 'b-1', version: '1' }
	}
];

/** Ten deploys bunched like checkout-edge-prod's Oct 6 evening, then a long one. */
const dense = [
	{ timestamp: new Date(NOW - 20 * 60_000).toISOString(), bakeStatus: 'InProgress', version: { tag: 'd-0' } },
	...Array.from({ length: 8 }, (_, k) => ({
		timestamp: new Date(NOW - 3 * 86_400_000 - k * 30 * 60_000).toISOString(),
		bakeStatus: k === 3 ? 'Failed' : 'Succeeded',
		version: { tag: `d-${k + 1}` }
	})),
	{ timestamp: new Date(NOW - 9 * 86_400_000).toISOString(), bakeStatus: 'Succeeded', version: { tag: 'd-9' } }
];

/** The SAME build (tag `r1`) deployed twice, far enough apart in an `all`
 *  window that BOTH segments clear the "same build" text's own pixel ask —
 *  the repeat (index 0, the shorter, more recent span) is wide enough for
 *  a label but is not the widest occurrence of its sha. */
const repeatBuild = [
	{ timestamp: new Date(NOW - 2 * 86_400_000).toISOString(), bakeStatus: 'Succeeded', version: { tag: 'r1' } },
	{ timestamp: new Date(NOW - 12 * 86_400_000).toISOString(), bakeStatus: 'Succeeded', version: { tag: 'r1' } }
];

describe('CadenceStrip', () => {
	test('draws one tenure segment per history entry', () => {
		const { container } = render(CadenceStrip, { history, now: NOW });
		expect(container.querySelectorAll('.cadence-segment')).toHaveLength(3);
	});

	test('the live entry ends at Now with its state line, never a yellow fill', () => {
		const { container } = render(CadenceStrip, { history, now: NOW });
		const head = container.querySelector<HTMLElement>('.cadence-segment[data-state="checking"]')!;
		expect(head).not.toBeNull();
		expect(head.style.backgroundColor).toBe('var(--k-line-strong)');
		const line = head.querySelector<HTMLElement>('.cadence-live-line')!;
		expect(line.style.backgroundColor).toBe('var(--k-progress-solid)');
		// Carved out of the plot: its right edge IS the track's right edge.
		const segs = Array.from(container.querySelectorAll<HTMLElement>('.cadence-segment'));
		const last = segs[segs.length - 1];
		expect(last).toBe(head);
		expect(parseFloat(head.style.left) + parseFloat(head.style.width)).toBeCloseTo(960, 0);
	});

	test('a failed entry fills with danger ink; a healthy past one stays neutral (no green)', () => {
		const { container } = render(CadenceStrip, { history, now: NOW });
		const failed = container.querySelector<HTMLElement>('.cadence-segment[data-state="failed"]')!;
		const healthy = container.querySelector<HTMLElement>('.cadence-segment[data-state="healthy"]')!;
		expect(failed.style.backgroundColor).toBe('var(--k-danger-solid)');
		expect(healthy.style.backgroundColor).toBe('var(--k-line-strong)');
		// The failed build gets its sha even though it ran for minutes of a 2h span.
		expect(failed.textContent).toContain('2');
	});

	test('segments sit left to right in time with a 1px gap and never overlap', () => {
		const { container } = render(CadenceStrip, { history: dense, now: NOW, range: '7d' });
		const boxes = Array.from(container.querySelectorAll<HTMLElement>('.cadence-segment')).map((el) => ({
			l: parseFloat(el.style.left),
			w: parseFloat(el.style.width)
		}));
		// ⭐ NO LONGER ONE BOX PER ENTRY (AD round 6, item 3): the dense
		// fixture's 8 bunched builds (30m apart, inside a 7d window) are
		// exactly the "overlapping sub-8px hit areas" defect — some of them
		// now merge into cluster boxes, so the box COUNT drops below the
		// entry count, but the non-overlap/gap invariant below still holds
		// for whatever boxes (segment or cluster) are actually on screen.
		expect(boxes.length).toBeGreaterThan(0);
		expect(boxes.length).toBeLessThan(dense.length);
		for (let k = 1; k < boxes.length; k++) {
			expect(boxes[k].l - (boxes[k - 1].l + boxes[k - 1].w)).toBeCloseTo(1, 5);
			expect(boxes[k - 1].w).toBeGreaterThan(0);
		}
	});

	test('a run of adjacent sub-8px builds merges into one cluster mark with its own hover list', async () => {
		const onRollback = vi.fn();
		const { container } = render(CadenceStrip, {
			history: dense,
			now: NOW,
			range: '7d',
			onRollback,
			diffHref: () => '/diff/x'
		});
		const cluster = container.querySelector<HTMLElement>('.cadence-cluster')!;
		expect(cluster).not.toBeNull();
		// Wide enough to be a real ≥8px hit area, never a sub-8px sliver.
		expect(parseFloat(cluster.style.width)).toBeGreaterThanOrEqual(8);
		const n = Number(cluster.querySelector('.cadence-cluster-count')!.textContent);
		expect(n).toBeGreaterThanOrEqual(2);
		await fireEvent.mouseEnter(cluster);
		const rows = await screen.findAllByRole('listitem');
		expect(rows.length).toBe(n);
		// Each row offers the same two actions a single segment's card does
		// (diffHref is given for every index here, so every row gets one;
		// onRollback is only offered for a previous HEALTHY build, same
		// gate the single-segment card itself uses).
		expect(screen.getAllByLabelText('View diff').length).toBe(n);
		expect(screen.getAllByLabelText('Roll back to this').length).toBeGreaterThan(0);
	});

	// AD round 7, item 3: "the phone cluster mark gets a ≥44px tap target,
	// and a tap opens the list card." Regression for the specific bug found
	// live: a touch `tap()` dispatches a synthetic `mouseenter` BEFORE its
	// own `click` (confirmed via a real device-emulation trace), which a
	// naive toggle-on-`click` read as "already open" and immediately closed
	// — so the card opened and closed within one gesture, appearing dead.
	test('a tap on the cluster mark opens its list card, and a second tap closes it', async () => {
		const { container } = render(CadenceStrip, { history: dense, now: NOW, range: '7d' });
		const cluster = container.querySelector<HTMLElement>('.cadence-cluster')!;
		// The tap gesture: a synthetic mouseenter fires before the click, same
		// order a real touch tap produces.
		await fireEvent.mouseEnter(cluster);
		await fireEvent.click(cluster);
		expect(await screen.findAllByRole('listitem')).not.toHaveLength(0);
		// A second tap (another mouseenter + click) closes it.
		await fireEvent.mouseEnter(cluster);
		await fireEvent.click(cluster);
		await waitFor(() => expect(screen.queryAllByRole('listitem')).toHaveLength(0));
	});

	test('tick labels never collide, and "Now" is the right edge', () => {
		const { container } = render(CadenceStrip, { history: dense, now: NOW, range: '7d' });
		const labels = Array.from(container.querySelectorAll<HTMLElement>('.cadence-tick-label'));
		expect(labels[labels.length - 1].textContent).toBe('Now');
		const lefts = labels.map((l) => parseFloat(l.style.left));
		for (let k = 1; k < lefts.length; k++) expect(lefts[k]).toBeGreaterThan(lefts[k - 1] + 30);
		expect(new Set(labels.map((l) => l.textContent)).size).toBe(labels.length);
	});

	test('a rollback entry draws the neutral UndoOutline mark at its segment start', () => {
		const { container } = render(CadenceStrip, {
			history,
			now: NOW,
			rollbackIndices: new Set([2])
		});
		expect(container.querySelector('.cadence-marker-rollback')).not.toBeNull();
	});

	test('one hover-card template: Roll back only on a previous healthy build, failure named on a failed one', async () => {
		const onRollback = vi.fn();
		const { container } = render(CadenceStrip, {
			history,
			now: NOW,
			onRollback,
			diffHref: (i: number) => (i < 2 ? `/diff/${i}` : undefined)
		});
		const healthy = container.querySelector<HTMLElement>('.cadence-segment[data-state="healthy"]')!;
		await fireEvent.mouseEnter(healthy);
		expect(screen.getByRole('button', { name: /Roll back to this/ })).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: /Roll back to this/ }));
		expect(onRollback).toHaveBeenCalledWith(2);
		await fireEvent.mouseLeave(healthy);
		await new Promise((r) => setTimeout(r, 150));

		const failed = container.querySelector<HTMLElement>('.cadence-segment[data-state="failed"]')!;
		await fireEvent.mouseEnter(failed);
		expect(screen.queryByRole('button', { name: /Roll back to this/ })).toBeNull();
		expect(screen.getByText('HealthCheck failed: warmup timed out')).toBeInTheDocument();
		expect(screen.getByText('Not offered as a rollback')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'View diff' })).toHaveAttribute('href', '/diff/1');
	});

	test('the range pills render 1d/7d/30d/All, and the active one is aria-pressed', () => {
		render(CadenceStrip, { history, now: NOW, range: '7d' });
		const pressed = screen.getAllByRole('button', { pressed: true });
		expect(pressed.map((b) => b.textContent?.trim())).toContain('7d');
	});

	test('clicking a range pill calls onRangeChange with the preset', async () => {
		const onRangeChange = vi.fn();
		render(CadenceStrip, { history, now: NOW, range: 'all', onRangeChange });
		await fireEvent.click(screen.getByRole('button', { name: '30d' }));
		expect(onRangeChange).toHaveBeenCalledWith('30d');
	});

	test('clicking a segment calls onSelect with its history index', async () => {
		const onSelect = vi.fn();
		const { container } = render(CadenceStrip, { history, now: NOW, onSelect });
		const segs = container.querySelectorAll('.cadence-segment');
		await fireEvent.click(segs[segs.length - 1]);
		expect(onSelect).toHaveBeenCalled();
	});

	test('"Compare namespace" only renders when a toggle handler is given', () => {
		render(CadenceStrip, { history, now: NOW });
		expect(screen.queryByText('Compare namespace')).toBeNull();
	});

	// AD round 7, item 4: "label every segment wider than its label. A
	// repeat build reads 'same build' in muted text, never blank."
	test('a repeat build wide enough for a label reads "same build", never blank', () => {
		const { container } = render(CadenceStrip, { history: repeatBuild, now: NOW, range: 'all' });
		const segs = Array.from(container.querySelectorAll<HTMLElement>('.cadence-segment'));
		expect(segs.length).toBe(2);
		const labelled = segs.filter((s) => s.querySelector('.cadence-segment-label')?.textContent === 'r1');
		const repeats = segs.filter((s) => s.querySelector('.cadence-segment-label')?.textContent === 'same build');
		// The sha prints on exactly one (its widest) segment; the other,
		// also wide enough for text, reads "same build" — never nothing.
		expect(labelled.length).toBe(1);
		expect(repeats.length).toBe(1);
	});

	// AD round 8, item 3: "'same build' at every range, not just All. A
	// build's widest segment carries its sha." The layout math is already
	// range-scoped (every width is proportional to the CURRENT window, not
	// the lifetime one), so this is the same fixture under the 7d preset
	// rather than `all` — both entries still fall inside a 7d window (one
	// clipped at the window's own start), and the rule must hold the same.
	test('"same build" and the widest-carries-the-sha rule hold under a scoped range too (7d, not all)', () => {
		const { container } = render(CadenceStrip, { history: repeatBuild, now: NOW, range: '7d' });
		const segs = Array.from(container.querySelectorAll<HTMLElement>('.cadence-segment'));
		expect(segs.length).toBe(2);
		const labelled = segs.filter((s) => s.querySelector('.cadence-segment-label')?.textContent === 'r1');
		const repeats = segs.filter((s) => s.querySelector('.cadence-segment-label')?.textContent === 'same build');
		expect(labelled.length).toBe(1);
		expect(repeats.length).toBe(1);
	});
});
