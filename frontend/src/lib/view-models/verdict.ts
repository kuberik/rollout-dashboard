/**
 * The verdict — ONE plain-English sentence, at the top of the app page,
 * that says what an operator should do about this app right now.
 *
 * It replaces the propagation paragraph ("Newest build 9f10e49 is live in
 * 2 of 3 environments. Not yet caught up: prod (blocked).") which stated
 * four facts and led with none of them. A verdict is a ranking, not a
 * summary: exactly one environment is the worst, and only that one gets a
 * sentence. Everything else is already visible one object below, in the
 * ledger, at the volume it deserves.
 *
 * PRECEDENCE — strictly ordered, first match wins:
 *   1. Failed              — something broke; nothing else matters.
 *   2. diverged            — off the release line; promotion cannot reach it.
 *   3. stuck / blocked     — promotion is wedged and needs a person.
 *   4. Deploying / baking  — it IS moving; say so and stop.
 *   5. all on newest       — the good case, stated positively.
 *   6. merely behind       — normal drift, lowest volume.
 *
 * DIVERGED OUTRANKS STUCK, and it has to. A stuck environment is on the
 * line and will move when someone unblocks it; a diverged one is running
 * something the line does not contain, so every number the rest of the
 * page prints about it — `−19`, `4 waiting` — describes a promotion that
 * would not arrive at where it already is. Saying "prod is 19 builds
 * behind" about a build that is not on the ladder's line is the same
 * fabrication class as naming a gate that does not exist.
 *
 * NEVER TWO SENTENCES. A verdict that hedges is not a verdict.
 *
 * NEVER A FABRICATED NUMBER. `behind === null` means "genuinely
 * unknowable" (the env's current build aged out of its own retention
 * window, so the controller cannot say how far back it is) — those
 * sentences drop the count rather than guess at one. This is the same
 * rule `newerReleaseCount` enforces upstream, honoured rather than
 * papered over.
 *
 * NEVER A FABRICATED CAUSE (added 2026-08-23). This is the same rule one
 * level up, and it is the rule that got broken. `blockReason` used to end
 * `return 'a gate'` — a fallback reached precisely when BOTH gate lists
 * are empty, i.e. when there is no gate to point at. On an app that
 * defines no gates at all the page read *"prod is 19 builds behind,
 * waiting on a gate."* There was no gate. The most prominent sentence on
 * the page asserted a specific mechanism with zero evidence for it, which
 * is the same defect as the earlier round where three gates were named as
 * blocking and two of them were passing.
 *
 * The diagnostic, for the record, because the wording was NOT the bug:
 * `promotionBlock` was right. With no gates, `gates.every(...)` is
 * vacuously true, every candidate is deployable, and `blocked` is FALSE.
 * The wedged branch was entered on `stuck`, not on `blocked` — prod's bake
 * had been `InProgress` for 76 hours and `detectStuck` returned
 * `{kind:'baking'}`. The cause was known, evidenced, and already printed
 * verbatim one object below in the ledger's state cell ("Baking too
 * long"); `VerdictEnv` simply did not carry it, so the sentence reached
 * for a gate. So the fix is to CARRY THE CAUSE, and to make the
 * no-evidence path say something observable instead of inventing a
 * mechanism. Silence about a cause beats a confident wrong cause.
 */

import { formatDurationMs as span } from '$lib/utils';
import { BAKE_WORD } from '$lib/bake-status';

/** The discriminant of whatever stuck detector fired, verbatim. */
export type VerdictStuckKind = 'baking' | 'deploying' | 'behind' | 'promotion';

export type VerdictEnv = {
	/** Display label, e.g. `prod`. Printed verbatim. */
	label: string;
	/** The rollout's latest `bakeStatus`. */
	status: string;
	/** Builds behind. `null` = genuinely unknowable — never print a number. */
	behind: number | null;
	/** Promotion is blocked: candidates exist and every gate refuses them. */
	blocked: boolean;
	/** Promotion has been wedged long enough to count as stuck. */
	stuck: boolean;
	/** Gates that published an allow-list and said no — needs a PERSON. */
	awaitingApprovalGates: readonly string[];
	/** Gates that are simply not passing — time/condition-bounded, self-clearing. */
	notPassingGates: readonly string[];
	/**
	 * Which stuck detector fired, or null when `stuck` is false OR the
	 * caller cannot say. Never guess one: null routes to the
	 * observable-only wording, which is the correct output for "we do not
	 * know why".
	 */
	stuckKind: VerdictStuckKind | null;
	/** How long that state has been observable, in ms. null = unknown. */
	stuckForMs: number | null;
	/** Currently deployed build, e.g. `9f10e49`. */
	version: string | null;
	/**
	 * Running a build that is on no environment's release line, deployed
	 * inside the window that line still covers. Optional so existing
	 * callers and fixtures keep compiling; absent means "not claimed".
	 */
	diverged?: boolean;
};

/**
 * What is actually holding this environment up, in words an operator can
 * act on — or **null when no gate is evidence for anything**.
 *
 * The split is STRUCTURAL, never name-based: a gate carrying an
 * allow-list has an opinion and the answer is no, so only a person
 * changes it. A gate with no allow-list that simply is not passing has a
 * clock — a schedule window, a health check — and clears on its own.
 * Calling a deploy window "a manual approval" sends someone to go find a
 * human who has nothing to approve.
 *
 * There is deliberately NO third branch. Both lists empty means no gate
 * refused anything, and the only honest return is `null`. A caller that
 * wants a sentence out of that must get it from somewhere with evidence
 * behind it — see `stuckPhrase`.
 */
export function blockReason(env: {
	awaitingApprovalGates: readonly string[];
	notPassingGates: readonly string[];
}): string | null {
	if (env.awaitingApprovalGates.length > 0) return 'a manual approval';
	if (env.notPassingGates.length > 0) return 'a deploy window';
	return null;
}

function builds(n: number): string {
	return n === 1 ? 'build' : 'builds';
}

/**
 * The cause clause, in two grammatical shapes, and NEVER a mechanism the
 * env cannot evidence.
 *
 * `tail` follows a lag clause ("prod is 19 builds behind, <tail>."),
 * `solo` follows the bare label ("prod <solo>.") — because the lag clause
 * disappears whenever the count is 0 or unknowable, and a participle with
 * nothing in front of it is not a sentence.
 *
 * The root words are the ledger's `adverseState` words on purpose —
 * checking/deploying/not moving, from `bake-status.ts`'s ONE table — because
 * the verdict line and the row
 * 200px below it describe the same environment, and two objects naming
 * one cause with two different nouns is its own defect.
 */
function stuckPhrase(env: VerdictEnv): { tail: string; solo: string } {
	const reason = blockReason(env);
	if (reason) return { tail: `waiting on ${reason}`, solo: `is waiting on ${reason}` };

	// No gate said no. Everything below describes only what is OBSERVABLE.
	const forSpan = env.stuckForMs !== null ? ` for ${span(env.stuckForMs)}` : '';
	if (env.stuckKind === 'baking') {
		const w = BAKE_WORD.InProgress;
		return { tail: `${w}${forSpan}`, solo: `has been ${w}${forSpan}` };
	}
	if (env.stuckKind === 'deploying') {
		const w = BAKE_WORD.Deploying;
		return { tail: `${w}${forSpan}`, solo: `has been ${w}${forSpan}` };
	}
	// 'behind', 'promotion', and the genuinely-unknown case all collapse
	// here. They differ in which detector noticed, not in anything an
	// operator can act on, and the ledger row carries the detail. What we
	// can say is that it has not moved, and — when we have it — how long.
	if (env.stuckForMs !== null) {
		const inSpan = `has not moved in ${span(env.stuckForMs)}`;
		return { tail: `and ${inSpan}`, solo: inSpan };
	}
	return { tail: 'and is not moving', solo: 'is not moving' };
}

/** Rank for "which env is worst". Unknown lag sorts above in-sync but
 *  below any known lag, so a real number always wins the sentence. */
function lagScore(env: VerdictEnv): number {
	return env.behind === null ? 0.5 : env.behind;
}

function worst(envs: readonly VerdictEnv[]): VerdictEnv | null {
	let out: VerdictEnv | null = null;
	for (const e of envs) {
		if (!out || lagScore(e) > lagScore(out)) out = e;
	}
	return out;
}

export function verdictSentence(envs: readonly VerdictEnv[]): string | null {
	if (envs.length === 0) return null;

	// 1 — Failed.
	const failed = envs.find((e) => e.status === 'Failed');
	if (failed) return `${failed.label}'s last deploy failed.`;

	// 2 — diverged. Deliberately says NOTHING about lag: the count would be
	// a ladder position, and a ladder position is not a promotion distance
	// for a build that is not on the line. The sentence states only what was
	// measured, and names the build so the ledger row is findable.
	const diverged = envs.filter((e) => e.diverged);
	if (diverged.length === 1) {
		const d = diverged[0];
		return d.version
			? `${d.label} is on ${d.version}, which is not on the release line.`
			: `${d.label} is running a build that is not on the release line.`;
	}
	if (diverged.length > 1) {
		const names = diverged.map((e) => e.label).join(', ');
		return `${diverged.length} environments (${names}) are off the release line.`;
	}

	// 3 — wedged. Pick the single worst by lag; a blocked env with a real
	// number outranks one whose lag we cannot compute.
	const adverse = envs.filter((e) => e.stuck || e.blocked);
	const wedged = worst(adverse);
	if (wedged) {
		const { tail, solo } = stuckPhrase(wedged);
		if (wedged.behind === null) return `${wedged.label} is behind, ${tail}.`;
		if (wedged.behind <= 0) return `${wedged.label} ${solo}.`;
		return `${wedged.label} is ${wedged.behind} ${builds(wedged.behind)} behind, ${tail}.`;
	}

	// 4 — in flight. Deploying outranks baking: it is the state that is
	// actually changing what is running.
	const deploying = envs.find((e) => e.status === 'Deploying');
	if (deploying) return `${deploying.label} is deploying.`;
	const baking = envs.find((e) => e.status === 'InProgress');
	if (baking) return `${baking.label} is ${BAKE_WORD.InProgress}.`;

	// 5 — converged.
	if (envs.every((e) => e.behind === 0)) {
		const versions = new Set(envs.map((e) => e.version ?? ''));
		const sha = versions.size === 1 ? [...versions][0] : '';
		if (envs.length === 1) {
			return sha ? `${envs[0].label} is on ${sha}.` : `${envs[0].label} is on the newest build.`;
		}
		return sha
			? `All ${envs.length} environments are on ${sha}.`
			: `All ${envs.length} environments are on the newest build.`;
	}

	// 6 — merely behind.
	const behindEnvs = envs.filter((e) => e.behind === null || e.behind > 0);
	const laggard = worst(behindEnvs);
	if (!laggard) return null;
	if (laggard.behind === null) return `${laggard.label} is behind.`;
	return `${laggard.label} is ${laggard.behind} ${builds(laggard.behind)} behind.`;
}
