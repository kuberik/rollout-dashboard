/**
 * ONE GRAMMAR FOR "WAITING FOR <place> TO <do> <build>" (batch4 #76, UX71 1).
 * The app page's placeWait and the Gates tab's upstream card both print what
 * the place a build waits on is doing: not started yet = "to deploy", being
 * checked = "to finish checking", rolling out = "to finish deploying". Typed
 * in, string out; no sentence is parsed anywhere.
 */
export function waitVerb(states: readonly (string | undefined)[]): 'finish checking' | 'finish deploying' | 'deploy' {
	return states.some((s) => s === 'checking') ? 'finish checking' : states.some((s) => s === 'deploying') ? 'finish deploying' : 'deploy';
}
/** "to finish checking 775f46a" */
export function waitFact(states: readonly (string | undefined)[], build: string): string {
	return `to ${waitVerb(states)} ${build}`;
}
/** "Waiting for dev to finish checking 775f46a" */
export function stageWaitText(stage: string, states: readonly (string | undefined)[], build: string): string {
	return `Waiting for ${stage} ${waitFact(states, build)}`;
}

/**
 * The Gates tab's upstream card for the stage the focus waits on (UX71 1): what
 * that stage is doing about the held build. `null` when the focus waits on no
 * stage, or when the stage is itself held (its own "held on <cause>" clause
 * says so) and there is no build to name; a wave/site wait keeps its own text.
 */
export function chainWaitOf(
	fact: { stage: string; wave?: string; heldCause?: string } | null,
	peerState: string | undefined,
	build: string | null | undefined
): { stage: string; text: string } | null {
	if (!fact) return null;
	if (fact.wave) return { stage: fact.stage, text: fact.wave };
	if (fact.heldCause || !build) return null;
	return { stage: fact.stage, text: stageWaitText(fact.stage, [peerState], build) };
}
