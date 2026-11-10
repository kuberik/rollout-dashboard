import { it, expect } from 'vitest';
import fs from 'node:fs';
import { stageBuilds, skippedPredicate, chainWaitLabel } from './skipped-builds';
import { buildGateContext, promotionHoldBreakdown } from './blocking-story';
import { heldBuilds } from './held';

it('A8: builds older than what staging runs are skipped, not waiting for staging', () => {
	const d = JSON.parse(fs.readFileSync('src/lib/components/new/fixtures/qa-approval-only-held.json', 'utf8'));
	const prod = d.rollouts.find((r: any) => r.metadata.namespace === 'hello-world-prod');
	const ctx = buildGateContext({ environments: { items: d.environments }, rolloutDependencies: null, rolloutGates: d.rolloutGates });
	const stages = stageBuilds(prod, d.rollouts);
	const hb = heldBuilds(promotionHoldBreakdown(prod, ctx, { place: 'prod' }), 'prod', skippedPredicate(prod, stages));
	expect(hb.held.map((h) => h.build)).toEqual(['e7c1b60', '715ccd1', 'd993f4d']);
	expect(hb.skipped.map((s) => s.entry.build).sort()).toEqual(['1e6c579', '1ee03d9']);
	expect(hb.skipped.every((s) => s.stage === 'staging')).toBe(true);
	expect(hb.waiting).toEqual([]);
});

it('QA #23: Newer builds rows say "Skipped by staging" for exactly the builds the banner counts as skipped', () => {
	const d = JSON.parse(fs.readFileSync('src/lib/components/new/fixtures/qa-approval-only-held.json', 'utf8'));
	const prod = d.rollouts.find((r: any) => r.metadata.namespace === 'hello-world-prod');
	const skipped = skippedPredicate(prod, stageBuilds(prod, d.rollouts));
	expect(chainWaitLabel(skipped, { tag: '1e6c579' }, 'staging').text).toBe('Skipped by staging');
	expect(chainWaitLabel(skipped, { tag: '1ee03d9' }, 'staging').text).toBe('Skipped by staging');
	expect(chainWaitLabel(skipped, { tag: 'e7c1b60' }, 'staging').text).toBe('Waits for staging');
});
