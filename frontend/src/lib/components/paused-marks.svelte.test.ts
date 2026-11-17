import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import BakeStatusIcon from './BakeStatusIcon.svelte';
import RestGlyph from './RestGlyph.svelte';
import StatusMark from './StatusMark.svelte';
import PendingCheckBlock from './PendingCheckBlock.svelte';
import { currentRowChip } from '$lib/view-models/history-current-chip';
import { agoOf } from '$lib/view-models/health-failures';

vi.mock('$lib/stores/time', async () => {
	const { readable } = await import('svelte/store');
	return { now: readable(new Date('2026-11-15T18:50:59Z')) };
});

const PAUSE = 'M9 5.25v13.5'; // HeldGlyph's two bars

describe('a paused bake is the held pause glyph, never the checking rings', () => {
	it('BakeStatusIcon: held ink, pause bars, sr text "paused"', () => {
		const { container } = render(BakeStatusIcon, { bakeStatus: 'InProgress', state: 'paused', size: 'small' });
		expect(container.innerHTML).toContain(PAUSE);
		expect(container.querySelector('circle')).toBeNull();
		expect(container.querySelector('svg')!.getAttribute('class')).toContain('text-held');
		expect(container.querySelector('.sr-only')!.textContent).toBe('paused');
	});
	it('a running bake keeps the checking rings and the word "checking"', () => {
		const { container } = render(BakeStatusIcon, { bakeStatus: 'InProgress', size: 'small' });
		expect(container.querySelector('circle')).not.toBeNull();
		expect(container.querySelector('.sr-only')!.textContent).toBe('checking');
	});
	it('RestGlyph (the History spine) passes the paused state through', () => {
		const { container } = render(RestGlyph, { bakeStatus: 'InProgress', state: 'paused' });
		expect(container.innerHTML).toContain(PAUSE);
		expect(container.querySelector('.sr-only')!.textContent).toBe('paused');
	});
	it('StatusMark paused draws the pause and carries the label it is given', () => {
		const { container } = render(StatusMark, { state: 'paused', label: 'paused' });
		expect(container.innerHTML).toContain('M9 5.5v13');
		expect(container.querySelector('.sr-only')!.textContent).toBe('paused');
	});
});

describe('one failure word per History row', () => {
	it('a bake that ended Failed says Failed; Failing is a check failing right now', () => {
		expect(currentRowChip('Failed', null)).toBe('Failed');
		expect(currentRowChip('Failed', null)).not.toMatch(/failing/i);
	});
});

describe('a pending check with no observation draws the same block as its siblings', () => {
	it('name, "pending", time, then the message as the evidence line with a class glyph in state ink', () => {
		const { container } = render(PendingCheckBlock, { name: 'Prometheus alerts', cls: 'prometheus', message: 'Prometheus query failed: Get "http://prom"', time: '18:38' });
		const head = container.querySelector('[data-testid="hist-check"] > div')!;
		expect(head.textContent).toContain('Prometheus alerts');
		expect(head.textContent).toContain('pending · 18:38');
		const row = container.querySelector('[data-testid="failure-source"]')!;
		expect(row.querySelector('svg')!.getAttribute('class')).toContain('text-progress');
		const msg = row.querySelector('span')!;
		expect(msg.className).toContain('t-meta');
		expect(msg.textContent).toContain('Prometheus query failed');
	});
});

describe('the banner age: one helper, one wording, floored', () => {
	const since = '2026-11-15T18:38:00Z';
	it('"Xm ago", floored, from the same instant', () => {
		expect(agoOf(since, new Date('2026-11-15T18:50:59Z'))).toBe('12m ago');
		expect(agoOf(since, new Date('2026-11-15T18:49:59Z'))).toBe('11m ago');
	});
});

import FailureBanner from './new/FailureBanner.svelte';

describe('the list-page banner prints the age on the health line, as the rollout banner does', () => {
	it('"12m ago" off the live clock ends the health line; the meta line keeps only the build', () => {
		const b = { title: 'orders-hub failing in prod', check: null, line: '2 health checks failing', change: null, openHref: '/x', rollbackHref: null, meta: { since: '11m', sinceAt: '2026-11-15T18:38:00Z', build: '1.4.0' } };
		const { container } = render(FailureBanner, { b });
		const meta = container.querySelector('[data-statement-meta]')!.textContent!;
		expect(meta).toContain('1.4.0');
		expect(meta).not.toMatch(/ago|\bfor\b/);
		expect(container.querySelector('[data-statement-body]')!.textContent).toMatch(/2 health checks failing\s*·\s*12m\s*ago/);
	});

	it('the build leads the change line in mono; no bare build row, no build on the meta line', () => {
		const b = { title: 'orders-hub failing in prod', check: null, line: '2 health checks failing', change: { title: 'Fix flaky readiness handler', ref: '#54', person: 'mark-collins' }, openHref: '/x', rollbackHref: null, meta: { since: '11m', sinceAt: '2026-11-15T18:38:00Z', build: '1.4.0' } };
		const { container } = render(FailureBanner, { b });
		const line = container.querySelector('[data-ap-change]')!;
		expect(line.querySelector('[data-ap-build]')!.textContent).toBe('1.4.0');
		expect(line.querySelector('[data-ap-build]')!.className).toContain('t-code');
		expect(line.textContent).toMatch(/^\s*1\.4\.0\s*\u00b7\s*Fix flaky readiness handler\s*#54\s*M?mark-collins/);
		expect(container.querySelector('[data-statement-meta]')).toBeNull();
	});
});
