import { describe, test, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';

// Clock pinned at 13:05 on 2026-11-10.
vi.mock('$lib/stores/time', async () => {
	const { readable } = await import('svelte/store');
	return { now: readable(new Date('2026-11-10T13:05:00Z')) };
});
import AppPulse from './AppPulse.svelte';

const entry = (id: number, timestamp: string, bakeStatus: string, bakeEndTime?: string) => ({ id, version: `1.0.${id}`, timestamp, bakeStatus, ...(bakeEndTime ? { bakeEndTime } : {}) });
const place = (history: unknown[]) => ({ status: { history } }) as never;
const printed = () => (screen.getByText('Last failure').parentElement?.textContent ?? '').replace('Last failure', '').trim();

describe('AppPulse: Last failure on the app Summary', () => {
	test('a deploy that started 12:35 and failed 12:45 prints 20m ago', () => {
		render(AppPulse, { days: 7, rollouts: [place([entry(1, '2026-11-10T12:35:00Z', 'Failed', '2026-11-10T12:45:00Z')])] });
		expect(printed()).toBe('20m ago');
	});
	test('with two failures the newer one wins', () => {
		render(AppPulse, {
			days: 7,
			rollouts: [place([entry(2, '2026-11-10T12:35:00Z', 'Failed', '2026-11-10T12:45:00Z'), entry(1, '2026-11-10T11:00:00Z', 'Failed', '2026-11-10T11:10:00Z')])]
		});
		expect(printed()).toBe('20m ago');
	});
	test('a failure older than the 7-day window is not printed', () => {
		render(AppPulse, { days: 7, rollouts: [place([entry(1, '2026-10-20T12:35:00Z', 'Failed', '2026-10-20T12:45:00Z')])] });
		expect(printed()).toBe('none in range');
	});
});
