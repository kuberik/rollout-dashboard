/**
 * ⛔ THE FRICTION WAS ON THE WRONG DIRECTION, AND THAT IS A SAFETY DEFECT.
 * (2026-08-31)
 *
 * A live UX critique force-deployed an **unvetted build into production,
 * through three closed gates, in two clicks with no confirmation**, and the
 * modal never once used the word *production*. Going BACKWARDS, meanwhile,
 * demanded `Type 991829b to confirm` with the primary disabled until it
 * matched.
 *
 * The typed gate is the right mechanism; it was pointed at the wrong event.
 * **A rollback is the recovery you want fast at 3am.** A forward deploy of a
 * build that nothing on screen has vouched for, into production, is the one
 * that deserves the pause.
 *
 * ── THE RULE, AND WHY IT IS THREE INPUTS AND NOT ONE ─────────────────────
 *
 * | direction | target | do the gates allow this build? | level    |
 * |-----------|--------|--------------------------------|----------|
 * | forward   | prod   | **no**                         | `typed`  |
 * | forward   | prod   | yes                            | `notice` |
 * | forward   | other  | no                             | `notice` |
 * | forward   | other  | yes                            | `none`   |
 * | rollback  | any    | —                              | `notice` |
 * | custom tag (not in `availableReleases`) — any direction | `typed` |
 * | same version                                            | `none`  |
 *
 * ⛔ **`notice` IS NOT A BARRIER.** It is one sentence naming the
 * consequence, in the footer where the decision is made. Nothing to type,
 * nothing to tick. The critic's other warning was explicit: *"friction that
 * fires on every action stops being read"* — so the only thing that ever
 * stops the primary button is `typed`, and `typed` fires on exactly two
 * shapes: a build no rule vouches for going into production, and a tag that
 * is not in the release list at all.
 *
 * ⛔ **A ROLLBACK NEVER REACHES `typed`.** Not even in production. It is a
 * return to a build this environment has already run, it is the fastest
 * route out of a bad deploy, and the transcription exercise was measurably
 * making the recovery the slowest action in the product. It gets a `notice`
 * because it does have a consequence a reader may not predict (it pins), and
 * a sentence is the right size for that.
 *
 * ── WHY "the gates allow it" IS THE VOUCHING TEST ────────────────────────
 *
 * `auto-deploy.ts` establishes that no gate holds back a deploy a PERSON
 * starts — that is true and it stays true. But it is exactly why the gate
 * state has to be re-read here: if the controller would have shipped this
 * build on its own, the operator pressing Deploy is doing the same move by
 * hand and has earned no extra ceremony. If every gate refuses it, the
 * operator is overriding every rule the cluster has, and in production that
 * is the moment worth spending a reader's attention on.
 *
 * Pure functions, no fetch, no component — so the modal, the button label
 * and the tests all read one answer.
 */

import type { Rollout } from '../../types';
import { getEnvironmentRank } from '$lib/env-order';
import {
	ENVIRONMENT_THEME_ANNOTATION,
	ENVIRONMENT_THEME_LABEL_ANNOTATION
} from '$lib/environment-theme';

export type DeployDirection = 'forward' | 'rollback' | 'same';

/**
 * `none` — ship it. `notice` — one sentence, no input. `typed` — the sha, and
 * the primary stays disabled until it matches.
 */
export type ConfirmLevel = 'none' | 'notice' | 'typed';

export type DeployIntent = {
	direction: DeployDirection;
	/** The target environment is production tier (`env-order` rank ≥ 7). */
	production: boolean;
	/** Every gate is passing AND every gate's allow-list contains this build. */
	vouched: boolean;
	/** The tag is not in this rollout's own `availableReleases` at all. */
	custom: boolean;
	/** The environment's own name, as the cluster spells it (`prod`, `staging`). */
	environment: string;
};

/**
 * THE ENVIRONMENT NAME, FROM WHATEVER THE CALLER ACTUALLY HAS.
 *
 * Rollout detail holds the `Environment` object and passes `spec.environment`.
 * Every other call site — `/apps/<name>`, `/versions/<rev>`, `FailurePanel` —
 * holds only the rollout, so this reads the label the fixtures and the live
 * cluster both set, then the theme annotations, then the namespace.
 *
 * ⚠️ THE NAMESPACE FALLBACK IS DELIBERATELY LOOSE, AND IT IS SAFE BECAUSE IT
 * IS ONE-DIRECTIONAL. `hello-world-prod` classifies as production. A false
 * positive costs a sentence and possibly a typed sha; a false negative costs
 * an unvetted production deploy with no pause. Only one of those is a defect
 * worth having.
 */
export function rolloutEnvironmentName(
	rollout: Rollout | null | undefined,
	explicit?: string | null
): string {
	if (explicit) return explicit;
	const meta = rollout?.metadata;
	return (
		meta?.labels?.environment ||
		meta?.annotations?.[ENVIRONMENT_THEME_LABEL_ANNOTATION]?.trim() ||
		meta?.annotations?.[ENVIRONMENT_THEME_ANNOTATION]?.trim() ||
		meta?.namespace ||
		''
	);
}

/** Production tier is `env-order`'s own definition, not a second one. */
export function isProductionTarget(environmentName: string): boolean {
	if (!environmentName) return false;
	return getEnvironmentRank(environmentName) >= 7;
}

/**
 * Would the controller ship this build right now if nobody pressed anything?
 *
 * `status.gates` is the controller's own evaluation. A gate that is not
 * passing refuses everything; a passing gate refuses anything outside its
 * `allowedVersions`, and a passing gate with an EMPTY allow-list (the
 * zero-allowlist approval gate the critic force-deployed through) refuses
 * everything too.
 */
export function gatesAllow(rollout: Rollout | null | undefined, tag: string | null): boolean {
	if (!tag) return false;
	const gates = rollout?.status?.gates ?? [];
	if (gates.length === 0) return true;
	return gates.every(
		(g) => g.passing !== false && Array.isArray(g.allowedVersions) && g.allowedVersions.includes(tag)
	);
}

/** Oldest-first index of a tag in this rollout's own release list. `-1` if absent. */
export function releaseIndex(rollout: Rollout | null | undefined, tag: string | null): number {
	if (!tag) return -1;
	return (rollout?.status?.availableReleases ?? []).findIndex((r) => r.tag === tag);
}

/**
 * Forward, backward, or nowhere — measured against the rollout's OWN release
 * list, which is the same list `Change Version` shows and the same one
 * `env-rank.ts` counts `N behind` from.
 */
export function deployDirection(
	rollout: Rollout | null | undefined,
	tag: string | null
): DeployDirection {
	const currentTag = rollout?.status?.history?.[0]?.version?.tag ?? null;
	if (!tag) return 'same';
	if (tag === currentTag) return 'same';
	const currentIdx = releaseIndex(rollout, currentTag);
	const selectedIdx = releaseIndex(rollout, tag);
	if (currentIdx === -1 || selectedIdx === -1) return 'forward';
	return selectedIdx < currentIdx ? 'rollback' : 'forward';
}

export function deployIntent(
	rollout: Rollout | null | undefined,
	tag: string | null,
	environmentName?: string | null
): DeployIntent {
	const environment = rolloutEnvironmentName(rollout, environmentName);
	const releases = rollout?.status?.availableReleases ?? [];
	return {
		direction: deployDirection(rollout, tag),
		production: isProductionTarget(environment),
		vouched: gatesAllow(rollout, tag),
		custom: !!tag && releases.length > 0 && releaseIndex(rollout, tag) === -1,
		environment
	};
}

/** The rule. One table, one place, and it has tests. */
export function confirmLevel(intent: DeployIntent): ConfirmLevel {
	if (intent.direction === 'same') return 'none';
	if (intent.custom) return 'typed';
	if (intent.direction === 'rollback') return 'notice';
	if (intent.production) return intent.vouched ? 'notice' : 'typed';
	return intent.vouched ? 'none' : 'notice';
}

/** How the target is named in prose. `production` is a word the modal owed its reader. */
export function targetPhrase(intent: DeployIntent): string {
	if (intent.production) return 'production';
	return intent.environment || 'this environment';
}

/**
 * THE CONSEQUENCE, IN THE SHAPE THE CRITIC NAMED AS THE BEST COPY IN THE
 * PRODUCT: *"states the consequence, the non-consequence, and names the rule
 * in human terms."* That is `Clear Version Pin`'s structure, and this matches
 * it rather than replacing it.
 *
 * Returns `null` when the level is `none` — a modal that explains every deploy
 * teaches the reader to stop reading it.
 */
export function confirmNotice(intent: DeployIntent, pins = false): string | null {
	const level = confirmLevel(intent);
	if (level === 'none') return null;
	const where = targetPhrase(intent);
	const pinNote = pins
		? ` It also pins ${where} to this version, so nothing newer promotes until the pin is cleared.`
		: '';

	if (intent.custom) {
		return `This tag is not in ${where}'s release list, so no rule here has vouched for it and the commit list above may be incomplete. It applies immediately.${pinNote}`;
	}
	if (intent.direction === 'rollback') {
		return `Goes back to a version ${where} has already run. It applies immediately; older code will run against data the newer version has already written.${pinNote}`;
	}
	if (intent.production) {
		return intent.vouched
			? `This changes ${where}. Every rule currently allows this build, so this is the move the controller would make on its own — it just has not made it yet.${pinNote}`
			: `This ships to ${where} a build that no rule currently allows. It applies immediately and ${where} starts serving it; nothing checks it first.${pinNote}`;
	}
	return `This overrides the rules holding ${where}, which do not currently allow this build. It applies immediately. Production is not touched.${pinNote}`;
}

/** The label above the type-to-confirm box, when there is one. */
export function typedPrompt(intent: DeployIntent): string {
	if (intent.custom) return 'This version is not in the release list. Type';
	return `Nothing has vouched for this build in ${targetPhrase(intent)}. Type`;
}

/**
 * THE BUTTON SAYS WHERE IT LANDS. The critique's exact charge was that the
 * modal *"never says production"* — so the primary does, and so does the
 * notice above it.
 */
export function deployActionLabel(intent: DeployIntent): string {
	const where = intent.production
		? 'production'
		: intent.environment
			? intent.environment
			: null;
	if (intent.direction === 'rollback') return where ? `Roll back ${where}` : 'Roll back';
	return where ? `Deploy to ${where}` : 'Deploy Now';
}

/**
 * ⛔ `Rollback` PRE-SELECTED `history[1]`, WHICH IS NOT NECESSARILY OLDER.
 *
 * The critic pressed `Rollback` and got a modal headed **"Deploy 51b976a →
 * aa17645"** — a roll-FORWARD — under a checkbox captioned *"Pin Version —
 * Required for rollback"*. The direction logic downstream was right; the
 * button's pre-selection was wrong, so the two disagreed on one screen.
 *
 * A rollback target must be **older than what is running**, and this proves
 * it rather than assuming the history is monotonic:
 *
 * 1. the most recent version this rollout has ALREADY RUN that is provably
 *    older (by release-list position, else by build `created` time);
 * 2. failing that, the release directly below the running one in this
 *    rollout's own list — never deployed here, but unambiguously backwards;
 * 3. failing that, **null** — and the caller must not offer the button. A
 *    `Rollback` with nothing to roll back to is the label lying again.
 */
export type RollbackTarget = {
	tag: string;
	/** Display form (`getDisplayVersion`'s input shape). */
	version?: string;
	created?: string;
	/** `ran-here` when this environment has served it before. */
	basis: 'ran-here' | 'older-release';
};

function olderThan(
	rollout: Rollout | null | undefined,
	candidateTag: string,
	candidateCreated: string | undefined,
	currentTag: string,
	currentCreated: string | undefined
): boolean {
	const ci = releaseIndex(rollout, currentTag);
	const si = releaseIndex(rollout, candidateTag);
	if (ci !== -1 && si !== -1) return si < ci;
	if (candidateCreated && currentCreated) {
		const a = new Date(candidateCreated).getTime();
		const b = new Date(currentCreated).getTime();
		if (Number.isFinite(a) && Number.isFinite(b)) return a < b;
	}
	return false;
}

export function rollbackTarget(rollout: Rollout | null | undefined): RollbackTarget | null {
	const history = rollout?.status?.history ?? [];
	const current = history[0]?.version;
	const currentTag = current?.tag;
	if (!currentTag) return null;

	const seen = new Set<string>([currentTag]);
	for (let i = 1; i < history.length; i++) {
		const v = history[i]?.version;
		if (!v?.tag || seen.has(v.tag)) continue;
		seen.add(v.tag);
		if (olderThan(rollout, v.tag, v.created, currentTag, current?.created)) {
			return { tag: v.tag, version: v.version, created: v.created, basis: 'ran-here' };
		}
	}

	const releases = rollout?.status?.availableReleases ?? [];
	const currentIdx = releaseIndex(rollout, currentTag);
	if (currentIdx > 0) {
		const r = releases[currentIdx - 1];
		return { tag: r.tag, version: r.version, created: r.created, basis: 'older-release' };
	}
	return null;
}
