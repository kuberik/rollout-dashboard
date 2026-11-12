import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { placeHolds, heldCauses, appHolds, apps, rollouts } from './data';
import { buildSketch } from '$lib/components/home/sketch/sketch-home';
import { homeModel } from '$lib/components/home/sketch/home-data';
import { installEdge, uninstallEdge } from '$lib/testing/edge-source';

/**
 * What the home-edge apps (src/lib/demo/home-edge.ts) render on the hold surfaces TODAY: heldCauses (the banner), placeHolds (the gates tab / app page),
 * appHolds (the app row) and Home's asks. Each expectation pins current behaviour, including two wordings the lane reports but does not fix:
 * ledger-export's place reads "production" for prod-eu-central.
 */
beforeEach(installEdge);
afterEach(uninstallEdge);
const place = (app: string) => placeHolds(app, 'incident').find((p) => p.tier === 'prod')!;
const held = (app: string) =>
	heldCauses('incident').filter((h) => h.rows.some((r) => r.app === app));
const appRow = (app: string) => apps('incident').items.find((a) => a.app === app)!;
const asks = (app: string) =>
	buildSketch(homeModel('incident'), 'sarahmiller').elsewhere.filter((e) => e.app === app);

describe('item 4 (M20): a closed window and a dependency hold tide-gauge at prod; the dependency is the named cause on every surface', () => {
	it('heldCauses: one cause "Waiting on ledger-core" (reason dependency), no window clause, and no cause names the window', () => {
		const hc = held('tide-gauge');
		expect(hc.map((h) => h.cause)).toEqual(['Waiting on ledger-core']);
		expect(hc[0].reason).toBe('dependency');
		expect(hc[0].window).toBeUndefined();
		expect(hc.some((h) => /Release Freeze|window/i.test(h.cause))).toBe(false);
	});
	it('placeHolds: held by the rule named ledger-core', () => {
		const p = place('tide-gauge');
		expect(p.state).toBe('held-by-rule');
		expect(p.holdReason).toBe('rule');
		expect(p.gate).toMatchObject({
			name: 'ledger-core',
			sentence: 'Releases when ledger-core ships a newer version'
		});
	});
	it('appHolds: "Waits on ledger-core in production", no window opening time', () => {
		const h = appHolds(appRow('tide-gauge') as never, 'incident');
		expect(h.map((x) => x.text)).toEqual(['Waits on ledger-core in production']);
	});
	it('Home: the approval ask says approving will not deploy until ledger-core clears (not a window)', () => {
		const ask = asks('tide-gauge').find((e) => e.kind === 'approval')!;
		expect(ask.ask).toBe("Approving won't deploy until ledger-core clears");
		expect(ask.status).toMatch(/approving won't deploy until ledger-core clears$/);
		expect(asks('tide-gauge').some((e) => /window/i.test(`${e.status} ${e.ask ?? ''}`))).toBe(
			false
		);
	});
});

describe('item 6: door-lock, signal-box, ledger-export', () => {
	it('door-lock (closed named window "After Hours"): the banner, the app row and the place gate all name the window (batch4 b: joined by the schedule managedGates, the gate object has no pretty name)', () => {
		const hc = held('door-lock');
		expect(hc.map((h) => h.cause)).toEqual(['Held by After Hours']);
		expect(hc[0].reason).toBe('clock');
		expect(hc[0].window?.opens).toMatch(/^opens (Mon|Tue|Wed|Thu|Fri) 09:00 UTC$/);
		expect(appHolds(appRow('door-lock') as never, 'incident')[0].text).toMatch(
			/^Held by After Hours in production · opens (Mon|Tue|Wed|Thu|Fri) 09:00 UTC$/
		);
		const p = place('door-lock');
		expect(p.state).toBe('held-by-rule');
		expect(p.gate).toMatchObject({
			name: 'After Hours',
			sentence: 'Releases when the deploy window opens'
		});
		expect(asks('door-lock')[0].status).toBe('Waits for a deploy window in production');
	});
	it('signal-box (gate of unknown kind with an allow-list): held by "a rule", the gate is named by its own name and the allow-list sentence', () => {
		const hc = held('signal-box');
		expect(hc.map((h) => h.cause)).toEqual(['Held by a rule']);
		expect(hc[0].reason).toBe('rule');
		expect(appHolds(appRow('signal-box') as never, 'incident').map((x) => x.text)).toEqual([
			'Held by a rule in production'
		]);
		const p = place('signal-box');
		expect(p.state).toBe('held-by-rule');
		expect(p.gate).toMatchObject({
			name: 'Manual vet',
			sentence: 'Releases when the rule allows this build'
		});
		expect(asks('signal-box')[0].status).toBe('Waits on a rule in production');
	});
	it('ledger-export (one prod region, approval): every surface, Home included, says "production" (batch4 c); a lone region of a tier is a place, not a region (QA #10)', () => {
		const p = place('ledger-export');
		expect(p.href).toBe('/rollouts/prod/ledger-export-prod-eu-central/ledger-export');
		expect(p.state).toBe('awaiting-approval');
		expect(p.place).toBe('production');
		expect(appHolds(appRow('ledger-export') as never, 'incident').map((x) => x.text)).toEqual([
			'Needs your approval in production'
		]);
		const ask = asks('ledger-export');
		expect(rollouts('incident').rows.find((r) => r.app === 'ledger-export')?.where).toBe('production');
		expect(ask.map((e) => e.status)).toEqual(['Waits for approval in production']);
		expect(ask[0].href).toBe(p.href);
		expect(ask[0].canAct).toBe(true);
	});
});

describe('item 7: deploy-pin-fail (pinned to dp-2 AND the newest deploy failed its bake)', () => {
	it('the place reads failed (failed wins over the pin) on the gates tab, and Home asks about a failing place', () => {
		const p = place('deploy-pin-fail');
		expect(p.state).toBe('failed');
		expect(p.holdReason).toBe('failed');
		expect(p.gate).toBeNull();
		expect(asks('deploy-pin-fail').map((e) => e.kind)).toEqual(['failing']);
	});
	it('the app row still says the pin', () => {
		expect(appHolds(appRow('deploy-pin-fail') as never, 'incident').map((x) => x.text)).toEqual([
			'Pinned to dp-2 in production'
		]);
	});
});

describe('batch4 c: one place word on every surface', () => {
	it('every single-place Home ask names its place as placeHolds does (the shared placeLabel), never the raw tier', () => {
		const bad: string[] = [];
		for (const e of buildSketch(homeModel('incident'), 'sarahmiller').elsewhere) {
			if (/\d+ prod regions/.test(e.status)) continue;
			const p = placeHolds(e.app, 'incident').find((x) => x.href === e.href);
			if (p && !e.status.includes(` in ${p.place}`)) bad.push(`${e.app}: "${e.status}" vs place "${p.place}"`);
		}
		expect(bad).toEqual([]);
	});
});
