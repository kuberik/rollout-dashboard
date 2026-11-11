import { gateAllows } from './promotion';
import { gateKindOf, type GateKind } from './gate-kind';

/**
 * THE ONE PER-PLACE VERDICT (batch4 #92, QA28 redesign). A place that has an approval pending is judged against ONE build, the build a
 * person is deciding on (`targetBuild`), and against what refuses THAT build once the approval is written (`approvalWrite`). Every
 * surface that prints the place's state (the env model's card, the rows, the inbox, the toast, the Holding card) asks this function, so
 * none can judge another build or another rule.
 *
 *  - no non-approval gate refuses the build after the approval  -> awaiting-approval (ask kept)
 *  - some gate still refuses it                                 -> held-by-rule, naming the first refuser in blame order
 *                                                                  (a persistent check / dependency / unknown, then a promotion order, then a window),
 *                                                                  and `also`: the approval is ALSO pending for that build
 *  - ... unless the place's own newest history entry is the approved build and it is running (Deploying / InProgress): the approval did
 *    its work, the place reads its own bake state, and a hold on the NEXT build does not outrank it (`running`)
 *
 * A leaf module (no data-layer imports): the model, the roster and the page layer all import it.
 */
export type VGate = { name: string; kind?: string | null; passing?: boolean | null; allowedVersions?: string[] | null };

/** THE APPROVAL WRITE, ONE FUNCTION: what a person's Approve does to the approval gate's allow-list. Conservative, per-build: it allows ONLY the approved build. There is no real approve endpoint yet (lib/api/approvals.ts); this MUST match the real write once the approval API lands. */
export const approvalWrite = (allowed: readonly string[], approvedTag: string): string[] => [...new Set([...allowed, approvedTag])];

/** The approval gate that refuses every candidate: `kind` says it; only a payload without `kind` falls back to the gate's name (THE ONLY place a name is read). */
export const approvalGateOf = <G extends VGate>(gates: readonly G[], cands?: readonly string[]): G | undefined =>
	gates.find((x) => (x.kind == null ? /approval/.test(x.name) : x.kind === 'approval') && x.allowedVersions != null && (!cands || cands.every((c) => !x.allowedVersions!.includes(c))));

/** a gate of kind approval is the approval only when it carries an allow-list (what Approve edits): an ownerless check the backend can only call `approval`, with no allow-list, still refuses */
export const isApprovalGate = (g: VGate, own: VGate | undefined): boolean => g === own || (gateKindOf(g) === 'approval' && g.allowedVersions != null);

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

/** THE build a person is deciding on at a place: the candidate that got furthest through the tiers below (what an approval is for), not a newer build still behind it; the newest on a tie. `reachOf` is -1 for a build no lower tier runs. '' when nothing is a candidate. */
export function targetBuild(cands: readonly string[], reachOf: (tag: string) => number): string {
	let best = '', bestReach = -2;
	for (const c of cands) { const r = reachOf(c); if (r > bestReach) { best = c; bestReach = r; } }
	return best;
}

export type AlsoKind = 'window' | 'order' | 'hold';
export type PlaceVerdict<G extends VGate = VGate> =
	| { state: 'awaiting-approval'; target: string }
	/** the approved build is itself Deploying / InProgress here: the place reads its own bake state, whatever refuses the next build */
	| { state: 'running'; target: string }
	| { state: 'held-by-rule'; target: string; first: G; refusers: G[]; /** the approval is also pending for this build */ also: { kind: AlsoKind } };

/** blame order: a persistent refuser (a failing check, a dependency, an unattributed gate) decides over a promotion order, which decides over a window (clears by itself) */
const BLAME = (g: VGate): number => { const k = gateKindOf(g); return k === 'schedule' ? 2 : k === 'promotion' ? 1 : 0; };
export const alsoKindOf = (g: VGate): AlsoKind => { const k = gateKindOf(g); return k === 'schedule' ? 'window' : k === 'promotion' ? 'order' : 'hold'; };

export type PlaceVerdictInput<G extends VGate> = {
	gates: readonly G[];
	/** the live candidates, newest first */
	cands: readonly string[];
	/** the build in question (`targetBuild`) */
	target: string;
	/** the place's newest history entry */
	running?: { tag: string; bake?: string | null } | null;
};

/** null: no approval is pending at this place (the caller reads the gates as they are). */
export function placeVerdict<G extends VGate>(i: PlaceVerdictInput<G>): PlaceVerdict<G> | null {
	const own = approvalGateOf(i.gates, i.cands);
	if (!own || !i.cands.length || !i.target) return null;
	const refusers = refusingGatesAfterApproval(i.gates, own, i.target);
	if (!refusers.length) return { state: 'awaiting-approval', target: i.target };
	const r = i.running;
	if (r && (r.bake === 'Deploying' || r.bake === 'InProgress') && gateWrites(i.gates, own, r.tag)) return { state: 'running', target: i.target };
	const sorted = [...refusers].sort((a, b) => BLAME(a) - BLAME(b));
	return { state: 'held-by-rule', target: i.target, first: sorted[0], refusers: sorted, also: { kind: alsoKindOf(sorted[0]) } };
}

/** the gates (not the approval) that still refuse `tag` once it is approved */
export function refusingGatesAfterApproval<G extends VGate>(gates: readonly G[], own: G | undefined, tag: string): G[] {
	return refusingGates(gates, tag).filter((x) => !isApprovalGate(x, own));
}

/** the build `tag` is approved (the approval gate allows it) AND every other gate lets it through: it is what an approval deployed */
function gateWrites(gates: readonly VGate[], own: VGate, tag: string): boolean {
	return own.allowedVersions!.includes(tag) && refusingGatesAfterApproval(gates, own, tag).length === 0;
}
