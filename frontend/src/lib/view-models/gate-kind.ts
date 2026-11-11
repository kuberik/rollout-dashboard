/**
 * THE ONE GATE KIND READER. The backend writes `kind` on every gate summary (list, fleet and detail responses): ownerless unlabelled gates are `approval`, GitHub-deployment gates (an Environment owns them) are `promotion`. A payload from an older
 * backend carries none: that is `'unknown'`, never a guess from the gate's name. A leaf module (no imports).
 */
export type GateKind = 'approval' | 'schedule' | 'dependency' | 'promotion' | 'unknown';
const KINDS: ReadonlySet<string> = new Set<GateKind>(['approval', 'schedule', 'dependency', 'promotion', 'unknown']);
export function gateKindOf(gate: { kind?: string | null } | null | undefined): GateKind {
	const k = gate?.kind;
	return k && KINDS.has(k) ? (k as GateKind) : 'unknown';
}
