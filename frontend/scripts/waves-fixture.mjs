#!/usr/bin/env node
/**
 * One-shot conversion of the Home incident fixture to the sites-and-waves model
 * (environment-controller feat/sites-and-waves). Run once; the output is committed
 * next to this script and is the source of truth from then on. Idempotent.
 *
 *   node scripts/waves-fixture.mjs
 *
 * What it does, per Environment:
 *  - `spec.environment: prod-<r>` becomes `{environment: 'prod', site: '<r>', wave: N}`.
 *    Every other tier stays single-site (no `spec.site`; the controller reports `default`).
 *  - `spec.relationship` is deleted (the controller ignores it).
 *  - `status.wave` is added: {site, environment, name, wave, role, leader, selectedRevision,
 *    members}. Members cover the env's own tier and its upstream tier.
 *  - `status.conditions` gets WaveReady and LockstepConsistent in the controller's own formats.
 *
 * Wave assignment is derived from the CURRENT versions so the story stays true: the multi-site
 * prod tier is ranked by how recently each distinct running revision first appeared anywhere in the
 * app's rollout histories. Sites on the newest build are wave 1, the next-newest build is wave 2, and
 * so on. The lowest site name leads its wave, and the script refuses to run if that leader is not
 * a healthy (Succeeded) site: the wave-1 set would have to be chosen differently.
 * A wave-N site waits (`WaitingFor <tier>/<site> bake on <rev7>`) only while a site of the previous
 * wave has not finished baking its own revision; otherwise it is Ready.
 *
 * The place keys do not change: a tier with several live sites keys as `${tier}-${site}`, which is
 * byte-identical to the old `prod-<region>` names.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, '../src/lib/view-models/home/fixtures/incident-input.json');
const j = JSON.parse(readFileSync(file, 'utf8'));

const TIERS = ['dev', 'test', 'staging', 'prod'];
const tierOf = (n) => (n.startsWith('prod-') ? 'prod' : n);
const rev7 = (v) => (v || '').slice(0, 7);

// ── pass 1: tier / site, relationship out ────────────────────────────────
const rows = j.environments.map((env) => {
	const raw = env.spec.environment;
	const tier = tierOf(raw);
	const site = raw.startsWith('prod-') ? raw.slice('prod-'.length) : (env.spec.site ?? 'default');
	delete env.spec.relationship;
	const rollout = j.rollouts.find(
		(r) => r.metadata.namespace === env.metadata.namespace && r.metadata.name === env.spec.rolloutRef.name
	);
	const h = rollout?.status?.history?.[0];
	return { env, tier, site, multi: raw.startsWith('prod-') || !!env.spec.site, rollout, h };
});

// ── per app ──────────────────────────────────────────────────────────────
const apps = new Map();
for (const r of rows) {
	const k = r.env.spec.name;
	if (!apps.has(k)) apps.set(k, []);
	apps.get(k).push(r);
}

for (const [name, list] of apps) {
	// first time each tag was seen anywhere in this app's histories
	const firstSeen = new Map();
	for (const r of list)
		for (const x of r.rollout?.status?.history ?? []) {
			const t = Date.parse(x.timestamp ?? '');
			const tag = x.version?.tag;
			if (tag && (!firstSeen.has(tag) || t < firstSeen.get(tag))) firstSeen.set(tag, t);
		}
	const tiersHere = TIERS.filter((t) => list.some((r) => r.tier === t));

	for (const tier of tiersHere) {
		const sites = list.filter((r) => r.tier === tier);
		const multi = sites.some((s) => s.multi);
		if (!multi) {
			for (const s of sites) s.wave = 1;
		} else {
			const tags = [...new Set(sites.map((s) => s.h?.version?.tag))].sort(
				(a, b) => (firstSeen.get(b) ?? 0) - (firstSeen.get(a) ?? 0)
			);
			for (const s of sites) s.wave = tags.indexOf(s.h?.version?.tag) + 1;
		}
		const waves = [...new Set(sites.map((s) => s.wave))].sort((a, b) => a - b);
		for (const w of waves) {
			const ws = sites.filter((s) => s.wave === w).sort((a, b) => (a.site < b.site ? -1 : 1));
			ws.forEach((s, i) => (s.leader = ws[0].site));
			ws.forEach((s, i) => (s.role = i === 0 ? 'Leader' : 'Follower'));
			if (w === 1 && sites.length > 1 && ws[0].h?.bakeStatus !== 'Succeeded')
				throw new Error(`${name}: wave-1 leader ${ws[0].site} is not healthy`);
		}
	}

	const member = (s) => ({
		environment: s.tier,
		site: s.site,
		wave: s.wave,
		...(s.h?.version?.revision || s.h?.version?.tag
			? { revision: s.h.version.revision || s.h.version.tag }
			: {}),
		...(s.h?.bakeStatus ? { bakeStatus: s.h.bakeStatus } : {})
	});

	for (const s of list) {
		const idx = tiersHere.indexOf(s.tier);
		const up = idx > 0 ? tiersHere[idx - 1] : null;
		const own = list.filter((x) => x.tier === s.tier);
		const upstream = up ? list.filter((x) => x.tier === up) : [];
		const wave = own.filter((x) => x.wave === s.wave);
		const leader = wave.find((x) => x.role === 'Leader');
		s.env.spec.environment = s.tier;
		if (s.multi) {
			s.env.spec.site = s.site;
			s.env.spec.wave = s.wave;
		}
		// blocked while any site of the previous wave is still baking
		let cond = {
			status: 'True',
			reason: 'Ready',
			message: 'site may deploy the allowed versions'
		};
		if (s.wave > 1) {
			const prev = own.filter((x) => x.wave === s.wave - 1);
			const baking = prev.find((x) => x.h?.bakeStatus && x.h.bakeStatus !== 'Succeeded');
			if (baking)
				cond = {
					status: 'False',
					reason: 'WaitingFor',
					message: `${baking.tier}/${baking.site} bake on ${rev7(baking.h.version.revision || baking.h.version.tag)}`
				};
		}
		const t = s.env.status?.lastStatusChangeTime ?? j.capturedAt;
		s.env.status = s.env.status ?? {};
		s.env.status.wave = {
			site: s.site,
			environment: s.tier,
			name: `kuberik-${name}`,
			wave: s.wave,
			role: s.role ?? 'Leader',
			leader: leader ? leader.site : s.site,
			...(leader?.h?.version
				? { selectedRevision: leader.h.version.revision || leader.h.version.tag }
				: {}),
			members: [...upstream, ...own].map(member)
		};
		const conds = (s.env.status.conditions ?? []).filter(
			(c) => c.type !== 'WaveReady' && c.type !== 'LockstepConsistent'
		);
		conds.push(
			{ type: 'WaveReady', lastTransitionTime: t, ...cond },
			{
				type: 'LockstepConsistent',
				status: 'True',
				reason: 'Consistent',
				message: 'all members agree on lockstep',
				lastTransitionTime: t
			}
		);
		s.env.status.conditions = conds;
		console.log(
			`${name.padEnd(24)} ${s.tier.padEnd(8)} ${s.site.padEnd(16)} w${s.wave} ${(s.role ?? '').padEnd(8)} ${cond.status === 'True' ? 'Ready' : cond.message}`
		);
	}
}

writeFileSync(file, JSON.stringify(j, null, '\t') + '\n');
