import { it, expect } from 'vitest';
import fs from 'node:fs';
import { blockingStory, buildGateContext } from './blocking-story';

/* QA (TL): live hub, prod runs 785ffe0; 5 candidates; the chain (ghd) gate allows only e7c1b60/715ccd1/d993f4d, the approval gate allows none.
   The banner's lead counts what the approval holds HERE (3, same as the Gates tab's Held builds) and names the rest separately. */
it('the banner lead counts the builds held here and names the ones that have not reached staging', () => {
	const d = JSON.parse(fs.readFileSync('src/lib/components/new/fixtures/qa-approval-only-held.json', 'utf8'));
	const prod = d.rollouts.find((r: any) => r.metadata.namespace === 'hello-world-prod');
	const ctx = buildGateContext({ environments: { items: d.environments }, rolloutDependencies: d.rolloutDependencies ?? null, rolloutGates: d.rolloutGates });
	const story = blockingStory(prod, ctx, { place: 'prod' }) as any;
	const text = JSON.stringify(story);
	console.log(story.consequence ?? text.slice(0, 600));
	expect(story.consequence).toMatch(/^3 newer builds are waiting here; 2 more haven't reached \w+ yet\./);
});

import { skippedPredicate, stageBuilds } from './skipped-builds';
it('A8: builds staging already passed over are "skipped by staging", not "haven\'t reached staging yet"', () => {
	const d = JSON.parse(fs.readFileSync('src/lib/components/new/fixtures/qa-approval-only-held.json', 'utf8'));
	const prod = d.rollouts.find((r: any) => r.metadata.namespace === 'hello-world-prod');
	const ctx = buildGateContext({ environments: { items: d.environments }, rolloutDependencies: d.rolloutDependencies ?? null, rolloutGates: d.rolloutGates });
	const story = blockingStory(prod, ctx, { place: 'prod', skipped: skippedPredicate(prod, stageBuilds(prod, d.rollouts)) }) as any;
	expect(story.consequence).toMatch(/^3 newer builds are waiting here; 2 were skipped by staging, which runs a newer build\. Nothing promotes itself/);
});

import { promotionHoldBreakdown } from './blocking-story';
import { heldBuilds } from './held';
it('heldBuilds: 3 builds held here by the approval, 2 waiting for staging (one count for every surface)', () => {
	const d = JSON.parse(fs.readFileSync('src/lib/components/new/fixtures/qa-approval-only-held.json', 'utf8'));
	const prod = d.rollouts.find((r: any) => r.metadata.namespace === 'hello-world-prod');
	const ctx = buildGateContext({ environments: { items: d.environments }, rolloutDependencies: d.rolloutDependencies ?? null, rolloutGates: d.rolloutGates });
	const hb = heldBuilds(promotionHoldBreakdown(prod, ctx, { place: 'prod' }), 'prod');
	expect(hb.held.map((h) => h.build)).toEqual(['e7c1b60', '715ccd1', 'd993f4d']);
	expect(hb.waiting.map((w) => w.stage)).toEqual(['staging', 'staging']);
});

it('A4: classified gates carry the display name the Gates tab prints, never the raw resource id', () => {
	const d = JSON.parse(fs.readFileSync('src/lib/components/new/fixtures/qa-approval-only-held.json', 'utf8'));
	const prod = d.rollouts.find((r: any) => r.metadata.namespace === 'hello-world-prod');
	const ctx = buildGateContext({ environments: { items: d.environments }, rolloutDependencies: d.rolloutDependencies ?? null, rolloutGates: d.rolloutGates });
	const story = blockingStory(prod, ctx, { place: 'prod' }) as any;
	const names = story.gates.map((g: any) => g.displayName);
	expect(names).toContain('Manual Approval Required');
	expect(names.join(' ')).not.toMatch(/hello-world-manual-approval|ghd-/);
});

import { withSchedules, classifyGate } from './blocking-story';
it('QA #17 round 3: the pretty name survives withSchedules (the context is spread, not rebuilt field by field)', () => {
	const gate = { metadata: { name: 'hello-world-manual-approval', namespace: 'hello-world-prod', annotations: { 'gate.kuberik.com/pretty-name': 'Manual Approval Required' } } };
	const base = buildGateContext({ environments: { items: [] }, rolloutDependencies: { items: [] }, rolloutGates: { items: [gate] } as never });
	const g = { name: 'hello-world-manual-approval', passing: false, allowedVersions: [] } as never;
	expect(classifyGate(g, 'hello-world-prod', base).displayName).toBe('Manual Approval Required');
	expect(classifyGate(g, 'hello-world-prod', withSchedules(base, 'hello-world-prod', [])).displayName).toBe('Manual Approval Required');
});
