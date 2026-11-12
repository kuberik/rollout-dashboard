import { describe, it, expect } from 'vitest';
import { approvalAskAt, rollouts } from './data';
import { rowAction } from './rollout-view';

/** The rollout page and its Gates tab ask the same question Home, /apps and /envs ask: "can the viewer approve THIS place?" (data.ts approvalAskAt). */
const rows = () => rollouts('incident').rows;
const hrefOf = (app: string, tier: string) => rows().find((r) => r.app === app && r.tier === tier)!.href;

describe('approvalAskAt: the viewer\'s approval at one rollout page', () => {
	it('an approver gets the same target Home\'s Approve opens, for every region the row folds', () => {
		const row = rows().find((r) => r.app === 'payments-core' && r.tier === 'prod')!;
		expect(rowAction(row)?.kind).toBe('approve');
		const t = approvalAskAt(row.href, 'incident');
		expect(t, 'the page offers Approve where Home does').not.toBeNull();
		expect(t!.app).toBe('payments-core');
		expect(t!.count).toBeGreaterThan(1);
		for (const p of t!.places) expect(approvalAskAt(p.href, 'incident')?.key, `region ${p.label}`).toBe(t!.key);
	});
	it('a rollout whose approval the viewer cannot give offers no Approve', () => {
		const row = rows().find((r) => r.app === 'telemetry-indexer' && r.group === 'approval');
		expect(row, 'fixture: telemetry-indexer waits on someone else').toBeTruthy();
		expect(rowAction(row!)?.kind ?? null).not.toBe('approve');
		expect(approvalAskAt(row!.href, 'incident')).toBeNull();
	});
	it('a rollout that waits on nothing offers no Approve', () => {
		const calm = rows().find((r) => r.group === 'rest' || r.group === 'moving')!;
		expect(approvalAskAt(calm.href, 'incident')).toBeNull();
	});
});

import { askView, ASK_LOADING } from './state-words';
describe('askView: while the fleet answers, nothing flips and the action slot is reserved', () => {
	const place = 'prod';
	const wait = 'prod is waiting on an approval';
	it('loading: neutral headline, slot reserved, no Approve', () => {
		const v = askView(ASK_LOADING, wait, place);
		expect(v.headline).toBe('Waiting for approval in prod');
		expect(v.slot).toBe('reserved');
	});
	it('loading never reserves a slot for a hold that is not an approval wait', () => {
		expect(askView(ASK_LOADING, 'prod is waiting on payments-svc', place)).toEqual({ headline: 'prod is waiting on payments-svc', slot: 'none' });
	});
	it('resolved: approver gets Home\'s word and the button; non-approver gets today\'s wording and the slot collapses', () => {
		const t = approvalAskAt(rows().find((r) => r.app === 'payments-core' && r.tier === 'prod')!.href, 'incident')!;
		expect(askView(t, wait, place)).toEqual({ headline: 'Needs your approval in prod', slot: 'approve' });
		expect(askView(null, wait, place)).toEqual({ headline: wait, slot: 'none' });
	});
});
