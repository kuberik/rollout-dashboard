import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import type { Rollout, RolloutGate } from '../types';
import GateRecord from './components/GateRecord.svelte';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource } from '$lib/components/home/sketch/home-data';
import * as D from '$lib/components/new/data';
import { buildRolloutGraph } from './view-models/dependency-graph';
import { buildGateContext, withSchedules, type ClassifiedGate } from './view-models/blocking-story';
import { rolloutGateBoxes } from './view-models/rollout-gates';
import { gateLabel, gateLabelText, classifiedGateLabel, promotionSourceOf, PROMOTION_WORD } from './view-models/gate-label';

/**
 * batch4 lane 70 (owner decision 2026-11-11): a promotion gate NEVER prints its displayName sentence. Every surface draws it by kind:
 * the promotion glyph + the source environment's chip (`» [STAGING]`); source unknown -> the word "Promotion".
 * Each surface below is given a promotion gate whose displayName is SENTENCE and asserts SENTENCE appears nowhere.
 */
const SENTENCE = 'Previous environment not ready yet';

afterEach(() => installLiveSource(null));

function classified(o: Partial<ClassifiedGate> = {}): ClassifiedGate {
	return {
		id: 'ghd-6p5hd', kind: 'promotion', clears: 'upstream', label: 'after staging', displayName: SENTENCE, clause: 'staging deploys it first',
		short: 'Waiting for staging to deploy it first', clearsAt: null, timezone: null, subject: 'staging', subjectKind: 'environment', promotionSource: 'staging',
		predicate: 'deploys it first', contract: null, have: null, need: null, ...o
	} as ClassifiedGate;
}

describe('gateLabel: the one decision', () => {
	it('a promotion gate is its source environment, never its pretty name', () => {
		const l = gateLabel({ kind: 'promotion', name: 'ghd-6p5hd' }, SENTENCE, 'staging');
		expect(l).toEqual({ kind: 'promotion', source: 'staging' });
		expect(gateLabelText(l)).not.toContain(SENTENCE);
	});
	it('an unknown source is the word Promotion, never the pretty name', () => {
		const l = gateLabel({ kind: 'promotion', name: 'ghd-6p5hd' }, SENTENCE, null);
		expect(l).toEqual({ kind: 'promotion', source: null });
		expect(gateLabelText(l)).toBe(PROMOTION_WORD);
	});
	it('every other kind keeps its published name', () => {
		expect(gateLabelText(gateLabel({ kind: 'schedule', name: 'bh' }, 'Business Hours Only'))).toBe('Business Hours Only');
		expect(gateLabelText(gateLabel({ kind: 'approval', name: 'x-approval' }, null))).toBe('X approval');
	});
	it('the source is the classifier\'s structured promotionSource, never parsed from the subject wording', () => {
		expect(promotionSourceOf({ kind: 'promotion', promotionSource: null })).toBeNull();
		expect(promotionSourceOf({ kind: 'promotion', promotionSource: 'staging' })).toBe('staging');
		/* a subject that LOOKS like a wave or a name is not read */
		expect(promotionSourceOf({ kind: 'promotion', subject: 'staging', subjectKind: 'environment' } as never)).toBeNull();
		expect(promotionSourceOf({ kind: 'schedule', promotionSource: 'staging' })).toBeNull();
	});
});

describe('GateRecord (Gates tab record, Holding popover, banner record)', () => {
	it('draws a promotion gate as the source chip, never the displayName', () => {
		const { container } = render(GateRecord, { gates: [classified()] });
		expect(container.textContent).not.toContain(SENTENCE);
		const l = container.querySelector('[data-gate-label="promotion"]');
		expect(l?.getAttribute('data-gate-source')).toBe('staging');
		expect(l?.textContent?.toLowerCase()).toContain('staging');
	});
	it('with no known source it prints Promotion', () => {
		const { container } = render(GateRecord, { gates: [classified({ subject: 'its upstream environment', promotionSource: null, label: 'after its upstream environment' })] });
		expect(container.textContent).not.toContain(SENTENCE);
		expect(container.querySelector('[data-gate-label="promotion"]')?.textContent).toContain(PROMOTION_WORD);
	});
	it('a non-promotion gate still prints its name', () => {
		const { container } = render(GateRecord, { gates: [classified({ kind: 'schedule', displayName: 'Business Hours Only', subject: null, subjectKind: null })] });
		expect(container.textContent).toContain('Business Hours Only');
	});
});

describe('Gates tab boxes', () => {
	const ANN = 'rollout-dashboard.kuberik.com/source-cluster';
	const r = {
		metadata: { name: 'app', namespace: 'ns', annotations: { [ANN]: 'c' } }, spec: { healthCheckSelector: {} },
		status: {
			history: [{ version: { tag: 'r1', version: 'r1' }, timestamp: '2026-10-08T09:00:00Z' }],
			availableReleases: [{ tag: 'r1', version: 'r1' }, { tag: 'r2', version: 'r2' }], releaseCandidates: [{ tag: 'r2', version: 'r2' }],
			gates: [{ name: 'ghd-6p5hd', kind: 'promotion', displayName: SENTENCE, passing: false, allowedVersions: ['r1'] }]
		}
	} as unknown as Rollout;
	const obj = { metadata: { name: 'ghd-6p5hd', namespace: 'ns', annotations: { 'gate.kuberik.com/pretty-name': SENTENCE } }, spec: { rolloutRef: { name: 'app' }, passing: false, allowedVersions: ['r1'] } } as unknown as RolloutGate;
	function boxes() {
		const ctx = withSchedules(buildGateContext({ environments: { items: [] }, rolloutDependencies: { items: [] }, rolloutGates: { items: [obj] } }), 'ns', [] as never);
		const g = buildRolloutGraph({ rollouts: [r], environments: [], dependencies: [], envOrder: [], gates: ctx, focus: { cluster: 'c', namespace: 'ns', name: 'app' } });
		return rolloutGateBoxes({ focus: g.nodes.find((n) => n.name === 'app')!, rollout: r, rolloutGates: [obj], schedules: [], healthChecks: null, edgeGates: new Set(), now: new Date('2026-10-08T10:00:00Z') });
	}
	it('a promotion gate box is titled by kind, never the displayName', () => {
		const b = boxes();
		expect(b.length).toBeGreaterThan(0);
		for (const x of b) { expect(x.title).not.toContain(SENTENCE); expect(x.kindWord ?? '').not.toContain(SENTENCE); }
		expect(b[0].label).toEqual({ kind: 'promotion', source: null });
		expect(b[0].title).toBe(PROMOTION_WORD);
	});
});

/** the Home/rollout model layer: Holding card, held chips, banners, row causes all read these */
function withPromotionDisplayName() {
	const src = fixtureSource();
	const rollouts = structuredClone(src.rollouts) as typeof src.rollouts;
	let n = 0;
	for (const r of rollouts) for (const g of r.status?.gates ?? []) if ((g as { kind?: string }).kind === 'promotion') { (g as { displayName?: string }).displayName = SENTENCE; n++; }
	installLiveSource({ ...src, rollouts } as never);
	return n;
}

describe('the Home model: held chips, Holding card, banners, row causes', () => {
	it('no model output prints a promotion gate\'s displayName', () => {
		expect(withPromotionDisplayName()).toBeGreaterThan(0);
		const out: string[] = [JSON.stringify(D.heldCauses('incident'))];
		for (const a of D.apps('incident').items) {
			out.push(JSON.stringify(D.gatesOf(a.app, 'incident')));
			out.push(JSON.stringify(D.placeHolds(a.app, 'incident')));
			out.push(JSON.stringify(D.placeCauses(a.app, 'incident')));
		}
		expect(out.filter((o) => o.includes(SENTENCE))).toEqual([]);
	});
	it('a held place whose gate is a promotion is named by kind', () => {
		withPromotionDisplayName();
		const names = D.apps('incident').items.flatMap((a) => D.placeHolds(a.app, 'incident')).map((p) => p.gate?.name).filter((n): n is string => !!n);
		const promo = names.filter((n) => /^Promotion\b/.test(n));
		expect(promo.length).toBeGreaterThan(0);
		expect(names).toContain('Promotion from dev');
		expect(names).toContain('Promotion'); /* a source with no single environment (a wave's set) is the word */
		expect(names.filter((n) => /^Promotion\b/.test(n))).toEqual(expect.arrayContaining(['Promotion']));
	});
});

describe('classifiedGateLabel', () => {
	it('matches the helper for a promotion gate and keeps the name otherwise', () => {
		expect(classifiedGateLabel(classified())).toEqual({ kind: 'promotion', source: 'staging' });
		expect(classifiedGateLabel(classified({ kind: 'approval', displayName: 'Release approval' }))).toEqual({ kind: 'named', text: 'Release approval' });
	});
});
