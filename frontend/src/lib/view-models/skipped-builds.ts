/**
 * QA round 2 A8. A candidate build that an earlier stage has already passed over is not "coming": staging runs e7c1b60, so 1e6c579 (older)
 * will never reach it. `skippedPredicate` answers that for `heldBuilds`/`blockingStory` from facts every rollout page already has: the
 * rollout's own `availableReleases` (with `created`) and what the app's other environments run now (`stageBuilds`, from the fleet list).
 * Role: the Gates tab ("Waiting for staging" vs "Skipped by staging") and the detail banner lead; lane B's app page has its own `streamBuilds`
 * for the same fact on the Builds ledger, which ranks by the release stream; this one ranks by `created` because it has no ledger.
 */
import type { Rollout } from '$lib/../types';
import { rolloutEnvironmentName } from './deploy-risk';

type Rel = { tag?: string; version?: string; revision?: string; created?: string };

/** env name -> the release (from THIS rollout's availableReleases) that environment's rollout of the same app runs now. */
export function stageBuilds(rollout: Rollout | null | undefined, fleet: readonly Rollout[] | null | undefined): Map<string, Rel> {
	const out = new Map<string, Rel>();
	const name = rollout?.metadata?.name;
	if (!rollout || !name) return out;
	const rels = (rollout.status?.availableReleases ?? []) as Rel[];
	for (const r of fleet ?? []) {
		if (r.metadata?.name !== name || r.metadata?.namespace === rollout.metadata?.namespace) continue;
		const cur = r.status?.history?.[0]?.version as Rel | undefined;
		if (!cur) continue;
		const rel = rels.find((x) => (cur.tag && x.tag === cur.tag) || (cur.revision && x.revision === cur.revision) || (cur.version && x.version === cur.version));
		const env = rolloutEnvironmentName(r);
		if (rel && env) out.set(env, rel);
	}
	return out;
}

export function skippedPredicate(
	rollout: Rollout | null | undefined,
	stages: ReadonlyMap<string, Rel>
): (entry: { tag: string }, stage: string) => boolean {
	const rels = (rollout?.status?.availableReleases ?? []) as Rel[];
	return (entry, stage) => {
		const running = stages.get(stage);
		const cand = rels.find((x) => x.tag === entry.tag || x.version === entry.tag);
		const a = Date.parse(cand?.created ?? '');
		const b = Date.parse(running?.created ?? '');
		return Number.isFinite(a) && Number.isFinite(b) && a < b;
	};
}

/**
 * QA #23. The one wording for a build that is refused only by chain order at `stage`: "Skipped by staging" when `stage` already runs a
 * newer build (the same `skippedPredicate` the banner and Gates tab read), else "Waits for staging". The Newer builds rows print this;
 * they never carry their own copy of the rule.
 */
export function chainWaitLabel(
	skipped: (entry: { tag: string }, stage: string) => boolean,
	entry: { tag: string },
	stage: string
): { skipped: boolean; text: string } {
	const s = skipped(entry, stage);
	return { skipped: s, text: `${s ? 'Skipped by' : 'Waits for'} ${stage}` };
}
