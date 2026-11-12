/**
 * Pure rules behind the "steady pipeline card" fix (owner 2026-11-12: on a canary the Deployment
 * pipeline card kept growing and shrinking at every step, and the Newer builds card rode along under it).
 * Kept out of the components so each rule is pinned by a test.
 */

/** A deploy is in flight while the newest history entry has no outcome yet. */
export function isDeployInFlight(
	history: readonly { bakeStatus?: string | null }[] | null | undefined
): boolean {
	const s = history?.[0]?.bakeStatus ?? '';
	return s === 'Deploying' || s === 'InProgress';
}

/**
 * Newer builds card visibility. Hidden ONLY when a deploy is in flight and the card would have nothing to
 * say: no newer build waiting, no pin warning, no "holding N rollouts" banner, and the release list is known.
 * A newer build that is waiting always shows, and so does anything that needs the operator (Clear pin).
 */
export function showNewerBuildsCard(s: {
	deployInFlight: boolean;
	newerCount: number;
	pinned?: boolean;
	held?: boolean;
	releasesLoading?: boolean;
}): boolean {
	if (!s.deployInFlight) return true;
	return s.newerCount > 0 || !!s.pinned || !!s.held || !!s.releasesLoading;
}

/**
 * Steady height: within one deploy (same key) the card's minimum height only ratchets up; a new key
 * starts over. Returns the next state; `minHeight` is what to apply to the element.
 */
export type SteadyState = { key: string; max: number };
export function steadyStep(prev: SteadyState, key: string, measured: number): SteadyState {
	if (key !== prev.key) return { key, max: measured };
	return measured > prev.max ? { key, max: measured } : prev;
}

/**
 * Key of one deploy of one rollout: rollout identity, the newest history entry's id and build, and whether
 * it is still in flight. The card holds its height only while the key is unchanged, so it lets go when the
 * deploy settles (its in-flight flag flips) and never carries a height to another rollout.
 */
export function deployKey(
	entry:
		| { id?: string | number | null; version?: { tag?: string | null } | null; bakeStatus?: string | null }
		| null
		| undefined,
	rolloutId = ''
): string {
	return `${rolloutId}:${entry?.id ?? ''}:${entry?.version?.tag ?? ''}:${isDeployInFlight(entry ? [entry] : []) ? 'live' : 'done'}`;
}

/**
 * App page: which place's step pane opens by itself. When several places are moving at once (a wave) the
 * ledger rows are the picture, so nothing opens; a single place in flight (or none) opens the first row.
 */
export function leadOpenKey(rows: readonly { key: string; group: string }[]): string | null {
	if (rows.filter((r) => r.group === 'moving').length > 1) return null;
	return rows[0]?.key ?? null;
}

/**
 * Rows keep their slot (owner 2026-11-12; landing film AD P1-2). Inside the stage detail pane three things
 * come and go as a canary steps: the "Continue to stage N" action, the Check row's progress line, and the
 * final check timer's progress line. While a deploy is in flight each of them has its place from the first
 * frame, drawn invisible until it has something to say, so a state change alters marks and words and no
 * row below it moves. Once the deploy settles nothing is reserved and the pane is as short as its content.
 * A slot is only reserved when the thing can actually appear: the action for a reader who may press it,
 * the Check line for a stage with a check window configured, the timer line for a rollout with a bake time.
 * A stage that is already past can no longer change, and the last stage completes without pausing, so
 * neither reserves the action; a past stage reserves no Check line either (QA review of #136).
 */
export type PipelineSlots = { advance: boolean; checkLine: boolean; timerLine: boolean };
export function pipelineSlots(s: {
	deployInFlight: boolean;
	canUpdate: boolean;
	stageCheckConfigured: boolean;
	timerConfigured: boolean;
	/** The stage is current or still ahead (not past). Default true. */
	stageOpen?: boolean;
	/** The stage is the last step of its track. Default false. */
	lastStep?: boolean;
}): PipelineSlots {
	const open = s.stageOpen ?? true;
	return {
		advance: s.deployInFlight && s.canUpdate && open && !s.lastStep,
		checkLine: s.deployInFlight && s.stageCheckConfigured && open,
		timerLine: s.deployInFlight && s.timerConfigured
	};
}
