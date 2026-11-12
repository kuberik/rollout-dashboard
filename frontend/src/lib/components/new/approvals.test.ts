import { describe, it, expect } from 'vitest';
import { deployableTags, placeHolds, inbox, gatesOf, gateName, candidateBuilds, rollouts, approvalTarget, grantApproval, revokeApproval, appHolds, apps, heldCauses, stateVerb, type TRow } from './data';
import { sentenceOf, sentenceParts } from './rollouts-page';
import { publishGatePretty } from '$lib/view-models/gate-pretty.svelte';
import { source, resetHomeModel, homeModel, ME } from '$lib/components/home/sketch/home-data';
import { buildSketch, alsoApprovalAsk } from '../home/sketch/sketch-home';
import { compass } from '$lib/components/home/pocket/pocket-data';
import { askSentence, doneWords } from './approvals.svelte';
import { causeText, gateLabelText } from '$lib/view-models/gate-label';

/* r34 r3-approve: Approve acts in place. The target names the build and every region whose own gate refuses it; granting moves
   those places out of the approval group on EVERY derivation (rows, changes, apps), and revoking restores them exactly. */
/* every approval a test grants is revoked in `finally`, so one failing assertion cannot leave the fixture approved for the next test */
const granted: Parameters<typeof grantApproval>[0][] = [];
const grant = (t: Parameters<typeof grantApproval>[0]) => { granted.push(t); grantApproval(t); };
const settle = () => { granted.splice(0).forEach((t) => revokeApproval(t)); };
/* per-build approval: after approving the target, a newer build may still await its OWN approval; the place is released when no prod row reads a hold by another gate */
const released = () => { const ps = rollouts('incident').rows.filter((r) => r.app === 'payments-core' && r.tier === 'prod'); return ps.length > 0 && ps.every((r) => !/^(Held by|Waits on) /.test(sentenceOf(r, 'incident')[0])); };
/* the approval row as the fixture ships it, remembered: once a test adds a gate that refuses every candidate, the row correctly reads that hold instead (no approval can unblock it), but the approval target is still built from the place's approval gate */
const rowCache = new Map<string, TRow>();
const row = (app: string): TRow | undefined => {
	const r = rollouts('incident').rows.find((x) => x.app === app && x.state === 'awaiting-approval' && x.needsYou);
	if (r) rowCache.set(app, r);
	return r ?? rowCache.get(app);
};

describe('approving in place', () => {
	it('names the build and the places', () => {
		const r = row('payments-core')!;
		expect(r).toBeTruthy();
		const t = approvalTarget(r, 'incident')!;
		expect(t.count).toBeGreaterThan(1);
		expect(askSentence(t)).toBe(`Approve ${t.build} for ${t.where}?`);
		expect(t.places.every((p) => p.tag)).toBe(true);
	});
	it('grant moves the places to deploying everywhere; undo restores them', () => {
		const before = rollouts('incident').rows.filter((r) => r.app === 'payments-core').map((r) => `${r.key}:${r.state}`).sort();
		const t = approvalTarget(row('payments-core')!, 'incident')!;
		grant(t);
		const after = rollouts('incident').rows.filter((r) => r.app === 'payments-core');
		/* per-build approval: the approved build deploys; a NEWER build still waits for its own approval, and the place reads Deploying, not that wait */
		const mineAfter = after.filter((r) => t.places.some((p) => p.href === r.href));
		expect(mineAfter.length, 'the approved places keep a row').toBeGreaterThan(0);
		expect(mineAfter.every((r) => r.state === 'deploying'), 'every approved place reads Deploying').toBe(true);
		expect(after.some((r) => r.state === 'awaiting-approval' && t.places.some((p) => p.href === r.href))).toBe(false);
		expect(apps('incident').items.find((a) => a.app === 'payments-core')!.approval).toBe(false);
		revokeApproval(t);
		expect(rollouts('incident').rows.filter((r) => r.app === 'payments-core').map((r) => `${r.key}:${r.state}`).sort()).toEqual(before);
	});
	it('a build something else still holds reads that hold after the approval, never deploying; undo restores it', () => {
		const t0 = approvalTarget(row('payments-core')!, 'incident')!;
		/* the real shape: each approval place also carries a controller-written `dependency-<name>` gate that refuses the held build, backed by its RolloutDependency (provider payments-svc) */
		type G = { name: string; kind?: string; displayName?: string; passing?: boolean; allowedVersions?: string[] | null };
		type R = { metadata: { name: string; namespace: string }; status: { gates?: G[]; releaseCandidates?: { tag?: string }[] } };
		const src = source() as unknown as { rollouts: R[]; rolloutDependencies: { items: object[] } };
		const rs = src.rollouts.filter((r) => t0.places.some((p) => p.href.split('/').slice(3, 5).join('/') === `${r.metadata.namespace}/${r.metadata.name}`));
		expect(rs.length).toBe(t0.places.length);
		const DEP = 'payments-core-needs-payments-svc';
		const deps: object[] = rs.map((r) => ({ apiVersion: 'kuberik.com/v1alpha1', kind: 'RolloutDependency', metadata: { name: DEP, namespace: r.metadata.namespace, annotations: { 'rollout-dashboard.kuberik.com/source-cluster': 'prod' } }, spec: { contract: 'payments', providerRef: { name: 'payments-svc', namespace: 'platform-prod' }, rolloutRef: { name: r.metadata.name } }, status: { providedVersion: '2.4.1', providedTag: 'pay-241', admittedVersions: ['0.0.0-older'], blockedReleases: (r.status.releaseCandidates ?? []).map((c) => ({ tag: c.tag, requiredVersion: '^3.0.0', reason: 'ConstraintNotSatisfied' })), gateName: `dependency-${DEP}` } }));
		const added = rs;
		rs.forEach((r) => { r.status.gates = [...(r.status.gates ?? []), { name: `dependency-${DEP}`, kind: 'dependency', passing: true, allowedVersions: ['0.0.0-older'] }]; });
		src.rolloutDependencies.items.push(...deps);
		resetHomeModel();
		try {
			const before = rollouts('incident').rows.filter((r) => r.app === 'payments-core').map((r) => `${r.key}:${r.state}`).sort();
			const t = approvalTarget(row('payments-core')!, 'incident')!;
			expect(t.waitsOn, 'approvalTarget computes waitsOn itself').toBe('payments-svc');
			expect(doneWords(t).detail).toBe(`payments-core: Waits on payments-svc · ${t.where}`);
			grant(t);
			const mine = rollouts('incident').rows.filter((r) => r.app === 'payments-core' && r.tier === 'prod');
			expect(mine.length, 'the prod row survives').toBeGreaterThan(0);
			expect(t.places.every((p) => mine.some((r) => r.href === p.href || r.regions.includes(p.label))), 'every place is still covered by a row').toBe(true);
			expect(mine.some((r) => r.state === 'deploying' || r.state === 'checking' || r.state === 'awaiting-approval'), 'nothing deploys and nothing asks: the provider holds every candidate').toBe(false);
			const hc = heldCauses('incident').map((c) => c.cause);
			expect(hc, 'the row names the same provider as the toast').toContain(`Waiting on ${t.waitsOn}`);
			expect(stateVerb(mine[0], 'incident').text).toMatch(/waits on/i);
			const item = apps('incident').items.find((a) => a.app === 'payments-core')!;
			expect(appHolds(item, 'incident').some((h) => /Waiting on|waits on/i.test(h.text) && !h.approval)).toBe(true);
			expect(gatesOf('payments-core', 'incident').some((g) => g.kind === 'dependency' && g.holding), 'the Holding card shows the dependency').toBe(true);
			revokeApproval(t);
			expect(rollouts('incident').rows.filter((r) => r.app === 'payments-core').map((r) => `${r.key}:${r.state}`).sort()).toEqual(before);
		} finally {
			settle();
			for (const r of added) r.status.gates = r.status.gates!.filter((g) => g.name !== `dependency-${DEP}`);
			src.rolloutDependencies.items = src.rolloutDependencies.items.filter((d) => !deps.includes(d));
			resetHomeModel();
		}
	});
	/* a place's gates are patched in the fixture (the payload carries names, `kind`, `passing` and allow-lists), the model rebuilt, everything restored */
	type G = { name: string; kind?: string; displayName?: string; passing?: boolean; allowedVersions?: string[] | null };
	type R = { metadata: { name: string; namespace: string }; status: { gates?: G[] } };
	const withGate = (gate: G, run: (t: NonNullable<ReturnType<typeof approvalTarget>>, nss: string[]) => void) => {
		const t0 = approvalTarget(row('payments-core')!, 'incident')!;
		const rs = (source().rollouts as unknown as R[]).filter((r) => t0.places.some((p) => p.href.split('/').slice(3, 5).join('/') === `${r.metadata.namespace}/${r.metadata.name}`));
		rs.forEach((r) => { r.status.gates = [...(r.status.gates ?? []), { ...gate }]; });
		resetHomeModel();
		try { run(approvalTarget(row('payments-core')!, 'incident')!, rs.map((r) => r.metadata.namespace)); } finally {
			settle();
			rs.forEach((r) => { r.status.gates = r.status.gates!.filter((g) => g.name !== gate.name); });
			resetHomeModel();
		}
	};
	const holds = (what: string, gate: G) => it(`${what} still holds after the approval: no Deploying, and the toast and the held row name the same hold`, () => {
		withGate(gate, (t) => {
			expect(t.waitsOn, 'approvalTarget sees the hold').toBeTruthy();
			expect(doneWords(t).detail).toBe(`payments-core: ${causeText(t.cause!)} · ${t.where}`);
			const before = rollouts('incident').rows.filter((r) => r.app === 'payments-core').map((r) => `${r.key}:${r.state}`).sort();
			grant(t);
			const mine = rollouts('incident').rows.filter((r) => r.app === 'payments-core' && r.tier === 'prod');
			expect(mine.length).toBeGreaterThan(0);
			expect(mine.some((r) => r.state === 'deploying' || r.state === 'checking')).toBe(false);
			expect(sentenceOf(mine[0], 'incident')[0], 'the held row names the toast\'s hold').toBe(causeText(t.cause!));
			/* per-build: the newest build still awaits its OWN approval, so the row may read that wait; the Holding card names the toast's gate */
			expect(gatesOf('payments-core', 'incident').some((g) => g.holding && g.name === t.waitsOn), 'the Holding card names the toast gate').toBe(true);
			revokeApproval(t);
			expect(rollouts('incident').rows.filter((r) => r.app === 'payments-core').map((r) => `${r.key}:${r.state}`).sort()).toEqual(before);
		});
	});
	holds('a closed deploy window (schedule)', { name: 'schedule-gate-zvsqr', kind: 'schedule', passing: false, allowedVersions: null });
	holds('a failing check gate (kind unknown)', { name: 'smoke-check', kind: 'unknown', passing: false, allowedVersions: null });
	holds('a failing check whose NAME says approval', { name: 'approval-latency-slo', kind: 'unknown', passing: false, allowedVersions: null });
	holds('a gate of unknown kind that refuses', { name: 'mystery-rule', passing: false, allowedVersions: null });
	holds('an ownerless failing check the backend can only call approval (kind approval, no allow-list: Approve cannot release it)', { name: 'smoke-gate', kind: 'approval', passing: false, allowedVersions: null });
	it('a second gate of kind approval is part of the approval, never a hold of its own', () => {
		withGate({ name: 'plain-gate', kind: 'approval', allowedVersions: [] }, (t) => {
			expect(t.waitsOn ?? null).toBeNull();
			grant(t);
			expect(released(), 'the approved build is released: no row is held by another gate').toBe(true);
			revokeApproval(t);
		});
	});
	it('a schedule gate with no gate object loaded is named by the API displayName on the row cause and the toast alike', () => {
		withGate({ name: 'schedule-gate-zvsqr', kind: 'schedule', displayName: 'Business Hours Only', passing: false, allowedVersions: null }, (t) => {
			expect(t.waitsOn).toBe('Business Hours Only');
			expect(causeText(t.cause!)).toBe('Held by Business Hours Only');
			expect(doneWords(t).detail).toBe(`payments-core: Held by Business Hours Only · ${t.where}`);
			grant(t);
			const mine = rollouts('incident').rows.filter((r) => r.app === 'payments-core' && r.tier === 'prod');
			expect(sentenceOf(mine[0], 'incident')[0]).toBe('Held by Business Hours Only');
			expect(heldCauses('incident').map((c) => c.cause).join('|')).not.toMatch(/Gate\b|Waits for the deploy window/);
			revokeApproval(t);
		});
	});
	it('cold cache: an unpublished window name reads the same in the toast and the row; once published, both read the published name', () => {
		withGate({ name: 'schedule-gate-zvsqr', kind: 'schedule', passing: false, allowedVersions: null }, (t, nss) => {
			expect(t.waitsOn).toBe('Deploy window');
			grant(t);
			expect(gatesOf('payments-core', 'incident').some((g) => g.holding && g.name === 'Deploy window')).toBe(true);
			revokeApproval(t);
			for (const ns of nss) publishGatePretty('prod', ns, new Map([['schedule-gate-zvsqr', 'Business hours']]));
			const w = approvalTarget(row('payments-core')!, 'incident')!;
			expect(w.waitsOn).toBe('Business hours');
			grant(w);
			expect(gatesOf('payments-core', 'incident').some((g) => g.holding && g.name === 'Business hours')).toBe(true);
			revokeApproval(w);
		});
	});
	it('a hold says which kind it is without its words being parsed', () => {
		const asking = apps('incident').items.filter((x) => x.approval);
		expect(asking.length).toBeGreaterThan(0);
		for (const a of asking) expect(appHolds(a, 'incident').some((x) => x.approval && /^(Waiting for (your )?|Needs your )approval/.test(x.text)), a.app).toBe(true);
	});
});

describe('an older backend (gates carry no kind)', () => {
	it('Approve still deploys: the approval gate the target is built from is never a hold of its own', () => {
		type R = { metadata: { name: string; namespace: string }; status: { gates?: { name: string; kind?: string }[] } };
		const rs = source().rollouts as unknown as R[];
		const kinds = rs.flatMap((r) => (r.status.gates ?? []).filter((g) => g.kind).map((g) => [r, g.name, g.kind] as const));
		rs.forEach((r) => (r.status.gates ?? []).forEach((g) => { delete g.kind; }));
		resetHomeModel();
		try {
			const t = approvalTarget(row('payments-core')!, 'incident')!;
			expect(t.waitsOn ?? null).toBeNull();
			grant(t);
			expect(released(), 'the approved build is released: no row is held by another gate').toBe(true);
			revokeApproval(t);
		} finally { settle(); kinds.forEach(([r, n, k]) => { const g = r.status.gates?.find((x) => x.name === n); if (g) g.kind = k; }); resetHomeModel(); }
	});
});

describe('the approval name match is for a payload with NO kind field only', () => {
	it('kind "unknown" with an approval-looking name is not an approval: it holds after Approve', () => {
		type G = { name: string; kind?: string; displayName?: string; passing?: boolean; allowedVersions?: string[] | null };
		type R = { metadata: { name: string; namespace: string }; status: { gates?: G[] } };
		const t0 = approvalTarget(row('payments-core')!, 'incident')!;
		const rs = (source().rollouts as unknown as R[]).filter((r) => t0.places.some((p) => p.href.split('/').slice(3, 5).join('/') === `${r.metadata.namespace}/${r.metadata.name}`));
		rs.forEach((r) => r.status.gates!.push({ name: 'release-approval-slo', kind: 'unknown', passing: false, allowedVersions: null }));
		resetHomeModel();
		try { expect(approvalTarget(row('payments-core')!, 'incident')!.waitsOn).toBeTruthy(); } finally {
			rs.forEach((r) => { r.status.gates = r.status.gates!.filter((g) => g.name !== 'release-approval-slo'); }); resetHomeModel();
		}
	});
});

describe('one classification for the toast, the row, the Holding card and the builds', () => {
	type G = { name: string; kind?: string; displayName?: string; passing?: boolean; allowedVersions?: string[] | null };
	type R = { metadata: { name: string; namespace: string }; status: { gates?: G[] } };
	const patched = (gates: G[], run: () => void) => {
		const t0 = approvalTarget(row('payments-core')!, 'incident')!;
		const rs = (source().rollouts as unknown as R[]).filter((r) => t0.places.some((p) => p.href.split('/').slice(3, 5).join('/') === `${r.metadata.namespace}/${r.metadata.name}`));
		rs.forEach((r) => r.status.gates!.push(...gates.map((g) => ({ ...g }))));
		resetHomeModel();
		try { run(); } finally { settle(); rs.forEach((r) => { r.status.gates = r.status.gates!.filter((g) => !gates.some((x) => x.name === g.name)); }); resetHomeModel(); }
	};
	const prodRow = () => rollouts('incident').rows.find((r) => r.app === 'payments-core' && r.tier === 'prod')!;
	it('a closed window first, then an unknown gate whose allow-list refuses the build: toast title == row title', () => {
		patched([{ name: 'business-hours-gate', kind: 'schedule', passing: false, allowedVersions: null }, { name: 'mystery-rule', kind: 'unknown', allowedVersions: ['0.0.0'] }], () => {
			const t = approvalTarget(row('payments-core')!, 'incident')!;
			expect(t.waitsOn, 'blame order: a persistent refuser (an unknown gate) names the hold, a window that clears itself does not').toBe('Mystery rule');
			grant(t);
			expect(gatesOf('payments-core', 'incident').some((g) => g.holding && g.name === t.waitsOn), 'the Holding card names the toast gate').toBe(true);
			revokeApproval(t);
		});
	});
	it('a schedule-kind gate is released by the window opening, whatever it is called', () => {
		patched([{ name: 'business-hours-gate', kind: 'schedule', passing: false, allowedVersions: null }], () => {
			const t = approvalTarget(row('payments-core')!, 'incident')!;
			grant(t);
			expect(gateName({ ...prodRow(), state: 'held-by-rule' }, 'incident')!.sentence).toBe('Releases when the deploy window opens');
			revokeApproval(t);
		});
	});
	it('the app detail Holding card counts the closed window AND the approval (live hello-world-app prod shape): two holding', () => {
		patched([{ name: 'schedule-gate-lzh6m', kind: 'schedule', passing: false, allowedVersions: null }], () => {
			const holding = gatesOf('payments-core', 'incident').filter((g) => g.holding);
			expect(holding.map((g) => g.kind)).toEqual(expect.arrayContaining(['approval', 'schedule']));
		});
	});
	/* the build in question is the one a person is deciding on: the approval target's build (c0d3e88), not the newest candidate (f4a2c19) */
	/* the newest live candidate of the approval places (the build a rule that permits only it lets through) */
	const targetAndNewest0 = () => {
		const t0 = approvalTarget(row('payments-core')!, 'incident')!;
		const r0 = (source().rollouts as unknown as (R & { status: { releaseCandidates?: { tag?: string; version?: string }[] } })[]).find((r) => t0.places.some((p) => p.href.split('/').slice(3, 5).join('/') === `${r.metadata.namespace}/${r.metadata.name}`))!;
		return { newest: (r0.status.releaseCandidates ?? []).map((c) => c.tag ?? c.version ?? '')[0] };
	};
	const targetAndNewest = () => {
		const t0 = approvalTarget(row('payments-core')!, 'incident')!;
		const r0 = (source().rollouts as unknown as (R & { status: { releaseCandidates?: { tag?: string; version?: string }[] } })[]).find((r) => t0.places.some((p) => p.href.split('/').slice(3, 5).join('/') === `${r.metadata.namespace}/${r.metadata.name}`))!;
		const newest = (r0.status.releaseCandidates ?? []).map((c) => c.tag ?? c.version ?? '')[0];
		expect(t0.places[0].tag, 'the target is not the newest candidate').not.toBe(newest);
		return { target: t0.places[0].tag, newest };
	};
	it('permits only the newest (refuses the staged build): the newest is the one build every other gate lets through, so the dialog, the toast and the write name it, and Approve deploys it', () => {
		const { newest } = targetAndNewest0();
		patched([{ name: 'permits-newest-only', kind: 'unknown', allowedVersions: [newest] }], () => {
			const t = approvalTarget(row('payments-core')!, 'incident')!;
			expect(t.build).toBe(newest);
			expect(t.places.map((p) => p.tag)).toEqual(t.places.map(() => newest));
			expect(t.waitsOn ?? null).toBeNull();
			expect(doneWords(t).detail).toBe(`payments-core is deploying to ${t.where}`);
			grant(t);
			const prod = rollouts('incident').rows.filter((r) => r.app === 'payments-core' && r.tier === 'prod');
			expect(prod.length).toBeGreaterThan(0);
			for (const r of prod) expect(r.state, r.key).toBe('deploying');
			expect(placeHolds('payments-core', 'incident').filter((h) => h.tier === 'prod').every((h) => h.holdReason !== 'approval')).toBe(true);
		});
	});
	it('the approval write allows ONLY the approved build (per-build approval; must match the real write once the approval API lands)', () => {
		const { target, newest } = targetAndNewest();
		const t = approvalTarget(row('payments-core')!, 'incident')!;
		try {
		grant(t);
		const gates = ((source().rollouts as unknown as R[]).find((r) => t.places[0].href.endsWith(`${r.metadata.namespace}/${r.metadata.name}`) || t.places[0].href.includes(`/${r.metadata.namespace}/${r.metadata.name}`))!).status.gates!;
		const ap = gates.find((g) => g.kind === 'approval')!;
		expect(ap.allowedVersions).toContain(target);
		expect(ap.allowedVersions).not.toContain(newest);
		} finally { settle(); }
	});
	it('the approval allow-list already includes the newest: the newest deploys, and the toast names it', () => {
		expect(deployableTags([{ name: 'a', kind: 'approval', allowedVersions: ['new'] }], ['new', 'old'], 'old')).toEqual(['new', 'old']);
		expect(deployableTags([{ name: 'a', kind: 'approval', allowedVersions: [] }, { name: 'x', kind: 'unknown', allowedVersions: ['new'] }], ['new', 'old'], 'old')).toEqual([]);
		expect(doneWords({ key: 'k', app: 'payments-core', build: 'c0d3e88', where: '5 prod regions', count: 5, places: [], href: '/rollouts/c/ns/n', waitsOn: null, deploys: 'f4a2c19' }).detail).toBe('payments-core is deploying f4a2c19 to 5 prod regions');
	});
	it('X refuses EVERY candidate and the approval is also pending: no approval can unblock it, so the row reads "Held by X"; the toast and the Holding card agree', () => {
		patched([{ name: 'refuses-all', kind: 'unknown', allowedVersions: [] }], () => {
			expect(rollouts('incident').rows.some((r) => r.app === 'payments-core' && r.state === 'awaiting-approval' && r.needsYou), 'no false call to action').toBe(false);
			expect(sentenceOf(prodRow(), 'incident')[0], 'a hand-written allow-list that lacks the build never clears for it: the row names it and asks for nothing').toBe('Held by Refuses all');
			const t = approvalTarget(row('payments-core')!, 'incident')!;
			expect(t.waitsOn).toBe('Refuses all');
			expect(gatesOf('payments-core', 'incident').some((g) => g.holding && g.name === 'Refuses all')).toBe(true);
		});
	});
	/* the approval is not the only hold: the row names the rule first and says the approval is also needed; Home keeps the ask and names the other hold; the toast waits on the rule */
	/* a published RolloutSchedule joined to the gate: the window is a clock, which clears by itself */
	const withWindow = (run: () => void) => {
		const src = source() as unknown as { schedules?: Map<string, unknown> };
		const before = src.schedules;
		const cluster = approvalTarget(row('payments-core')!, 'incident')!.places[0].href.split('/')[2];
		src.schedules = new Map([[cluster, { clusterRolloutSchedules: { items: [{ metadata: { name: 'business-hours' }, spec: { action: 'Allow' }, status: { active: false, nextTransition: '2026-11-12T09:00:00Z', managedGates: ['schedule-gate-zvsqr'] } }] } }]]);
		try { run(); } finally { src.schedules = before as Map<string, never> | undefined; resetHomeModel(); }
	};
	const alsoCase = (what: string, gate: G, ask_: RegExp, window = false) => it(`${what} plus the pending approval: row, Home ask and toast agree`, () => {
		(window ? withWindow : (f: () => void) => f())(() => patched([gate], () => {
			const t = approvalTarget(row('payments-core')!, 'incident')!;
			expect(t.waitsOn, 'the toast waits on the rule').toBeTruthy();
			expect(doneWords(t).detail).toBe(`payments-core: ${causeText(t.cause!)} · ${t.where}`);
			expect(sentenceOf(prodRow(), 'incident')[0], 'the row names the rule, and the approval too').toBe(`Held by ${t.waitsOn} · also needs your approval`);
			const ask = inbox('incident').items.find((i) => i.row.app === 'payments-core' && i.row.tier === 'prod');
			expect(ask?.reason, 'Home keeps the ask and names the other hold').toMatch(ask_);
			expect(compass('incident').v.approvals.some((a) => a.app === 'payments-core' && ask_.test(a.note ?? ''))).toBe(true);
			/* the viewer's OWN change held here: "covered by yours" must not swallow the ask */
			const m = homeModel('incident');
			const app = m.apps.find((a) => a.app === 'payments-core')!;
			const envs = app.envs.filter((e) => e.state === 'held-by-rule' && e.alsoApproval);
			expect(envs.length, 'the place reads held with the approval also needed').toBeGreaterThan(0);
			for (const env of envs) env.myChanges = [{ ref: '#9', title: 'mine', href: env.href, mergedAt: '2026-11-10T00:00:00Z', since: '2026-11-10T01:00:00Z', state: 'held-by-rule', checkingMinutesLeft: null, repo: 'x', apps: ['payments-core'] } as never];
			expect(buildSketch(m, ME).elsewhere.find((x) => x.app === 'payments-core' && x.kind === 'approval')?.ask, 'own change: Home still asks').toMatch(ask_);
		}));
	});
	/* batch4 #128 (QA71 F3/Q2): a promotion gate that refuses beside the approval is named by KIND everywhere: the toast target carries a typed label, the row keeps it in its lead, no surface gets the controller's sentence */
	it('a promotion gate that also refuses: the toast target, the row lead and the card keep a typed promotion label, never the published sentence', () => {
		const SENTENCE = 'Previous environment not ready yet';
		patched([{ name: 'ghd-promo', kind: 'promotion', displayName: SENTENCE, passing: false, allowedVersions: ['0.0.0'] }], () => {
			const t = approvalTarget(row('payments-core')!, 'incident')!;
			expect(t.waitsOnLabel?.kind, 'the toast waits on a typed promotion label').toBe('promotion');
			expect(t.cause?.some((x) => typeof x !== 'string'), 'the cause keeps the label part').toBe(true);
			expect(causeText(t.cause!)).not.toContain(SENTENCE);
			const [lead] = sentenceParts(prodRow(), 'incident');
			expect(lead.some((x) => typeof x !== 'string'), 'the row lead keeps the label part').toBe(true);
			expect(causeText(lead)).not.toContain(SENTENCE);
			/* the other hold behind "also needs approval" is a promotion ORDER, named as such, never the gate's sentence */
			expect(prodRow().alsoApproval?.other ?? 'promotion order').toBe('promotion order');
		});
	});
	it('one wording per kind of other hold', () => {
		const base = { other: 'Business hours gate', persistent: false };
		expect(alsoApprovalAsk({ ...base, kind: 'window' }), 'a window is named as the window, never by its gate').toBe('Approve now; it deploys when the deploy window opens');
		expect(alsoApprovalAsk({ ...base, kind: 'window' }, '2026-11-16T09:00:00Z')).toMatch(/^Approve now; it deploys when the deploy window opens \w{3} 09:00 UTC$/);
		expect(alsoApprovalAsk({ other: 'promotion order', persistent: false, kind: 'order' })).toBe('Approve now; it deploys when promotion order allows it');
		expect(alsoApprovalAsk({ other: 'Smoke check', persistent: true, kind: 'hold' })).toBe("Approving won't deploy until Smoke check clears");
	});
	/* the approval is Home's LEAD and the only ask: `v.approvals` leaves the lead out, so the row's needsYou must read the lead */
	it('sole approval = Home lead: the rule-held row still needs you, and the inbox keeps the ask', () => {
		patched([{ name: 'schedule-gate-zvsqr', kind: 'schedule', passing: false, allowedVersions: null }], () => {
			const m = homeModel('incident');
			for (const a of m.apps) for (const e of a.envs) {
				if (a.app !== 'payments-core' && (e.state === 'awaiting-approval' || e.state === 'failed')) e.state = 'healthy';
				e.myChanges = e.myChanges.filter((c) => c.state !== 'failed');
			}
			m.signals = m.signals.filter((g) => g.kind !== 'check-failing');
			const c = compass('incident');
			expect(c.v.lead?.kind, 'the approval leads').toBe('approval');
			expect(c.v.approvals.length, 'and is the only ask, so v.approvals is empty').toBe(0);
expect(inbox('incident').items.some((i) => i.row.app === 'payments-core' && /deploy window opens/.test(i.reason)), 'the inbox keeps the ask').toBe(true);
		});
	});
	alsoCase('eu-west-like: a closed deploy window', { name: 'schedule-gate-zvsqr', kind: 'schedule', passing: false, allowedVersions: null }, /^Approve now; it deploys when the deploy window opens( .+)?$/, true);
	/* the ask says the build deploys when a window opens ONLY when every other refuser clears by itself; a failing check or a dependency does not, and is named by its display name */
	it('a window AND a failing check, plus the approval: the ask names the check, never the window', () => {
		withWindow(() => patched([{ name: 'schedule-gate-zvsqr', kind: 'schedule', passing: false, allowedVersions: null }, { name: 'smoke-check', kind: 'unknown', passing: false, allowedVersions: null }], () => {
			const ask = inbox('incident').items.find((i) => i.row.app === 'payments-core' && i.row.tier === 'prod');
			expect(ask?.reason).toBe("Approving won't deploy until Smoke check clears");
			expect(sentenceOf(prodRow(), 'incident')[0]).toBe('Held by Smoke check · also needs your approval');
		}));
	});
	it('a window AND a dependency, plus the approval: the ask names the dependency, never the window', () => {
		withWindow(() => patched([{ name: 'schedule-gate-zvsqr', kind: 'schedule', passing: false, allowedVersions: null }, { name: 'dependency-payments-svc', kind: 'dependency', passing: false, allowedVersions: null }], () => {
			const ask = inbox('incident').items.find((i) => i.row.app === 'payments-core' && i.row.tier === 'prod');
			expect(ask?.reason).toMatch(/^Approving won't deploy until .+ clears$/);
			expect(ask?.reason).not.toMatch(/window/i);
		}));
	});
	it("Home's ask for a single prod place names it by its display name, not the raw environment (prod-eu-west)", () => {
		withWindow(() => patched([{ name: 'schedule-gate-zvsqr', kind: 'schedule', passing: false, allowedVersions: null }], () => {
			const m = homeModel('incident');
			const app = m.apps.find((a) => a.app === 'payments-core')!;
			const envs = app.envs.filter((e) => e.state === 'held-by-rule' && e.alsoApproval);
			expect(envs.length).toBeGreaterThan(1);
			envs.slice(1).forEach((e) => { e.alsoApproval = null; e.state = 'healthy'; });
			const one = envs[0];
			one.myChanges = [];
			const e = buildSketch(m, ME).elsewhere.find((x) => x.app === 'payments-core' && x.kind === 'approval');
			expect(one.env, 'the fixture place is a raw prod-<site> environment').toMatch(/^prod-/);
			expect(e?.status).not.toContain(one.env);
			expect(e?.status).toContain(one.label);
		}));
	});
	alsoCase('a persistent hold (a failing check)', { name: 'smoke-check', kind: 'unknown', passing: false, allowedVersions: null }, /^Approving won't deploy until .+ clears$/);
	it('permits only the newest: BEFORE the grant the row and the inbox ask for the newest build; AFTER it the place reads Deploying and asks nothing', () => {
		const { newest } = targetAndNewest0();
		patched([{ name: 'permits-newest-only', kind: 'unknown', allowedVersions: [newest] }], () => {
			const t = approvalTarget(row('payments-core')!, 'incident')!;
			expect(t.build).toBe(newest);
			expect(sentenceOf(prodRow(), 'incident')[0]).toBe('Needs your approval');
			expect(prodRow().needsYou).toBe(true);
			expect(inbox('incident').items.some((i) => i.row.app === 'payments-core' && i.row.tier === 'prod'), 'the ask is in the inbox').toBe(true);
			grant(t);
			expect(sentenceOf(prodRow(), 'incident')[0]).toBe('Deploying');
			expect(prodRow().needsYou).toBe(false);
			expect(inbox('incident').items.some((i) => i.row.app === 'payments-core' && i.row.tier === 'prod'), 'no ask').toBe(false);
		});
	});
	it('a place that still checks or deploys a build reads its own bake state, whatever the rules say about it: no ask for a newer build yet, no inbox entry', () => {
		const { newest } = targetAndNewest0();
		patched([{ name: 'permits-newest-only', kind: 'unknown', allowedVersions: [newest] }], () => {
			const t0 = approvalTarget(row('payments-core')!, 'incident')!;
			const rs = (source().rollouts as unknown as { metadata: { name: string; namespace: string }; status: { history?: { bakeStatus?: string }[] } }[]).filter((r) => t0.places.some((p) => p.href.split('/').slice(3, 5).join('/') === `${r.metadata.namespace}/${r.metadata.name}`));
			const was = rs.map((r) => r.status.history![0].bakeStatus);
			try {
				for (const [bake, state, lead] of [['InProgress', 'checking', 'Checking'], ['Deploying', 'deploying', 'Deploying']]) {
					rs.forEach((r) => { r.status.history![0].bakeStatus = bake; });
					resetHomeModel();
					const pr = rollouts('incident').rows.filter((r) => r.app === 'payments-core' && r.tier === 'prod');
					expect(pr.length).toBeGreaterThan(0);
					for (const r of pr) {
						expect(r.state, bake).toBe(state);
						expect(sentenceOf(r, 'incident')[0], bake).toBe(lead);
						expect(r.needsYou, bake).toBe(false);
					}
					expect(inbox('incident').items.some((i) => i.row.app === 'payments-core' && i.row.tier === 'prod'), 'no ask').toBe(false);
				}
			} finally { rs.forEach((r, i) => { r.status.history![0].bakeStatus = was[i]; }); resetHomeModel(); }
		});
	});
	it('refuses every build: held after Approve, and the toast, the row and the Holding card name the same gate', () => {
		patched([{ name: 'refuses-all', kind: 'unknown', allowedVersions: [] }], () => {
			const t = approvalTarget(row('payments-core')!, 'incident')!;
			expect(t.waitsOn).toBe('Refuses all');
			expect(doneWords(t).detail).toBe(`payments-core: Held by Refuses all · ${t.where}`);
			grant(t);
			expect(rollouts('incident').rows.some((r) => r.app === 'payments-core' && r.tier === 'prod' && (r.state === 'deploying' || r.state === 'checking'))).toBe(false);
			expect(gatesOf('payments-core', 'incident').some((g) => g.holding && g.name === 'Refuses all')).toBe(true);
			expect(gatesOf('payments-core', 'incident').find((g) => g.id === 'refuses-all')?.holding).toBe(true);
		});
	});
	/* ONE cause formatter (data.ts `holdCause`): the row's lead and the toast's detail carry the identical cause string for the same verdict. Until a gate's pretty name is published an unnamed window reads "Waits for the deploy window" in both; once published, both read the published name. */
	const causeCase = (what: string, gate: G, expected: string, window = false) => it(`${what}: the row and the toast print the identical cause string`, () => {
		(window ? withWindow : (f: () => void) => f())(() => patched([gate], () => {
			const t = approvalTarget(row('payments-core')!, 'incident')!;
			expect(causeText(t.cause!)).toBe(expected);
			const lead = sentenceOf(prodRow(), 'incident')[0];
			expect(lead === causeText(t.cause!) || lead.startsWith(`${causeText(t.cause!)} ·`), `row "${lead}" starts with the cause`).toBe(true);
			expect(doneWords(t).detail).toBe(`payments-core: ${causeText(t.cause!)} · ${t.where}`);
		}));
	});
	causeCase('an unnamed deploy window (the pretty name is not published yet)', { name: 'schedule-gate-qqqqq', kind: 'schedule', passing: false, allowedVersions: null }, 'Waits for the deploy window');
	causeCase('a published deploy window (the schedule join names it)', { name: 'schedule-gate-zvsqr', kind: 'schedule', passing: false, allowedVersions: null }, 'Held by Business hours', true);
	causeCase('a failing check', { name: 'smoke-check', kind: 'unknown', passing: false, allowedVersions: null }, 'Held by Smoke check');
	/* viewer-owned: the viewer CAN approve payments-core (its other regions still ask), but ONE region is held by a static allow-list that lacks the build: that region asks nothing (no approval ever deploys it), while its siblings keep the ask. A rule-held row never takes needsYou from the app's ask. */
	it('a viewer-owned approval with ONE region held by a rule that never clears for the build: that region asks nothing, the others keep the ask', () => {
		const t0 = approvalTarget(row('payments-core')!, 'incident')!;
		const rs = (source().rollouts as unknown as R[]);
		const one = rs.find((r) => `${r.metadata.namespace}/${r.metadata.name}` === t0.places[0].href.split('/').slice(3, 5).join('/'))!;
		const gate = { name: 'refuses-all', kind: 'unknown', allowedVersions: [] };
		one.status.gates!.push(gate); resetHomeModel();
		try {
			const prod = rollouts('incident').rows.filter((r) => r.app === 'payments-core' && r.tier === 'prod');
			const held = prod.filter((r) => r.state === 'held-by-rule'), asking = prod.filter((r) => r.state === 'awaiting-approval');
			expect(held.length, 'one region is rule-held').toBe(1);
			expect(asking.length, 'the siblings still ask').toBeGreaterThan(0);
			for (const r of held) { expect(r.needsYou, 'no false call to action on the rule-held region').toBe(false); expect(sentenceOf(r, 'incident')[0]).toBe('Held by Refuses all'); }
			for (const r of asking) expect(r.needsYou).toBe(true);
			const keys = inbox('incident').items.filter((i) => i.row.app === 'payments-core').map((i) => i.row.key);
			expect(keys).not.toContain(held[0].key);
			expect(keys).toContain(asking[0].key);
		} finally { one.status.gates = one.status.gates!.filter((g) => g.name !== gate.name); resetHomeModel(); }
	});
	it('permits the target, refuses only the newest: BEFORE the grant the row and the inbox ask for the approval (it deploys the target), plain toast', () => {
		const { target } = targetAndNewest();
		patched([{ name: 'permits-target-only', kind: 'unknown', allowedVersions: [target] }], () => {
			const t = approvalTarget(row('payments-core')!, 'incident')!;
			expect(t.waitsOn ?? null).toBeNull();
			expect(t.deploys ?? null).toBeNull();
			expect(doneWords(t).detail).toBe(`payments-core is deploying to ${t.where}`);
			/* the build being approved is permitted by every other gate, so the approval is the ONLY thing between it and deploying: the ask is kept, in the row and in the inbox */
			const prod = rollouts('incident').rows.filter((x) => x.app === 'payments-core' && x.tier === 'prod');
			expect(prod.length).toBeGreaterThan(0);
			for (const r of prod) { expect(r.state).toBe('awaiting-approval'); expect(sentenceOf(r, 'incident')[0]).toBe('Needs your approval'); expect(r.needsYou).toBe(true); expect(r.alsoApproval ?? null).toBeNull(); }
			const ask = inbox('incident').items.find((i) => i.row.app === 'payments-core' && i.row.tier === 'prod');
			expect(ask?.reason, 'the inbox keeps the ask, with no "won\'t deploy until" qualifier').toBe('Needs your approval');
		});
	});
	it('permits the target, refuses only the newest: AFTER the grant c0d3e88 (the approved build) is deploying, and the place reads Deploying while f4a2c19 waits behind Permits target only', () => {
		const { target, newest } = targetAndNewest();
		patched([{ name: 'permits-target-only', kind: 'unknown', allowedVersions: [target] }], () => {
			const t = approvalTarget(row('payments-core')!, 'incident')!;
			expect(t.places.map((p) => p.tag)).toEqual(t.places.map(() => target));
			grant(t);
			/* the approved build left the candidates and started deploying; the newest awaits its own approval but permits-target-only refuses it. The approved build deploying outranks a hold on the NEXT build */
			const prod = rollouts('incident').rows.filter((x) => x.app === 'payments-core' && x.tier === 'prod');
			expect(prod.length).toBeGreaterThan(0);
			for (const r of prod) { expect(r.state).toBe('deploying'); expect(sentenceOf(r, 'incident')[0]).toBe('Deploying'); expect(r.needsYou).toBe(false); }
			expect(inbox('incident').items.some((i) => i.row.app === 'payments-core' && i.row.tier === 'prod'), 'no ask for the build that cannot deploy').toBe(false);
			expect(newest).not.toBe(target);
			const envs = homeModel('incident').apps.find((a) => a.app === 'payments-core')!.envs.filter((e) => e.isProdRegion && e.placeVerdict);
			expect(envs.length).toBeGreaterThan(0);
			for (const e of envs) { expect(e.placeVerdict!.state, 'the verdict itself says the approved build is running').toBe('running'); expect(e.alsoApproval ?? null).toBeNull(); }
		});
	});
	it('a promotion gate named ghd-* (the live naming) decides where a build is held', () => {
		patched([{ name: 'ghd-xcrhl', kind: 'promotion', passing: false, allowedVersions: [] }], () => {
			const p = approvalTarget(row('payments-core')!, 'incident')!.places[0];
			expect(candidateBuilds({ app: 'payments-core', href: p.href }).every((c) => c.here)).toBe(false);
		});
	});
});

/* on a phone the second ask of a held row ("· also needs your approval") wraps, never an ellipsis: the wrap rule must stay in the row's stylesheet */
import { readFileSync } from 'node:fs';
it('a wrapping held row keeps its phone wrap rule (white-space: normal, no ellipsis)', () => {
	const css = readFileSync(new URL('./StrandRow.svelte', import.meta.url), 'utf8');
	expect(css).toMatch(/\.lr-sn\.wrap\s*\{[^}]*white-space:\s*normal[^}]*text-overflow:\s*clip/);
});
