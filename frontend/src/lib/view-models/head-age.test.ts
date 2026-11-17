import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { headDeployedAt } from './head-age';
import type { Rollout } from '../../types';

const r = (h: Record<string, unknown>) => ({ status: { history: [h] } }) as unknown as Rollout;

describe('the rollout header age', () => {
	it('counts from the head deploy, not from the bake start', () => {
		expect(headDeployedAt(r({ timestamp: '2026-11-16T10:00:00Z', bakeStartTime: '2026-11-16T10:02:00Z' }))).toBe('2026-11-16T10:00:00Z');
		expect(headDeployedAt(r({ bakeStartTime: '2026-11-16T10:02:00Z' }))).toBeNull();
		expect(headDeployedAt(null)).toBeNull();
	});
	it('the Logs tab reads it from there', () => {
		const logs = readFileSync(resolve(__dirname, '../../routes/rollouts/[cluster]/[namespace]/[name]/logs/+page.svelte'), 'utf8');
		expect(logs).toContain("import { headDeployedAt } from '$lib/view-models/head-age'");
		expect(logs).toMatch(/headDeployedAt\(rollout\)/);
		expect(logs).not.toMatch(/bakeStartTime/);
	});
	it.each(['+page.svelte', 'history/+page.svelte', 'gates/+page.svelte'])('the %s header age reads the same source', (f) => {
		const src = readFileSync(resolve(__dirname, '../../routes/rollouts/[cluster]/[namespace]/[name]/' + f), 'utf8');
		expect(src).toContain("import { headDeployedAt } from '$lib/view-models/head-age'");
		expect(src).toMatch(/formatTimeAgoCompact\((headDeployedAt\(rollout\)|headAt\b)/);
	});
});
