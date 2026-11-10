import { describe, expect, it } from 'vitest';
import { resetDemoState } from './state';
import { respond } from './respond';
import { respondGithub } from './github-data';
import { buildPrPipeline } from '../view-models/pr-pipeline';
import type { PrPipelineMeta } from '../view-models/pr-pipeline';
import type { ChangesResponse } from '../api/changes';
import type { Rollout, Environment, RolloutDependency } from '../../types';

/**
 * ⭐ (2026-10-11, squad-changes "Median merge→prod" fix, requirement C —
 * "MERGE ORDER"). `firstProdLeadMs` (`changes.ts`) and `containment()`
 * (`pr-pipeline.ts`) both take it on faith that a build's own git ancestry
 * agrees with the calendar: if build `B` carries change `A` (`A.sha` is one
 * of the shas `B`'s own commit history walks over), `B`'s commit cannot
 * have merged BEFORE `A` did — that would mean a child commit existing
 * before its own parent. This fixture hands every change a CALENDAR
 * position (`mergedAtMs`, hand-tuned per app) independently of its LADDER
 * position (`containedIn`) — `VIEWER_SHORT_PROD_LEAD_MINUTES_AGO`'s own
 * pin was exactly this kind of disagreement before it was fixed (a
 * successor build's generic merge age put it chronologically BEFORE the
 * change it was supposed to contain). This test is the general guard: over
 * the WHOLE feed, in every scenario, no change may be contained only in
 * builds whose own commit merged before it did.
 */
function mergeOrderViolations(scenario: 'calm' | 'incident' | 'wide'): string[] {
	resetDemoState(scenario);
	const res = respondGithub('GET', '/api/github/changes', new URLSearchParams({ days: '365' }));
	expect(res).not.toBeNull();
	const body = JSON.parse(res!.body) as ChangesResponse;
	const changes = body.changes;

	// One lookup: sha → the change THAT sha itself merged as (so we can read
	// its own `mergedAt` when it shows up in some OTHER change's `containedIn`).
	const bySha = new Map<string, (typeof changes)[number]>();
	for (const c of changes) {
		if (c.mergeCommitSha) bySha.set(c.mergeCommitSha, c);
	}

	const violations: string[] = [];
	for (const change of changes) {
		const mergedMs = new Date(change.mergedAt).getTime();
		if (!Number.isFinite(mergedMs)) continue;
		for (const containingSha of change.containedIn) {
			const containingChange = bySha.get(containingSha);
			if (!containingChange) continue; // the containing build has no change record of its own — nothing to compare
			const containingMergedMs = new Date(containingChange.mergedAt).getTime();
			if (!Number.isFinite(containingMergedMs)) continue;
			if (containingMergedMs < mergedMs) {
				violations.push(
					`${change.repo}#${change.number ?? change.mergeCommitSha} (merged ${change.mergedAt}) is ` +
						`"contained in" ${containingSha} (merged ${containingChange.mergedAt}) — the containing ` +
						`build's own commit merged BEFORE the change it supposedly carries.`
				);
			}
		}
	}
	return violations;
}

describe('demo feed — merge order never disagrees with containment (requirement C)', () => {
	it.each(['calm', 'incident', 'wide'] as const)('%s: no change is contained only in an earlier-merged build', (scenario) => {
		const violations = mergeOrderViolations(scenario);
		expect(violations, violations.join('\n')).toEqual([]);
	});
});

/**
 * ⭐ (2026-10-12, squad-changes QA pass — "CAUSALITY", item 1). A STRICTER,
 * MORE LITERAL CHECK than the one above: not just "does a later change's
 * own merge record agree with containment", but "does ANY actual
 * `status.history` entry, on ANY real rollout, that `historyMatches` says
 * CARRIES a change, have a timestamp older than that change's own
 * `mergedAt`" — i.e. was this build ever recorded as having been deployed
 * before the commit that produced it (or that it descends from) existed.
 * This is the SAME membership test `buildCell`'s own `historyMatches`
 * already computes (prefix-matched `ShaSet`), read here for every change
 * against every service/cell `buildPrPipeline` resolves for it, which is
 * exactly how QA's own probe found the original 113→212 count.
 *
 * ⭐ (2026-10-12, squad-changes QA pass — item 3, "GATE EVERY REPO"). WAS
 * scoped to only the seven apps QA first named explicitly, with the rest
 * (telemetry-*, recommender-svc, standalone-api, hello-frontend-app)
 * reported but not gated. QA's `#28` finding (`recommender-svc`'s own
 * viewer change aging to ~25 days via `FLEET_BACKFILL`'s own
 * `backfillSha` fallback reusing it) was exactly the kind of violation
 * that exemption would have hidden forever — "bringing THOSE to zero is a
 * separate pass" turned into "nobody ever checks them." `scoped` now
 * covers every repo the feed produces; `all`/`scoped` have converged
 * (kept as two names, `all` for a future caller that ever wants an
 * intentionally narrower scope again, documented here rather than
 * silently reintroduced).
 */
function allRepos(changes: readonly { repo: string }[]): ReadonlySet<string> {
	return new Set(changes.map((c) => c.repo));
}

function causalityViolations(scenario: 'calm' | 'incident' | 'wide'): { scoped: string[]; all: string[] } {
	resetDemoState(scenario);
	const rolloutsRes = respond('GET', '/api/rollouts');
	const rolloutsBody = JSON.parse(rolloutsRes.body!) as {
		rollouts: { items: Rollout[] };
		environments: { items: Environment[] };
		rolloutDependencies: { items: RolloutDependency[] };
	};
	const changesRes = respondGithub('GET', '/api/github/changes', new URLSearchParams({ days: '365' }));
	expect(changesRes).not.toBeNull();
	const changesBody = JSON.parse(changesRes!.body) as ChangesResponse;
	const causalityScopedRepos = allRepos(changesBody.changes);

	const all: string[] = [];
	const scoped: string[] = [];
	for (const change of changesBody.changes) {
		const mergedMs = new Date(change.mergedAt).getTime();
		if (!Number.isFinite(mergedMs)) continue;
		const meta: PrPipelineMeta = {
			owner: change.owner,
			repo: change.repo,
			number: change.number ?? 0,
			mergedAt: change.mergedAt,
			mergeCommitSha: change.mergeCommitSha,
			containedIn: change.containedIn,
			containedInAll: change.containedInAll,
			containmentKnown: true
		};
		const vm = buildPrPipeline(
			meta,
			rolloutsBody.rollouts.items,
			rolloutsBody.environments.items,
			{ items: rolloutsBody.rolloutDependencies.items },
			new Date()
		);
		for (const service of vm.services) {
			for (const cell of service.cells) {
				for (const match of cell.historyMatches ?? []) {
					const matchMs = new Date(match.timestamp).getTime();
					if (!Number.isFinite(matchMs)) continue;
					if (matchMs < mergedMs) {
						const line =
							`${change.repo}#${change.number ?? change.mergeCommitSha} merged=${change.mergedAt} ` +
							`is carried by ${cell.namespace}/${cell.rolloutName} rev=${match.revision} ` +
							`at=${match.timestamp} (deployed before its own merge)`;
						all.push(line);
						if (causalityScopedRepos.has(change.repo)) scoped.push(line);
					}
				}
			}
		}
	}
	return { scoped, all };
}

describe('demo feed — a deploy never predates its own change\'s merge (QA causality pass)', () => {
	it.each(['calm', 'incident', 'wide'] as const)('%s: zero violations, for every repo in the feed', (scenario) => {
		const { scoped } = causalityViolations(scenario);
		expect(scoped, scoped.join('\n')).toEqual([]);
	});
});

/**
 * ⭐ (2026-10-12, squad-changes QA pass — item 4, "#28 AGING"). PINS THE
 * FIX. `recommender-svc/dev`'s own `FLEET` entry (`mock-data.ts`) had no
 * `previousVersion`, so `FLEET_BACKFILL_DEEPEST_MIN_AGO`'s own
 * `backfillSha = previousVersion ?? currentVersion` fallback reused
 * `4b9c2e1` — THE VIEWER'S OWN `#28` (`VIEWER_AUTHORED`, `github-data.ts`)
 * — for `FLEET_BACKFILL['recommender-svc/dev']`'s 26-day-deep backfill,
 * forcing #28's own merge pin that far back too (the SAME causality floor
 * that fixed `orders-api`#88's violation, applied here to a sha it was
 * never meant to touch) — the KPI read "~25d" where a change that recent
 * should read "about 1d". `previousVersion: '88c0e51'` (the app's own
 * ladder root, `github-data.ts`) breaks that reuse. Pinned here so a
 * future edit to `FLEET`/`FLEET_BACKFILL` that reintroduces the fallback
 * fails loudly instead of silently re-aging the viewer's own change.
 */
describe('recommender-svc#28 (the viewer\'s own change) merges about 1 day ago, not 25 (requirement 4)', () => {
	it.each(['calm', 'incident', 'wide'] as const)('%s', (scenario) => {
		resetDemoState(scenario);
		const now = new Date();
		const res = respondGithub('GET', '/api/github/changes', new URLSearchParams({ days: '365' }));
		expect(res).not.toBeNull();
		const body = JSON.parse(res!.body) as ChangesResponse;
		const c28 = body.changes.find((c) => c.repo === 'recommender-svc' && c.number === 28);
		expect(c28, 'recommender-svc#28 (4b9c2e1) must exist in the fixture universe').toBeTruthy();
		expect(c28!.mergeCommitSha).toBe('4b9c2e1');
		const ageDays = (now.getTime() - new Date(c28!.mergedAt).getTime()) / 86_400_000;
		expect(ageDays).toBeGreaterThan(0);
		expect(ageDays).toBeLessThan(3);
	});
});
