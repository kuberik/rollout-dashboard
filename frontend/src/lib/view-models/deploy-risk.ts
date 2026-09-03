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
 * | **retry** | prod   | **no**                         | `typed`  |
 * | **retry** | prod   | yes                            | `notice` |
 * | **retry** | other  | no                             | `notice` |
 * | **retry** | other  | yes                            | `none`   |
 * | custom tag (not in `availableReleases`) — any direction | `typed` |
 * | same version                                            | `none`  |
 *
 * ── ⛔ WHY `retry` IS A DIRECTION AND NOT A SPECIAL CASE (2026-08-31) ─────
 *
 * The `Retry` button in the red failure banner was **one click, unconfirmed,
 * straight into production**, at the same moment that deploying that identical
 * build by hand demanded a typed sha. Two routes to one act, and the dangerous
 * one was the cheap one.
 *
 * The fix is NOT a typed confirm bolted onto every retry — friction that fires
 * on every action stops being read, and re-running a transient failure in dev
 * should stay one click. It is to let THIS TABLE decide, which it could not do
 * before: a retry redeploys the version that is already running, so
 * `deployDirection` returns `same` and `confirmLevel` short-circuits to `none`.
 * That short-circuit is right for `Change Version` (re-picking the running
 * build is a no-op) and wrong for `Retry` (it is a fresh deployment attempt).
 *
 * So `retry` is its own direction, it skips the `same` short-circuit, and it
 * then falls through to the SAME two lines `forward` uses. No new rule, no
 * second opinion about what production means. The four rows above are not
 * written anywhere in `confirmLevel`; they are what `forward`'s rows already
 * say. `deployDirection` never returns `retry` — only `retryIntent` sets it.
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

export type DeployDirection = 'forward' | 'rollback' | 'same' | 'retry';

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

/**
 * THE BUILD A RETRY WOULD SEND. `Retry` never picks a version: it re-runs the
 * deployment at the head of history, which is the build that just failed.
 */
export function retryTag(rollout: Rollout | null | undefined): string | null {
	return rollout?.status?.history?.[0]?.version?.tag ?? null;
}

/**
 * ⭐ A RETRY, EXPRESSED IN THE INPUTS THE RULE ALREADY WEIGHS. Nothing new is
 * measured here — the direction is `retry`, the target and the vouching test
 * are `deployIntent`'s own, evaluated against the build at the head of history.
 *
 * `vouched` is deliberately `gatesAllow` and nothing else. The health check
 * that just failed is a CONSEQUENCE the confirmation has to state (see
 * `retryConsequences`), not a fourth input to the level — folding it in would
 * make every retry in every environment `notice`, and "one click in dev" is a
 * requirement, not an oversight.
 */
export function retryIntent(
	rollout: Rollout | null | undefined,
	environmentName?: string | null
): DeployIntent {
	const environment = rolloutEnvironmentName(rollout, environmentName);
	return {
		direction: 'retry',
		production: isProductionTarget(environment),
		vouched: gatesAllow(rollout, retryTag(rollout)),
		// A retry cannot be a custom tag: it re-sends what is already deployed.
		custom: false,
		environment
	};
}

/**
 * ⛔ SUPERSEDED, 2026-09-03 (B3, operator walk): **PRODUCTION IS `typed` IN
 * EITHER DIRECTION NOW**, including a rollback.
 *
 * The table and the reasoning above this function are the PREVIOUS ruling —
 * kept rather than deleted, because the argument it made ("a rollback is the
 * recovery you want fast at 3am") is still true in general and still governs
 * every NON-production rollback (`intent.production` false still falls
 * through to `notice`, unchanged — dev keeps its softer path). What changed
 * is narrower than it looks: a live walk rolled back
 * `hello-world-prod/hello-world-app` and found it was TWO TAPS — no typed
 * confirmation at all, a filled BLUE primary reading `Roll back production`
 * (blue is this product's colour for "a controller-speed forward move", not
 * a destructive one), a `Pin Version` toggle rendered `disabled checked`
 * (a locked-on switch drawn with a light, off-looking track — the same
 * "disabled reads as off" defect this pass also fixes on the toggle itself),
 * and no stated DISTANCE (the picker said `15 back`; the dialog never
 * repeated it). The forward force-deploy dialog on the identical rollout
 * demanded the typed sha and a red button for the identical class of change
 * — production, unattended by the controller — while going backwards did
 * not. **A rollback into production is still the fast, correct recovery;
 * "fast" cannot mean "with less ceremony than the forward move it is
 * undoing," on the one tier where a mistake is most expensive.**
 *
 * `intent.vouched` no longer spares a production FORWARD deploy either: the
 * old table read `notice` for "every rule currently allows this build,
 * which is the move the controller would make on its own" — true, but the
 * controller has not actually made it, and this function's OWN job is
 * deciding how much ceremony a PERSON'S press deserves on this tier, not
 * whether the controller agrees with them.
 *
 * The rule, restated: PRODUCTION IS `typed`, full stop, except a genuine
 * no-op (`same`) and an unlisted tag (already `typed` via `custom`, which
 * fires first and is unchanged). Every non-production row is untouched.
 */
export function confirmLevel(intent: DeployIntent): ConfirmLevel {
	// ⛔ `retry` DELIBERATELY DOES NOT REACH THIS LINE. A retry sends the
	// version that is already running, so a `same`-style short-circuit would
	// wave through the exact act this module exists to slow down.
	if (intent.direction === 'same') return 'none';
	if (intent.custom) return 'typed';
	if (intent.production) return 'typed';
	if (intent.direction === 'rollback') return 'notice';
	return intent.vouched ? 'none' : 'notice';
}

/** What a retry destroys and what it does not, as facts the caller measured. */
export type RetryFacts = {
	/** Health checks reporting failure right now, by display name. */
	failingChecks: string[];
	/**
	 * True when pressing Retry will reset a health check's status.
	 *
	 * ⛔ VERIFIED IN THE CONTROLLER, NOT ASSUMED.
	 * `healthcheck_controller.go` takes the reset cutoff as *"the later of the
	 * deployment time and the last retry timestamp"* with the comment **"A retry
	 * should force a reset even though no new deployment occurred"**, and
	 * `ResetHealthCheckStatus` then sets `Status = Pending`, `Message = "Health
	 * check reset due to new deployment"` and **`LastErrorTime = nil`**. The
	 * message naming what failed is overwritten and the error timestamp is
	 * deleted. An operator who is about to lose that evidence is owed the
	 * sentence before the click, not after it.
	 */
	clearsFailureDetail: boolean;
};

/**
 * THE CONSEQUENCES, ONE PER SENTENCE, IN THE ORDER A READER NEEDS THEM: where
 * it lands, what the rules think of it, what is still broken, and what pressing
 * it destroys. Returned as a list because a retry into production has four
 * facts and `message: string` can only print those as a run-on line.
 *
 * Returns `[]` when `confirmLevel` is `none` — a dialog that explains a
 * one-click retry in dev teaches the reader to stop reading dialogs.
 */
export function retryConsequences(intent: DeployIntent, facts: RetryFacts, tag?: string | null): string[] {
	if (confirmLevel(intent) === 'none') return [];
	const where = targetPhrase(intent);
	const out: string[] = [];

	out.push(
		tag
			? `Redeploys ${tag} to ${where} — the same build whose last deploy here failed.`
			: `Redeploys the current build to ${where} — the same build whose last deploy here failed.`
	);

	out.push(
		intent.vouched
			? `Every rule here allows this build, so this is the attempt the controller would make on its own.`
			: `No rule here currently allows this build. It applies immediately and ${where} starts serving it.`
	);

	if (facts.failingChecks.length === 1) {
		out.push(`${facts.failingChecks[0]} is still failing right now. Nothing has re-checked this build since.`);
	} else if (facts.failingChecks.length > 1) {
		out.push(
			`${facts.failingChecks.length} health checks are still failing right now — ${facts.failingChecks.slice(0, 3).join(', ')}${facts.failingChecks.length > 3 ? ', …' : ''}. Nothing has re-checked this build since.`
		);
	}

	if (facts.clearsFailureDetail) {
		// ⛔ THREE WORDINGS, BECAUSE THE THIRD CASE IS REAL AND IS THE WORST ONE.
		// A check that FAILED and has since RECOVERED still carries
		// `lastErrorTime` — the witness this system deliberately keeps — and the
		// reset deletes it (`ResetHealthCheckStatus` sets it to nil). Losing the
		// only record that anything ever went wrong is not the same sentence as
		// losing a message that is still on screen, so it does not get it.
		out.push(
			facts.failingChecks.length === 0
				? 'Retrying resets this rollout’s health checks to “Pending — reset due to new deployment”, which erases the record that anything failed here.'
				: facts.failingChecks.length > 1
					? 'Retrying resets those checks to “Pending — reset due to new deployment”, which clears the failure detail shown above.'
					: 'Retrying resets that check to “Pending — reset due to new deployment”, which clears the failure detail shown above.'
		);
	}

	return out;
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
export function confirmNotice(
	intent: DeployIntent,
	pins = false,
	/**
	 * ⭐ THE DISTANCE, STATED. (B3, 2026-09-03, operator walk) The version
	 * PICKER already says `15 back` on the row a reader clicked; the dialog
	 * one screen later dropped the number entirely and said only "goes back
	 * to a version". `releaseIndex`'s own oldest-first list is what the
	 * caller already counts this from (`env-rank.ts`'s own `N behind`
	 * vocabulary) — passed in rather than recomputed here, because this
	 * module takes no `Rollout` and has no release list of its own to count
	 * against. `null`/`undefined`/`0` all print the sentence without a
	 * count: a rollback whose distance could not be resolved, or a
	 * same-build edge case, states the fact it can prove and no more.
	 */
	stepsBack?: number | null
): string | null {
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
		const distance = stepsBack && stepsBack > 0 ? ` ${stepsBack} build${stepsBack === 1 ? '' : 's'}` : '';
		return `Goes back${distance} to a version ${where} has already run. It applies immediately; older code will run against data the newer version has already written.${pinNote}`;
	}
	if (intent.production) {
		return intent.vouched
			? `This changes ${where}. Every rule currently allows this build, so this is the move the controller would make on its own — it just has not made it yet.${pinNote}`
			: `This ships to ${where} a build that no rule currently allows. It applies immediately and ${where} starts serving it; nothing checks it first.${pinNote}`;
	}
	// ⛔ THIS SENTENCE USED TO END `Production is not touched.` AND THAT WAS
	// FALSE — in exactly the case it was printed. (2026-08-31)
	//
	// The environment controller writes the DOWNSTREAM environment's promotion
	// gate allow-list from the UPSTREAM environment's own history:
	// `githubenvironment_controller.go:updateAllowedVersionsFromRelationships`
	// collects every entry in the related environment's history whose
	// `BakeStatus == Succeeded` and sets `RolloutGate.Spec.AllowedVersions` to
	// exactly those tags. So force-deploying an unvouched build into staging
	// and letting it bake puts that build on production's allow-list, and if
	// production's remaining gates pass the controller promotes it there ON ITS
	// OWN. The reassurance was strongest precisely where the risk was.
	//
	// ⚠️ AND IT MAY NOT BE REPLACED BY THE OPPOSITE CLAIM. `DeployIntent` does
	// not know whether any environment declares `relationship: After` this one,
	// so "this will reach production" would be the same defect with the sign
	// flipped. `can become allowed` is modal and true either way: it states the
	// mechanism that exists without asserting a consequence we cannot see.
	return `This overrides the rules holding ${where}, which do not currently allow this build. It applies immediately. It does not deploy to production — but a build that deploys and passes its checks here can become allowed in whatever environment promotes after ${where}.${pinNote}`;
}

/**
 * ⭐ THE CONSEQUENCE IS BOLD; EVERYTHING AFTER IT IS NOT. (F10, design pass 2
 * re-check) `confirmNotice` composes several sentences — the consequence
 * itself, then how it applies, then (optionally) the pin note — and the
 * dialog printed all of them, plus the `gateWhy` sentence beside them, at one
 * flat weight: four facts (an icon, the prose, a `FactList` label and its
 * value) at equal loudness in the same red reads as nothing being louder than
 * anything else. This splits at the first sentence boundary so the template
 * can bold only the lead sentence — the one that names the actual
 * consequence — and print the rest at rest weight.
 */
export function splitLeadSentence(text: string): { lead: string; rest: string } {
	const match = text.match(/^([^.!?]*[.!?])\s*([\s\S]*)$/);
	if (!match) return { lead: text, rest: '' };
	return { lead: match[1], rest: match[2] };
}

/** The label above the type-to-confirm box, when there is one. */
export function typedPrompt(intent: DeployIntent): string {
	// ⭐ EVERY CHANGE IS TYPED. (2026-09-03, from the human: "any time we change
	// the version we must ask for confirmation.") `confirmLevel` still grades
	// the alert — none / notice / typed decide its colour and sentence — but
	// the typed field itself no longer waits for `typed`; the caller shows it
	// for every direction but `same`. Below `typed` the prompt claims nothing
	// about vouching or tiers, because nothing adverse is being asserted.
	if (confirmLevel(intent) !== 'typed') return 'Type';
	if (intent.custom) return 'This version is not in the release list. Type';
	// ⭐ A ROLLBACK IS A DIFFERENT CLAIM. (B3, 2026-09-03) `production` now
	// reaches `typed` on a rollback too (see `confirmLevel`'s own note), and
	// "nothing has vouched for this build" is false of it: the build already
	// ran here successfully, which is the whole reason it is a safe place to
	// go back to. The prompt names the actual reason typing is required —
	// the TIER, not a claim about vouching that only ever applied to a
	// forward move.
	if (intent.direction === 'rollback') {
		return `This changes ${targetPhrase(intent)}. Type`;
	}
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
	// THE RETRY BUTTON SAYS WHERE IT LANDS TOO. `Retry` named the act and hid
	// the target, which is how a production redeploy read as a page refresh.
	if (intent.direction === 'retry') return where ? `Redeploy to ${where}` : 'Redeploy';
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
