// Shared per-rollout card derivation used by both the Rollouts inventory
// list (RolloutGrid.svelte) and the Control Center overview (ControlCenter.svelte),
// so stuck/behind/failure classification logic lives in exactly one place.

import type { Rollout, Environment } from '../types';
import { getRolloutEnvironmentTheme, shortEnvLabel } from './environment-theme';
import { getDisplayVersion, categorizeFailure, compareRollouts, detectStuck } from './utils';
import type { StuckReason } from './utils';
import { compareEnvironmentNames } from './env-order';
import { newerReleaseCount } from './view-models/promotion';
import { rankVerdictsByRollout, rankBehindBy } from './view-models/env-rank';
import type { RankVerdict } from './view-models/env-rank';
import { checkFailure } from './view-models/health-witness';
import type { CheckFailure } from './view-models/health-witness';
import {
	sourceDashboardURL,
	sourceClusterName,
	rolloutMatchesEnvironment
} from './source-dashboard';

export type StatusKey = 'succeeded' | 'failed' | 'active' | 'pending';

/**
 * ⛔ GOING BACKWARDS IS A DIFFERENT EVENT FROM GOING FORWARDS, AND EVERY LIST
 * SURFACE DREW IT AS THE SAME EVENT.
 *
 * A live UX critique rolled production back to a one-hour-old build. `/`
 * rendered it *"exactly like a forward deploy"* — same circle, same chip, same
 * `updated 4m ago`. Nothing said the word. On the live hub right now,
 * `hello-world-prod/hello-world-app` is in exactly that state: history `id 3`
 * is `51b976a` at `availableReleases` index **0**, immediately after `id 2`
 * `aa17645` at index **7**.
 *
 * `availableReleases` is ordered oldest → newest by the controller, so the
 * comparison needs nothing but the rollout object: if the version now running
 * sits EARLIER in that list than the one it replaced, the rollout moved
 * backwards.
 *
 * ⚠️ IT RETURNS `null` RATHER THAN GUESSING. A version that is not in
 * `availableReleases` at all (a custom tag, or one that has aged out of the
 * list) has no position, so there is no ordering to compare and the honest
 * answer is silence. An absent record is not an observation.
 */
export type RollbackMark = {
	/** Display version the rollout came FROM. */
	from: string;
	/** Display version it went back TO. */
	to: string;
	/** How many releases backwards, in `availableReleases` positions. */
	by: number;
};

// The OCI tag identifies a release; `version` is the display form. Real
// cluster payloads carry both. Preferring `tag` and falling back to `version`
// keeps one comparison working against either shape.
function releaseKey(v: { tag?: string; version?: string } | undefined): string | null {
	return v?.tag || v?.version || null;
}

export function detectRollback(r: Rollout): RollbackMark | null {
	const history = r.status?.history ?? [];
	const releases = r.status?.availableReleases ?? [];
	if (history.length < 2 || releases.length === 0) return null;
	const nowKey = releaseKey(history[0]?.version);
	const prevKey = releaseKey(history[1]?.version);
	if (!nowKey || !prevKey || nowKey === prevKey) return null;
	const nowIdx = releases.findIndex((x) => releaseKey(x) === nowKey);
	const prevIdx = releases.findIndex((x) => releaseKey(x) === prevKey);
	if (nowIdx === -1 || prevIdx === -1) return null;
	if (nowIdx >= prevIdx) return null;
	return {
		from: getDisplayVersion(history[1].version),
		to: getDisplayVersion(history[0].version),
		by: prevIdx - nowIdx
	};
}

export type RolloutCard = {
	ns: string;
	name: string;
	title: string;
	envKey: string;
	envDisplay: string;
	envName: string; // raw env name (e.g. 'staging') for behind-by lookups
	theme: ReturnType<typeof getRolloutEnvironmentTheme>;
	version: string | null;
	timestamp: string | null;
	bakeStatus: string;
	statusKey: StatusKey;
	isRunning: boolean;
	bakeStatusMessage: string | null;
	failureCategory: string | null;
	previousSucceededVersion: string | null;
	pinnedVersion: string | null;
	/** Non-null when the CURRENT version is older than the one it replaced. */
	rolledBack: RollbackMark | null;
	stuck: StuckReason | null;
	/**
	 * ⛔ A HEALTH CHECK IS FAILING RIGHT NOW — and this is NOT derivable from
	 * `statusKey`. The deploy succeeded; the check failed afterwards. Four list
	 * surfaces printed the word *healthy* on a rollout whose SLO was blown
	 * because every one of them read the deploy's verdict and stopped. See
	 * `view-models/health-witness.ts`.
	 */
	checkFailure: CheckFailure | null;
	/**
	 * ⛔ THE RANK. READ THIS, NEVER `behind`, FOR ANYTHING DISPLAYED.
	 *
	 * The shared product-wide verdict from `view-models/env-rank.ts` — the
	 * SAME object `/apps`, `/apps/[name]`, `/environments`, `/envs/*` and
	 * `/versions` print. `behind` below is peer ATTRIBUTION only.
	 */
	rank: RankVerdict;
	/**
	 * WHICH environment this one is behind, and what that one is running.
	 * Attribution, not measurement: `behindBy` is copied off `rank` so the two
	 * cannot disagree, and `null` here means "no peer to name", never
	 * "up to date". A card with `behind: null` and `rank.kind === 'behind'` is
	 * a perfectly ordinary rollout — see the note on `computeBehind`.
	 */
	behind: { fromEnv: string; version: string; behindBy: number | null } | null;
	rollout: Rollout;
	sourceURL: string; // dashboard URL this rollout belongs to (empty = local)
	sourceCluster: string; // cluster NAME this rollout belongs to (for name-based routing)
};

// Build a per-app map: appName → Array<{envName, rollout}> sorted by env tier.
// Used to compute "N versions behind" diagnostics on each card.
function buildAppIndex(
	rollouts: Rollout[],
	environments: Environment[]
): Map<string, { envName: string; rollout: Rollout }[]> {
	const map = new Map<string, { envName: string; rollout: Rollout }[]>();
	for (const env of environments) {
		const appName = env.spec?.rolloutRef?.name;
		const envName = env.spec?.environment;
		if (!appName || !envName) continue;
		const r = rollouts.find((x) => rolloutMatchesEnvironment(x, env));
		if (!r) continue;
		if (!map.has(appName)) map.set(appName, []);
		map.get(appName)!.push({ envName, rollout: r });
	}
	for (const list of map.values()) {
		list.sort((a, b) => compareEnvironmentNames(a.envName, b.envName));
	}
	return map;
}

// Find the most relevant peer env for this rollout — the one where my current
// version exists as a past deploy. That env has progressed past me, so we say
// I'm "behind <env>" — direction derived from data, not from env-name tier
// assumptions.
//
// ⛔ THIS FUNCTION NO LONGER MEASURES ANYTHING. IT ONLY NAMES A PEER.
// (2026-08-30) The measurement moved to `view-models/env-rank.ts`, which is
// the product's ONE denominator. What was here produced the worst defect in
// the product, and both halves of it are worth keeping written down:
//
//   1. IT COUNTED AGAINST THE ROLLOUT'S OWN `availableReleases`. On the live
//      hub `hello-world-app` runs the IDENTICAL build `991829b` in dev and in
//      staging, and their own release lists are 16 and 15 entries long, so
//      this printed `−15` on one row and would have printed `−14` on the row
//      directly beneath it. A rank that changes between two environments
//      running the same sha is not a rank.
//   2. WORSE, WHEN IT COULD NOT ANSWER IT RETURNED `null`, AND
//      `RolloutGrid`/`ControlCenter` RENDERED `null` AS THE WORD `newest`.
//      staging fell into exactly that hole — `compareRollouts` went silent
//      (no history overlap) and no peer had a SMALLER own-list count — so
//      `/rollouts` printed `dev −15 991829b` and `staging newest 991829b`
//      on adjacent rows of one page, for one build. One page contradicting
//      itself, which is not two definitions disagreeing.
//
// `compareRollouts` survives for peer ATTRIBUTION ("behind which env"), which
// is the question it is actually good at, and `newerReleaseCount` survives for
// picking the most-advanced peer when history overlap is lost. Neither may
// produce a number that reaches a chip: `behindBy` is overwritten from the
// ladder rank by the caller.
function computeBehind(
	r: Rollout,
	envName: string,
	appIndex: Map<string, { envName: string; rollout: Rollout }[]>
): { fromEnv: string; version: string; behindBy: number | null } | null {
	if (r.spec?.wantedVersion) return null;
	const peers = appIndex.get(r.metadata?.name ?? '');
	if (!peers || peers.length < 2) return null;
	let best: { fromEnv: string; version: string; behindBy: number | null } | null = null;
	for (const peer of peers) {
		if (peer.envName === envName) continue;
		const rel = compareRollouts(r, peer.rollout);
		if (!rel || rel.kind !== 'behind') continue;
		const candidate = { fromEnv: peer.envName, version: rel.otherVersion, behindBy: rel.by };
		if (!best || (candidate.behindBy ?? 0) > (best.behindBy ?? 0)) best = candidate;
	}

	const myNewer = newerReleaseCount(r);
	// `null` = lag is unknowable (current version aged out of its own
	// availableReleases). Say nothing rather than something false, and leave
	// whatever compareRollouts managed to work out.
	if (myNewer === null || myNewer === 0) return best;

	// compareRollouts named a peer — keep its attribution, take the accurate count.
	if (best) return { ...best, behindBy: myNewer };

	// compareRollouts went silent (history overlap lost). Attribute to the
	// most-advanced peer: the one with the fewest releases still newer than it.
	let ahead: { envName: string; version: string; newer: number } | null = null;
	for (const peer of peers) {
		if (peer.envName === envName) continue;
		const peerNewer = newerReleaseCount(peer.rollout);
		if (peerNewer === null || peerNewer >= myNewer) continue; // not ahead of me
		const peerV = peer.rollout.status?.history?.[0]?.version
			? getDisplayVersion(peer.rollout.status.history[0].version)
			: null;
		if (!peerV) continue;
		if (!ahead || peerNewer < ahead.newer) {
			ahead = { envName: peer.envName, version: peerV, newer: peerNewer };
		}
	}
	if (ahead) return { fromEnv: ahead.envName, version: ahead.version, behindBy: myNewer };
	return best;
}

export function buildRolloutCards(
	rollouts: Rollout[],
	environments: Environment[],
	now: Date
): RolloutCard[] {
	const appIndex = buildAppIndex(rollouts, environments);
	// ONE LADDER PER APP, built once for the whole fleet — the same derivation
	// `/apps` and `/environments` read. See env-rank.ts for why this and not
	// each rollout's own `availableReleases`.
	const ranks = rankVerdictsByRollout(rollouts, environments);
	return rollouts.map((r) => {
		const latest = r.status?.history?.[0];
		const env = environments.find((e) => rolloutMatchesEnvironment(r, e));
		const theme = getRolloutEnvironmentTheme(r, env);
		const bakeStatus = latest?.bakeStatus || 'None';
		const isRunning = bakeStatus === 'InProgress' || bakeStatus === 'Deploying';
		let statusKey: StatusKey;
		if (bakeStatus === 'Failed') statusKey = 'failed';
		else if (isRunning) statusKey = 'active';
		else if (!latest) statusKey = 'pending';
		else statusKey = 'succeeded';
		const envDisplay = shortEnvLabel(theme);
		const envName = env?.spec?.environment ?? '';
		const rank: RankVerdict = ranks.get(r) ?? { kind: 'unknown' };
		// Attribution keeps its peer; the NUMBER comes off the ladder so the
		// card and the app row cannot print two answers for one rollout.
		const attribution = envName ? computeBehind(r, envName, appIndex) : null;
		const behind = attribution ? { ...attribution, behindBy: rankBehindBy(rank) } : null;
		// For failed cards: find the most recent succeeded version that's different
		// from the current one. Gives the user a rollback target at a glance.
		let previousSucceededVersion: string | null = null;
		if (bakeStatus === 'Failed') {
			const currentV = latest?.version ? getDisplayVersion(latest.version) : null;
			for (const h of r.status?.history ?? []) {
				if (h.bakeStatus !== 'Succeeded') continue;
				const v = getDisplayVersion(h.version);
				if (v && v !== currentV) {
					previousSucceededVersion = v;
					break;
				}
			}
		}
		return {
			ns: r.metadata?.namespace || '',
			name: r.metadata?.name || '',
			title: r.status?.title || r.metadata?.name || '',
			envKey: theme?.name || '',
			envDisplay,
			envName,
			theme,
			version: latest?.version ? getDisplayVersion(latest.version) : null,
			timestamp: latest?.timestamp || null,
			bakeStatus,
			statusKey,
			isRunning,
			bakeStatusMessage: latest?.bakeStatusMessage || null,
			failureCategory:
				bakeStatus === 'Failed' ? categorizeFailure(latest?.bakeStatusMessage) : null,
			previousSucceededVersion,
			pinnedVersion: r.spec?.wantedVersion || null,
			rolledBack: detectRollback(r),
			stuck: detectStuck(r, { now }),
			checkFailure: checkFailure(r),
			rank,
			behind,
			rollout: r,
			sourceURL: sourceDashboardURL(r),
			sourceCluster: sourceClusterName(r)
		};
	});
}

/**
 * ⛔ THE VERDICT HALF OF THE CARD'S CHIP HOLDS THE RANK. THE STATE GOES IN
 * THE DISC. (2026-08-31 — this supersedes the 2026-08-30 precedence table,
 * which is kept below because its measurements are still binding.)
 *
 * ── WHAT WENT WRONG ───────────────────────────────────────────────────────
 *
 * The precedence `rolled back` > `pinned` > rank did not RANK two facts, it
 * DELETED one. From a live critique: on `/` and `/rollouts` prod showed
 * `ROLLED BACK 51b976a` **with no number, while it was the most-behind
 * rollout in the fleet** — sitting under a group header that reads
 * *"Trailing · healthy, but behind a newer build"*. The section counted it
 * and the row then refused to say how far.
 *
 * ── WHY THE FIX IS NOT "PUT BOTH WORDS IN THE CHIP" ───────────────────────
 *
 * Because the row cannot afford it, and that was measured, not guessed. `/`'s
 * Trailing card is 400px at 1440 and 358px at 390. `ROLLED BACK · 24 BEHIND`
 * at the chip's 11px uppercase tracking is ~80px more than `24 BEHIND`, and
 * the 2026-08-30 measurement below shows what that does: the app name — the
 * primary identifier, and the only thing that answers WHICH rollout — goes to
 * zero width. Adding a third chip is out for the same reason and is banned
 * outright by `Chip.svelte`'s two-half rule.
 *
 * ── THE SHAPE, AND WHY IT COSTS NOTHING ───────────────────────────────────
 *
 * The row already carries a fourth element that is spending itself on
 * nothing: **the status disc**. Every card in `Trailing` is `succeeded` by
 * construction (`healthy = succeeded && !stuck`), so the disc draws a green
 * tick on every single row — a mark repeated down a list to state the norm,
 * which is the one thing `DESIGN.md` bans everywhere else.
 *
 * So the DISC carries the state and the CHIP carries the rank:
 *
 * | row state | disc glyph | chip label |
 * |---|---|---|
 * | deploy failed / checking / deploying | its own status glyph (unchanged) | the rank |
 * | settled + rolled back | ↩ undo, in the disc's existing green | the rank |
 * | settled + pinned | 🔒 lock, same | the rank |
 * | settled, neither | ✓ tick (unchanged) | the rank |
 *
 * Zero elements added, zero pixels moved, both facts at rest, and the chip
 * goes back to being the `[rank][build]` unit every other page draws. The
 * state word is still readable — it is the disc's `sr-only` text and its
 * `title`, and the chip's title still carries both sentences.
 *
 * ⚠️ THE DISC OVERRIDE ONLY APPLIES TO A SETTLED DEPLOY. A failed or in-
 * flight deploy owns the disc: replacing a red `!` with a lock would hide the
 * louder fact behind the quieter one, which is the same defect in the mirror.
 *
 * ⚠️ AND `rolled back` STILL OUTRANKS `pinned`. Rolling back PINS by
 * construction — `ChangeVersionModal`'s `mustPin` is true whenever the picked
 * version is older than the current one — so the two co-occur on every
 * rollback and the disc holds one glyph.
 *
 * ── THE 2026-08-30 MEASUREMENT, STILL BINDING ─────────────────────────────
 *
 * The first attempt at "say the word rollback on the list surfaces" added a
 * `RollbackBadge` and a `PinBadge` as LOOSE MARKS on `/`'s row. Measured at
 * 1440 light, the cost was immediate and unacceptable:
 *
 *     [PROD][ROLLED BACK][PINNED][23 BEHIND][aa17645]   name width 0 of 108
 *     hello…[PROD][ROLLED BACK][24 BEHIND][51b976a]     name width 45 of 108
 *                                                       scrollWidth 415 / 398
 *     hello…[DEV][PINNED][19 BEHIND][991829b]           name width 85 of 108
 *
 * **The app name is the primary identifier and is never the thing that gets
 * sacrificed.** The row is a single ~398px line; it carries a disc, a name, an
 * env chip and ONE `[verdict][build]` chip, and that is the whole budget.
 */
export function cardVerdict(
	c: Pick<RolloutCard, 'rolledBack' | 'pinnedVersion'>,
	rankWord: string,
	rankSentence: string
): { label: string; title: string } {
	const mark = cardStateMark(c);
	// ⛔ THE LABEL IS ALWAYS THE RANK. A state never evicts the number; it
	// moves to the disc (see above) and joins the title here.
	if (!mark) return { label: rankWord, title: rankSentence };
	return { label: rankWord, title: `${mark.title} ${rankSentence}` };
}

/**
 * THE DISC'S GLYPH, when the deploy itself is settled and something OTHER
 * than the deploy is the news.
 *
 * `null` means "draw the ordinary status glyph". Returned as data rather than
 * rendered here so `/` and `/rollouts` cannot spell one act two ways — the
 * defect that put `PinBadge` on one list and a chip word on the other.
 */
export type CardStateMark = {
	kind: 'rolled-back' | 'pinned';
	/** The product's word for it, for `sr-only` text and the disc's title. */
	word: string;
	/** One sentence, stating the consequence. */
	title: string;
};

export function cardStateMark(
	c: Pick<RolloutCard, 'rolledBack' | 'pinnedVersion'>
): CardStateMark | null {
	if (c.rolledBack) {
		const { from, to, by } = c.rolledBack;
		const plural = by === 1 ? '' : 's';
		return {
			kind: 'rolled-back',
			word: 'rolled back',
			title: `Rolled back ${by} version${plural}: ${from} → ${to}.`
		};
	}
	if (c.pinnedVersion) {
		return {
			kind: 'pinned',
			word: 'pinned',
			title: `Pinned to ${c.pinnedVersion} — automatic deploys are paused until the pin is cleared.`
		};
	}
	return null;
}
