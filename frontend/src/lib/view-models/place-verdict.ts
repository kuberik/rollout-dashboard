import { gateAllows } from './promotion';
import { gateKindOf, type GateKind } from './gate-kind';

/**
 * THE ONE PER-PLACE VERDICT. A place that has an approval pending is judged against ONE build, the build a person is deciding on
 * (`pickBuildInQuestion`), and against what refuses THAT build once the approval is written (`approvalWrite`). Every surface that prints
 * the place's state (the env model's card, the rows, the inbox, the toast, the approval target, the app detail's holds) asks this
 * function, so none can judge another build or another rule.
 *
 *  - the place's own newest history entry is Deploying / InProgress with a build every allow-list permits -> running: the place reads
 *    its own bake state, whatever any gate says about another build (a window closing mid-deploy, an approval pending for a newer build)
 *  - no non-approval gate refuses the build after the approval  -> awaiting-approval (ask kept)
 *  - some gate still refuses it                                 -> held-by-rule, naming the first refuser in blame order
 *                                                                  (a persistent check / dependency / unknown, then a promotion order, then a window),
 *                                                                  and `also`: the approval is ALSO pending for that build
 *
 * A leaf module (no data-layer imports): the model, the roster and the page layer all import it.
 */
export type VGate = { name: string; kind?: string | null; passing?: boolean | null; allowedVersions?: string[] | null };

/** THE APPROVAL WRITE, ONE FUNCTION: what a person's Approve does to the approval gate's allow-list. Conservative, per-build: it allows ONLY the approved build. There is no real approve endpoint yet (lib/api/approvals.ts); this MUST match the real write once the approval API lands. */
export const approvalWrite = (allowed: readonly string[], approvedTag: string): string[] => [...new Set([...allowed, approvedTag])];

/** The approval gate that refuses every candidate: `kind` says it; only a payload without `kind` falls back to the gate's name (THE ONLY place a name is read). */
export const approvalGateOf = <G extends VGate>(gates: readonly G[], cands?: readonly string[]): G | undefined =>
	gates.find((x) => (x.kind == null ? /approval/.test(x.name) : x.kind === 'approval') && x.allowedVersions != null && (!cands || cands.every((c) => !x.allowedVersions!.includes(c))));

/** The gates that refuse `tag`: its allow-list lacks it, or (no allow-list: a closed deploy window, a failing check) the gate is not passing. */
export const refusingGates = <G extends VGate>(gates: readonly G[], tag: string): G[] => gates.filter((x) => (x.allowedVersions != null ? !!tag && !x.allowedVersions.includes(tag) : x.passing === false));

/** The candidates (newest first) that EVERY gate allows, `promotionBlock`'s own predicate, after `approvedTag` has been written to the approval gate(s) (none: the gates as they are). */
export function deployableTags(gates: readonly VGate[], cands: readonly string[], approvedTag?: string): string[] {
	const own = approvalGateOf(gates);
	return cands.filter((c) => gates.every((g) => {
		const isApproval = approvedTag != null && g.allowedVersions != null && (g === own || gateKindOf(g) === 'approval');
		return gateAllows({ passing: g.passing ?? undefined, allowedVersions: isApproval ? approvalWrite(g.allowedVersions!, approvedTag!) : g.allowedVersions }, c);
	}));
}

/**
 * THE build a person is deciding on at a place, ONE pick for every surface: the newest candidate that every NON-approval gate lets
 * through (the clock, a check, a dependency and the promotion order all decide here), and among those the one that got furthest through
 * the tiers below (what an approval is for), not a newer build still behind it; the newest on a tie. When no candidate passes (a closed
 * window, a rule that refuses everything) the same furthest-reach rule picks among all of them, so the hold still names a build.
 * `reachOf` is -1 for a build no lower tier has finished; a peer still deploying a build has not reached the next stage with it.
 * '' when nothing is a candidate.
 */
export function pickBuildInQuestion(gates: readonly VGate[], cands: readonly string[], reachOf: (tag: string) => number): string {
	const open = cands.filter((c) => refusingGates(gates, c).every(isApprovalLike));
	let best = '', bestReach = -2;
	for (const c of open.length ? open : cands) { const r = reachOf(c); if (r > bestReach) { best = c; bestReach = r; } }
	return best;
}

export type AlsoKind = 'window' | 'order' | 'hold';
export type PlaceVerdict<G extends VGate = VGate> =
	| { state: 'awaiting-approval'; target: string }
	/** the place's newest build is Deploying / InProgress and every allow-list permits it: the place reads its own bake state, whatever refuses another build */
	| { state: 'running'; target: string }
	| { state: 'held-by-rule'; target: string; first: G; refusers: G[]; /** the approval is ALSO pending for this build and would still deploy it once the refuser clears; null when the refuser is a static allow-list that does not list the build (no approval and no clock ever clears it for THIS build: the ask would be a false call to action) */ also: { kind: AlsoKind } | null };

/** blame order: a persistent refuser (a failing check, a dependency, an unattributed gate) decides over a promotion order, which decides over a window (clears by itself) */
const BLAME = (g: VGate): number => { const k = gateKindOf(g); return k === 'schedule' ? 2 : k === 'promotion' ? 1 : 0; };
/** a hand-written allow-list (kind unknown, with a list) that lacks the build: nothing the dashboard shows clears it for that build */
const isStaticRefusal = (g: VGate): boolean => gateKindOf(g) === 'unknown' && g.allowedVersions != null;
export const alsoKindOf = (g: VGate): AlsoKind => { const k = gateKindOf(g); return k === 'schedule' ? 'window' : k === 'promotion' ? 'order' : 'hold'; };

export type PlaceVerdictInput<G extends VGate> = {
	gates: readonly G[];
	/** the live candidates, newest first */
	cands: readonly string[];
	/** the build in question (`pickBuildInQuestion`) */
	target: string;
	/** the place's newest history entry */
	running?: { tag: string; bake?: string | null } | null;
};

/** a gate that is the approval: `kind` says it (only a payload without `kind` falls back to the name) and it carries the allow-list Approve edits */
export const isApprovalLike = (x: VGate): boolean => (x.kind == null ? /approval/.test(x.name) : x.kind === 'approval') && x.allowedVersions != null;

/** null: no approval gate refuses any live candidate here (the caller reads the gates as they are), or the target is approved and nothing refuses it (it deploys). */
export function placeVerdict<G extends VGate>(i: PlaceVerdictInput<G>): PlaceVerdict<G> | null {
	const approvals = i.gates.filter(isApprovalLike);
	if (!i.cands.length || !i.target || !approvals.some((a) => i.cands.some((c) => !a.allowedVersions!.includes(c)))) return null;
	const r = i.running;
	if (r && (r.bake === 'Deploying' || r.bake === 'InProgress') && i.gates.every((g) => g.allowedVersions == null || g.allowedVersions.includes(r.tag))) return { state: 'running', target: i.target };
	const pending = approvals.some((a) => !a.allowedVersions!.includes(i.target));
	const refusers = refusingGates(i.gates, i.target).filter((x) => !isApprovalLike(x));
	if (!refusers.length) return pending ? { state: 'awaiting-approval', target: i.target } : null;
	const sorted = [...refusers].sort((a, b) => BLAME(a) - BLAME(b));
	return { state: 'held-by-rule', target: i.target, first: sorted[0], refusers: sorted, also: pending && !isStaticRefusal(sorted[0]) ? { kind: alsoKindOf(sorted[0]) } : null };
}
