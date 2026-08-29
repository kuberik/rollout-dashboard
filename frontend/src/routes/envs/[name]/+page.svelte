<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ONE ENVIRONMENT — "what's happening right now, AND ITS HISTORY."
	 *
	 * The second half of that sentence is from `DESIGN-INTENT.md` and the page
	 * did not answer it: it rendered a stat strip, one ledger, and then 348px
	 * of nothing in an 847px `main`. `ActivityRail` answers it — the last
	 * deploys in this environment, newest first, each naming the app, the sha
	 * it came from and the sha it went to, with the STATUS printed in words
	 * only when it is not `Succeeded`.
	 *
	 * ⛔ IT IS NOT ANSWERED TWICE. `DeployHistoryStrip` — six coloured dashes
	 * per app per row — was cut on 2026-08-28. It read the SAME
	 * `status.history` array the rail reads, on the same screen, and marked
	 * the norm: measured over 17 rows on seven `/envs/*` pages, 96.1% of its
	 * 102 dashes were `Succeeded` green or absent-slot padding, and NOT ONE
	 * row carried a deviation the row's own 24px status circle was not already
	 * drawing. See `DESIGN.md`. Do not rebuild it.
	 *
	 * What else changed, and why — each of these is a rule from
	 * `DEPLOY-BOARD-SPEC.md` / `DESIGN.md` that had reached `/apps/[name]` and
	 * had never reached here:
	 *
	 * · THE RANK IS THE SHARED ONE. `cellLag` measures the HOP to the upstream
	 *   environment. `/apps/[name]` prints the ladder rank. Both landed in the
	 *   same chip geometry, so one rollout read `−17` here and `−19` one click
	 *   away. `env-rank.ts` is now the single derivation for all of them.
	 * · THERE IS A BUILD COLUMN. The page whose question is "what is running
	 *   here" never printed a build identifier, except one malformed 38-zero
	 *   revision that escaped `shortenVersion`'s 40-hex test. The build now
	 *   rides in the shared joined badge, from `getDisplayVersion` — the same
	 *   helper every other page uses.
	 * · MARK THE DEVIATION, NOT THE NORM. Twelve green marks fitted on one
	 *   `/envs/dev` phone screen, every one of them saying "fine". A settled
	 *   row now carries a neutral dot and a bare sha; green, amber and red are
	 *   spent only where something is not the norm.
	 * · IT IS ACTIONABLE. Zero buttons existed in `<main>` on a page that
	 *   announces environments are behind. Adverse rows now carry `Promote`
	 *   (only when `newestDeployableCandidate` proves every gate already allows
	 *   the build — an offer that would be refused is worse than no offer) and
	 *   a link to the rollout. Exactly ONE of them is `primary`, on the topmost
	 *   adverse row, per the spec's button budget.
	 * · MOBILE IS DESIGNED, NOT DERIVED. Every cell after the glyph is placed
	 *   in the 1fr column below `lg`, so nothing lands in the ~36px gutter that
	 *   was clipping `newest` to `NE…` and `trails staging` to `trail…`.
	 */
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { rolloutMatchesEnvironment, rolloutPath } from '$lib/source-dashboard';
	import { groupRolloutsByApp, versionPathForRollout } from '$lib/version-utils';
	import type { AppGroup, AppCell } from '$lib/version-utils';
	import {
		rankVerdicts,
		rankLabel,
		rankRole,
		rankBehindBy,
		rankIsAdverse
	} from '$lib/view-models/env-rank';
	import type { RankVerdict } from '$lib/view-models/env-rank';
	import {
		newestDeployableCandidate,
		promotionBlock,
		detectStuckPromotion
	} from '$lib/view-models/promotion';
	import type { PromotionBlock } from '$lib/view-models/promotion';
	import { buildRolloutCards } from '$lib/rollout-cards';
	import type { StatusKey } from '$lib/rollout-cards';
	import { getEnvironmentRank } from '$lib/env-order';
	import {
		formatTimeAgoCompact,
		formatDate,
		getDisplayVersion,
		plainMessage,
		formatDurationMs,
		detectStuck,
		detectStuckBehind
	} from '$lib/utils';
	import { getRolloutEnvironmentTheme, shortEnvLabel } from '$lib/environment-theme';
	import { regionLabel } from '$lib/view-models/regions';
	import type { EnvironmentTheme } from '$lib/environment-theme';
	import Chip from '$lib/components/Chip.svelte';
	import { now } from '$lib/stores/time';
	import { ArrowLeftOutline, LayersSolid, ChevronRightOutline } from 'flowbite-svelte-icons';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import { getStatusCircleClass } from '$lib/bake-status';
	import DeployVolumeSparkline from '$lib/components/DeployVolumeSparkline.svelte';
	import ActivityRail from '$lib/components/ActivityRail.svelte';
	import ChangeVersionModal from '$lib/components/ChangeVersionModal.svelte';
	import PinBadge from '$lib/components/PinBadge.svelte';
	import type { Rollout, Environment } from '../../../types';

	// The three buttons, declared once, copied verbatim from `/apps/[name]` so
	// the product has one set and not two. `primary` is loud by CONTRAST, which
	// is why it costs nothing from the closed colour budget and cannot collide
	// with the amber that means `stuck`.
	const BTN_PRIMARY =
		'inline-flex h-9 items-center justify-center gap-1 whitespace-nowrap rounded bg-gray-900 px-3 text-[12px] font-semibold text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200 lg:h-7';
	const BTN_DEFAULT =
		'inline-flex h-9 items-center justify-center gap-1 whitespace-nowrap rounded border border-gray-200 bg-white px-3 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 lg:h-7';

	const PANEL =
		'rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800';

	/**
	 * THE STATUS CIRCLE — the repo's atom, not a dot (2026-08-26, from the
	 * human: *"I generally think we're undercoloring now a bit"*).
	 *
	 * `[status circle]` in §6 means what `RolloutGrid.svelte` draws:
	 * `getStatusCircleClass()`'s neutral ground with `BakeStatusIcon`'s
	 * COLOURED glyph inside. A previous pass converged every list onto a 5px
	 * square and then grayed the settled one, reading "mark the deviation,
	 * never the norm" as a licence to desaturate the norm out of existence. It
	 * is not: that rule is about not raising ALARMS on healthy rows, and a
	 * green check is not an alarm.
	 *
	 * Six status hues, and the closed budget has always allowed exactly six:
	 * Succeeded GREEN · Failed RED · InProgress (baking) YELLOW · Deploying
	 * BLUE · stuck AMBER · None/pending GRAY. Baking and Deploying are
	 * DIFFERENT STATES and may never share a hue; `BakeStatusIcon` keeps them
	 * apart with a yellow pulse spinner and a blue rotating one, which is why
	 * this page draws the atom instead of reimplementing it.
	 *
	 * 24px rather than the 32px `RolloutGrid` uses, because this is a dense
	 * list row; the glyph stays `size="small"`.
	 */
	const STATUS_CIRCLE =
		'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full';

	/** Stat-strip ink. Weight only - see the STAT STRIP comment below. */
	const STAT_QUIET = 'text-gray-500 dark:text-gray-400';

	/**
	 * THE ROW, per design handoff §6:
	 *   "[status circle] · [title + name] · [per-app promotion chain — env chips
	 *    for the envs this app is bound to, with the current page's env
	 *    highlighted] · [version] · [pods] · [age]."
	 *
	 * `24px │ 1fr app │ 1fr chain │ 132px build │ 44px age │ 112px action`.
	 *
	 * Every fixed width here is the measured content, not a round number:
	 * 132px is `head 9a1f4c2` in the joined badge, and 112px is the LONGEST
	 * button label rather than the shortest — `Promote` needs 86 but
	 * `Open rollout →` and `Review gates →` need ~104, and at 88px the one row
	 * on the page carrying the page's single `primary` button wrapped its own
	 * label onto two lines.
	 *
	 * ⛔ THE `HISTORY` TRACK IS GONE, AND ITS 116px WENT TO THE TWO `fr` TRACKS
	 * (2026-08-28). It held `DeployHistoryStrip`; see the deletion note in
	 * `DESIGN.md`. Measured at 1440 before and after, the row resolves
	 * `24px 179px 179px 116px 132px 44px 112px` → `24px 243px 243px 132px 44px
	 * 112px`: the app and chain tracks each go 179px → 243px, **+35.8%**, and
	 * one of the six 12px gaps goes with the track. Both were at the edge of
	 * their measured content — the app track had 179px for `checkout-edge`'s
	 * 171px of mono plus its `stuck` alarm, and the chain had 179px for the
	 * ~190px of `DEV › STAGING › PROD`, which is why `payments-core`'s
	 * four-link chain wrapped. It still wraps at 243px (that chain is ~300px),
	 * but every three-link chain on the page now fits on one line with room.
	 *
	 * THE BUILD TRACK IS FIXED AT 132px, and that was measured rather than
	 * chosen. Flexible, it resolved to 92px at 1280 and the joined badge
	 * truncated its own value half to `9a1…` — on the page whose FIRST
	 * criterion is *"what's running here right now — every app's live
	 * version"*. A column that ellipsises the answer is not answering. 132px
	 * holds `head 9a1f4c2` whole at every width the grid applies at.
	 *
	 * The APP track is sized so `checkout-edge` and its `stuck` alarm fit on
	 * ONE line — measured at 1440, 101px of mono plus an 8px gap plus a 62px
	 * chip against 194px of track. It wrapped at 145px, which pushed the one
	 * row on the page that needs a person to three lines and broke the
	 * alignment of every cell to its right.
	 *
	 * Several `fr` tracks, and that is not the thing the "every non-flexible
	 * track must be FIXED" rule forbids: that rule is about `auto`, which is
	 * INTRINSIC and therefore resolves differently on every row. An `fr` track
	 * is a pure function of the container and resolves identically on all of
	 * them, so the columns still line up by construction.
	 *
	 * THE STATE COLUMN IS GONE and the ACTION column shrank from 224px to one
	 * button. §6 lists five cells and none of them is a state sentence; the
	 * chain needs the width, and the row's state is already carried by the
	 * status circle plus the rank chip in the build badge. The action column
	 * survives at all — against a literal reading of the spec — because "IT IS
	 * ACTIONABLE" is an enforced rule on THIS page: it previously shipped with
	 * zero buttons in `<main>` while announcing that environments were behind.
	 * One button, not two: `Open rollout →` was the second, and the app name
	 * beside it is already that link.
	 */
	const ROW_GRID =
		'lg:grid-cols-[24px_minmax(0,1fr)_minmax(0,1fr)_132px_44px_112px]';

	const envName = $derived(page.params.name as string);

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);

	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	// Whether this tier is referenced by any Environment resource at all —
	// distinct from `slots.length === 0`, which can also mean "tier exists
	// but nothing has deployed here yet".
	const envExists = $derived(environments.some((e) => e.spec?.environment === envName));

	// Same fleet-wide app grouping the Apps/Environments pages use — a single
	// source of truth for "what is this app's per-env cell", so this page can't
	// drift from the matrix/app-detail view.
	const groups = $derived.by<Map<string, AppGroup>>(() => groupRolloutsByApp(rollouts, environments));

	type EnvSlot = {
		appName: string;
		group: AppGroup;
		cell: AppCell;
		rank: RankVerdict;
	};

	// Flatten every app's cell(s) bound to this env tier. Usually one cell per
	// app; more than one only happens for multi-cluster fan-out at this tier
	// (e.g. multiple prod regions), which we surface as separate rows rather
	// than inventing a peer-region rollup we can't derive reliably.
	const slots = $derived.by<EnvSlot[]>(() => {
		const out: EnvSlot[] = [];
		for (const group of groups.values()) {
			// ONE ladder per app, not one per row.
			const ranks = rankVerdicts(group);
			for (const cell of group.cells) {
				if (cell.environment?.spec?.environment === envName) {
					out.push({
						appName: group.appName,
						group,
						cell,
						rank: ranks.get(cell) ?? { kind: 'unknown' }
					});
				}
			}
		}
		return out;
	});

	// Reuse the same statusKey classification the Rollouts list / matrix use
	// (succeeded | failed | active | pending) so "Healthy" here means the
	// same thing it means everywhere else in the dashboard.
	const statusByRollout = $derived.by<Map<Rollout, StatusKey>>(() => {
		const cards = buildRolloutCards(rollouts, environments, $now);
		const map = new Map<Rollout, StatusKey>();
		for (const c of cards) map.set(c.rollout, c.statusKey);
		return map;
	});

	// Env theme for the identity chip: prefer a matched slot's theme; if the
	// tier exists but has no deployed apps yet, fall back to any Environment
	// resource for this tier, then finally a pure name-based preset match.
	const slotTheme = $derived.by<EnvironmentTheme | null>(() => {
		for (const s of slots) if (s.cell.theme) return s.cell.theme;
		for (const env of environments) {
			if (env.spec?.environment !== envName) continue;
			const r = rollouts.find((x) => rolloutMatchesEnvironment(x, env));
			const t = getRolloutEnvironmentTheme(r ?? null, env);
			if (t) return t;
		}
		return getRolloutEnvironmentTheme(null, envName);
	});
	/**
	 * The identity chip's label. A production REGION prints its distinguishing
	 * segment — `AF-SOUTH-1`, not `PROD-AF-SOUTH-1` — for two reasons that
	 * both already have precedent in this codebase.
	 *
	 * `regions.ts`: twelve chips reading `PROD-AP-SOUTH…` spend every
	 * character on the token they have in common. And `DESIGN.md`'s own
	 * measurement of this very chip: `PRODUCTION` rendered 82.2px at 231.6
	 * presence against the `stuck` alarm's 199.8 — an identity mark LOUDER
	 * than the alarm, which is the one ceiling that may never be crossed.
	 * `PROD-AF-SOUTH-1` is wider still. `AF-SOUTH-1` is also exactly the label
	 * `/environments` prints on the row you clicked to get here.
	 */
	const envShort = $derived(
		getEnvironmentRank(envName) === 8
			? regionLabel(envName)
			: shortEnvLabel(slotTheme ?? envName) || envName
	);
	/**
	 * The `h1`'s second half. Empty when the preset title is just the tier name
	 * in title case — `prod` / `Production` earns the pair, `prod-eu-west` /
	 * `Production` does not, because the second half would then be naming a
	 * DIFFERENT environment from the first.
	 */
	const PRESET_TITLES: Record<string, string> = {
		dev: 'Development',
		development: 'Development',
		prod: 'Production',
		production: 'Production',
		stage: 'Staging',
		staging: 'Staging',
		test: 'Test',
		testing: 'Test'
	};
	const envTitle = $derived.by<string>(() => {
		// EXACT name match only. `getRolloutEnvironmentTheme` matches presets by
		// PATTERN, so every `prod-*` region also resolves to the label
		// "Production" — and printing `prod-eu-west  Production` puts two
		// different environments on one line in the page's largest type.
		const exact = PRESET_TITLES[envName.trim().toLowerCase()];
		if (exact) return exact;
		const label = slotTheme?.label ?? '';
		if (!label || label.toLowerCase() === envName.trim().toLowerCase()) return '';
		return PRESET_TITLES[label.toLowerCase()] ? '' : label;
	});

	function rolloutHref(cell: AppCell): string {
		return rolloutPath(
			cell.sourceCluster || localClusterName,
			cell.rollout.metadata?.namespace || '',
			cell.rollout.metadata?.name || ''
		);
	}
	function cellVersion(cell: AppCell): string | null {
		const v = cell.rollout.status?.history?.[0]?.version;
		return v ? getDisplayVersion(v) || null : null;
	}

	// ─────────────────────────── Row derivation ────────────────────────────
	function isRunning(s: string) {
		return s === 'InProgress' || s === 'Deploying';
	}

	function stuckFor(slot: EnvSlot) {
		const own = detectStuck(slot.cell.rollout, { now: $now });
		if (own) return own;
		const promo = detectStuckPromotion(slot.cell.rollout, { now: $now });
		if (promo) return promo;
		for (const peer of slot.group.cells) {
			if (peer === slot.cell) continue;
			const r = detectStuckBehind(slot.cell.rollout, peer.rollout, peer.envName, { now: $now });
			if (r) return r;
		}
		return null;
	}
	type StuckReason = NonNullable<ReturnType<typeof stuckFor>>;

	/**
	 * The state sentence. NEVER NAMES A CAUSE IT CANNOT EVIDENCE — every branch
	 * below is read off the field that established it, and where there is no
	 * such field it states the observable and stops.
	 */
	function stateLabel(status: string): string {
		switch (status) {
			case 'Succeeded':
				return 'Bake succeeded';
			case 'Failed':
				return 'Bake failed';
			case 'InProgress':
				return 'Baking';
			case 'Deploying':
				return 'Deploying';
			case 'Cancelled':
				return 'Bake cancelled';
			default:
				return 'No deploy yet';
		}
	}

	type Row = {
		slot: EnvSlot;
		key: string;
		appName: string;
		title: string | null;
		status: string;
		statusKey: StatusKey;
		version: string | null;
		versionHref: string | null;
		rank: RankVerdict;
		timestamp: string | null;
		message: string;
		stuck: StuckReason | null;
		/**
		 * ⛔ THE STATE LINE IS GONE (2026-08-27). It printed `deploying`,
		 * `baking` or `N queued` under the app name and all three were already
		 * on the row:
		 *
		 * · `deploying` / `baking` — the status circle 12px to the LEFT draws
		 *   them, a BLUE rotating spinner and a YELLOW pulse, two of the six
		 *   status hues, kept apart by `BakeStatusIcon` on every page in the
		 *   product. A word beside its own mark is a caption.
		 * · `N queued` — `newerReleaseCount`, and the Build cell 300px to the
		 *   right already prints `−N` from `env-rank`. Two derivations of "how
		 *   much newer work exists" that agree on nearly every row and are
		 *   read as one number: on `/envs/prod` the stuck row printed
		 *   `19 queued` under `−19`. Direction B's *"nothing appears twice"*
		 *   holds here too, and when the two DISAGREE the printed pair is
		 *   worse than either alone.
		 *
		 * What is left under the app name is its OCI title, which is the one
		 * string on that line that is neither a mark nor a restatement.
		 */
		block: PromotionBlock;
		/** Tag a `Promote` here would deploy, or null when none may be offered. */
		promoteTag: string | null;
		adverse: boolean;
		/** Exactly one row on the whole page may carry this. */
		primary: boolean;
		severity: number;
	};

	const rows = $derived.by<Row[]>(() => {
		const out: Row[] = [];
		for (const slot of slots) {
			const latest = slot.cell.rollout.status?.history?.[0];
			const status = latest?.bakeStatus || 'None';
			const statusKey = statusByRollout.get(slot.cell.rollout) ?? 'pending';
			const version = cellVersion(slot.cell);
			const stuck = stuckFor(slot);
			const candidate = newestDeployableCandidate(slot.cell.rollout);
			// NEEDS A PERSON vs MERELY BEHIND. Being behind is the normal state of
			// a promotion pipeline; it earns a rank chip, not a control. A row
			// gets buttons when someone has to decide something (failing, stuck,
			// off the release line) or when there is a promotion that would
			// actually succeed — `newestDeployableCandidate` is non-null only
			// when every gate has already allowed that exact tag.
			const needsPerson =
				statusKey === 'failed' || !!stuck || slot.rank.kind === 'diverged';
			const adverse = needsPerson || !!candidate;
			out.push({
				slot,
				key:
					slot.appName +
					(slot.cell.sourceCluster ?? '') +
					(slot.cell.rollout.metadata?.namespace ?? ''),
				appName: slot.appName,
				title:
					slot.cell.rollout.status?.title && slot.cell.rollout.status.title !== slot.appName
						? slot.cell.rollout.status.title
						: null,
				status,
				statusKey,
				version,
				versionHref: version
					? versionPathForRollout(slot.cell.rollout, slot.appName, version)
					: null,
				rank: slot.rank,
				timestamp: latest?.timestamp ?? null,
				// A message is worth a line only when a PERSON wrote it. Every
				// controller-driven promotion carries the same boilerplate, and
				// `Automatic deployment` printed six times down one column is the
				// row restating what `triggeredBy: System` already guarantees.
				message:
					latest?.triggeredBy?.kind && latest.triggeredBy.kind !== 'System'
						? plainMessage(latest?.message)
						: '',
				stuck,
				block: promotionBlock(slot.cell.rollout),
				promoteTag: candidate ? (candidate.tag ?? candidate.version ?? null) : null,
				adverse,
				primary: false,
				/**
				 * WORST FIRST, AND "WORST" IS CRITERION 2'S OWN WORDING.
				 *
				 * `PAGE-CRITERIA.md` §03 for this page: *"2. What here is
				 * unhealthy or behind? — SORTED TO THE TOP"*, and separately
				 * *"3. What's mid-rollout in this env? — canary / queued
				 * BADGES"*. Two criteria, two different mechanisms: ordering
				 * answers the first, marks answer the second.
				 *
				 * This used to rank `Deploying`/`InProgress` at 2 and `behind`
				 * at 1, which put every in-flight row ABOVE every trailing one
				 * and left criterion 2 answered only for the failing and stuck
				 * bands. A deploy in progress is not unhealthy — it is the
				 * pipeline working — so it now sorts below the rows that are
				 * not, and criterion 3 carries it in the status circle (BLUE
				 * spinner / YELLOW pulse) and in the row's state line instead.
				 * `diverged` gets its own band above `behind` because it is not
				 * a distance: promoting N times never arrives at it.
				 */
				severity:
					status === 'Failed'
						? 5
						: stuck
							? 4
							: slot.rank.kind === 'diverged'
								? 3
								: rankIsAdverse(slot.rank)
									? 2
									: isRunning(status)
										? 1
										: 0
			});
		}
		// Worst first, then deepest lag, then alphabetical — a stable order that
		// puts the row needing a person above the fold at every width.
		out.sort((a, b) => {
			if (a.severity !== b.severity) return b.severity - a.severity;
			const lag = rankBehindBy(b.rank) - rankBehindBy(a.rank);
			if (lag !== 0) return lag;
			return a.appName.localeCompare(b.appName);
		});
		// ONE primary per page, on the topmost row that needs a decision.
		const first = out.find((r) => r.adverse);
		if (first) first.primary = true;
		return out;
	});

	// ──────────────────────────── Header counts ────────────────────────────
	/**
	 * ⛔ THERE IS NO VERDICT SENTENCE ON THIS PAGE ANY MORE (2026-08-27).
	 *
	 * From the human: *"Environment and app detail I generally don't like this
	 * descriptive text … We need to design dashboard in such a way that user's
	 * attention is pulled in to where is necessary. Text doesn't cut it and
	 * just pollutes."*
	 *
	 * `1 app here is stuck.` was the page's largest non-title type and it
	 * described the FIRST ROW of the list 180px below it — a row that already
	 * carries the `stuck` alarm chip, the loudest mark in the product (218.6
	 * light / 162.3 dark by DESIGN.md's own ink formula), and is sorted to the
	 * top by `severity` precisely so that it is the first thing under the
	 * header. The sentence was a caption for a mark, and a caption for a mark
	 * that is louder than the caption.
	 *
	 * Four derived counts (`behindCount`, `divergedCount`, `failingCount`,
	 * `stuckCount`) existed only to build it and went with it. WHAT CARRIES
	 * EACH FACT NOW: `failing` / `stuck` → the row's own chip and its status
	 * circle; `diverged` → the `diverged` chip in the Build column; `N of M
	 * behind` → the `−N` chips in that same column and the `Promotion rate`
	 * tile, which is the same ratio as a number.
	 *
	 * THE HEALTH COUNTS were already prose here once (`N of M healthy`); they
	 * were moved into the `Apps` tile as a tick strip, and that strip has now
	 * been cut too (see the tombstone below). Do not bring either of them back
	 * as a sentence.
	 */

	/**
	 * ⛔ THE GRAY BARS ARE GONE. `EnvHealthStrip` IS DELETED (2026-08-27).
	 *
	 * > *"i also don't understand what these gray bars mean there and on the
	 * > detail page"* — the human, naming this object on `/environments` and
	 * > on this page in one sentence.
	 *
	 * It drew one 6px tick per app, worst-first, and since the colour pass
	 * took `green-700` off the healthy tick it drew the common case GRAY. A
	 * 22-app environment is then 22 identical gray dashes: THE OBJECT IS ~92%
	 * NORM, and a mark whose common case means nothing has no way to teach its
	 * own exceptions. Making it self-evident would have taken exactly the
	 * legend the human has now deleted twice, and the brief forbids adding
	 * one.
	 *
	 * It never had a monopoly on its fact either: the caption 4px below it
	 * (`1 stuck · 1 baking · 1 healthy`) said the same thing in words and
	 * could NAME the app, which an anonymous tick could only do on hover.
	 *
	 * WHAT CARRIES THE FACT NOW, per app rather than per environment: the
	 * status circle at the head of every row — the product's own atom, RED
	 * failed, YELLOW baking, BLUE deploying, GREEN succeeded, gray pending —
	 * the `stuck` alarm chip beside the app's name, the `diverged` / `−N` chip
	 * in the Build column, and `severity`, which sorts all of them to the top.
	 * The rollup that is genuinely lost is the COUNT per bucket; the
	 * comparison view that exists to rank environments against each other is
	 * `/environments`, and this page's own first criterion is *"what's running
	 * here RIGHT NOW"*, which is a per-row question.
	 *
	 * The `Apps` tile keeps the number and nothing else. `/environments` cut
	 * the same object in the same pass; this page was its last consumer and
	 * `EnvHealthStrip.svelte` is deleted with it.
	 */

	const deploys24h = $derived.by(() => {
		const cutoff = $now.getTime() - 24 * 60 * 60 * 1000;
		let n = 0;
		for (const s of slots) {
			for (const h of s.cell.rollout.status?.history ?? []) {
				if (!h.timestamp) continue;
				if (new Date(h.timestamp).getTime() >= cutoff) n++;
			}
		}
		return n;
	});

	// ─────────────────────── §6 METRICS STRIP ───────────────────────────
	/**
	 * "A metrics strip card with: Apps count · Deploys 24h + spark · Median
	 *  bake · Promotion rate."  — design handoff §6.
	 */

	/**
	 * MEDIAN BAKE — the median of every bake window this environment has a
	 * measured span for. `bakeStartTime` → `bakeEndTime` is the detector's own
	 * pair, so this is the duration the controller measured and not a re-read
	 * of the clock. A bake still running has no `bakeEndTime` and is excluded
	 * rather than clamped to "now": an in-flight window is not a duration yet.
	 * With nothing to measure the tile prints an em dash. It never prints `0`.
	 */
	const medianBakeMs = $derived.by<number | null>(() => {
		const spans: number[] = [];
		for (const slot of slots) {
			for (const h of slot.cell.rollout.status?.history ?? []) {
				if (!h.bakeStartTime || !h.bakeEndTime) continue;
				const a = new Date(h.bakeStartTime).getTime();
				const b = new Date(h.bakeEndTime).getTime();
				if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
				spans.push(b - a);
			}
		}
		if (spans.length === 0) return null;
		spans.sort((x, y) => x - y);
		const mid = spans.length >> 1;
		return spans.length % 2 ? spans[mid] : Math.round((spans[mid - 1] + spans[mid]) / 2);
	});

	/**
	 * PROMOTION RATE — the share of apps here that are running their app's
	 * NEWEST build, i.e. how well promotion into this environment is keeping
	 * up with the release line.
	 *
	 * The spec names the metric and not its derivation, so this picks the one
	 * the data can actually evidence and says so in the tile's tooltip. Rows
	 * whose rank is `unknown` are excluded from BOTH halves rather than
	 * counted as failures — `unknown` means the ladder could not answer, and
	 * DESIGN.md forbids rendering an unresolvable comparison as a claim. When
	 * nothing is rankable the tile prints an em dash.
	 */
	const promotionRate = $derived.by<number | null>(() => {
		const rankable = rows.filter((r) => r.rank.kind !== 'unknown');
		if (rankable.length === 0) return null;
		const onNewest = rankable.filter((r) => r.rank.kind === 'newest').length;
		return Math.round((onNewest / rankable.length) * 100);
	});

	/** The most recent deploy anywhere in this environment. */
	const lastDeployTs = $derived.by<string | null>(() => {
		let best: string | null = null;
		for (const r of rows) {
			if (!r.timestamp) continue;
			if (!best || new Date(r.timestamp) > new Date(best)) best = r.timestamp;
		}
		return best;
	});

	/**
	 * The namespace, mono, in the header — but ONLY when there is one.
	 * An environment tier is a set of (app, namespace) bindings, so `prod`
	 * routinely spans `orders-api-prod`, `payments-core-prod` and so on.
	 * Printing one of them would name a place most of the rows are not in.
	 */
	const namespaces = $derived.by<string[]>(() => {
		const set = new Set<string>();
		for (const s of slots) {
			const ns = s.cell.rollout.metadata?.namespace;
			if (ns) set.add(ns);
		}
		return [...set].sort();
	});

	// ────────────────── §6 PER-APP PROMOTION CHAIN ──────────────────────
	/**
	 * "[per-app promotion chain — env chips for the envs this app is bound to,
	 *  with the current page's env highlighted] ... Chain ordered by
	 *  `compareEnvironmentNames`. Others: muted/neutral. Joined by
	 *  `ChevronRightOutline` icons."
	 *
	 * ⛔ `only bound to {envName}` IS DELETED (2026-08-27). §6 asked for that
	 * sentence in place of a one-link chain; it is a sentence that names the
	 * environment the `h1`, the header chip and the painted chip in this very
	 * cell all already name, and its whole content is "there is nothing else
	 * here", which one lone chip states by being lone. A single painted chip
	 * with no chevrons IS the diagram of one place.
	 *
	 * NO ENV-LEVEL CHAIN ANYWHERE ON THIS PAGE. The handoff says it twice —
	 * *"No env-level upstream/current/downstream chain"* and *"No assumption of
	 * a shared promotion chain across an environment"* — because each app
	 * declares its own envs and they differ. `edge-mesh` runs dev + twelve
	 * regions; `orders-api` runs dev, staging, prod. There is no such thing as
	 * "the chain of prod".
	 *
	 * HOW THE HIGHLIGHT IS DONE, AND WHY IT IS NOT MINT. §6 asks for the
	 * current env chip to be a "mint pill". Mint is a green, and this product
	 * already spends green three ways in one viewport: the `Succeeded` glyph,
	 * DEV's identity seed `#16a34a`, and (as of the 2026-08-26 correction) the
	 * `newest` rank chip. A fourth green whose meaning is "you are here" would
	 * be the loudest ambiguity on the page, and on `/envs/dev` the mint pill
	 * and the dev identity pill would be the same chip in two greens.
	 *
	 * So the highlight is carried by the axis this product already uses for
	 * environments: the current env chip renders in ITS OWN identity theme —
	 * green on dev, violet on staging, amber on prod — and every other chip in
	 * the chain renders NEUTRAL GRAY. One coloured chip per chain, the colour
	 * is the environment's own, and it is the environment the page is about.
	 * Zero new colour values, and `Chip`'s product-wide invariant is intact:
	 * an env chip's colour is still a function of the environment's NAME. What
	 * varies is whether identity is PAINTED at all, which is a function of
	 * position in the chain, never of deploy status.
	 */
	type ChainLink = {
		/** Empty on the folded region count — it addresses no single env. */
		tier: string;
		label: string;
		theme: EnvironmentTheme | null;
		current: boolean;
		/** The environments a folded count stands for, for the tooltip. */
		countTitle?: string;
	};

	function chainFor(group: AppGroup): ChainLink[] {
		const seen = new Set<string>();
		const stages: ChainLink[] = [];
		const regions: ChainLink[] = [];
		// `groupRolloutsByApp` already sorts `cells` by `compareEnvironmentNames`.
		for (const cell of group.cells) {
			const tier = cell.environment?.spec?.environment || cell.envName;
			if (!tier || seen.has(tier)) continue;
			seen.add(tier);
			const link: ChainLink = {
				tier,
				// A production region prints its DISTINGUISHING segment. Twelve
				// chips reading `PROD-AP-SOUTH…` spend every character on the
				// token they have in common.
				label:
					getEnvironmentRank(tier) === 8
						? regionLabel(tier)
						: shortEnvLabel(cell.theme ?? tier) || tier,
				theme: cell.theme,
				current: tier === envName
			};
			(getEnvironmentRank(tier) === 8 ? regions : stages).push(link);
		}

		/**
		 * THE FAN-OUT COLLAPSES TO ONE COUNT CHIP — the LINE-vs-SET rule, and
		 * the reason this row survives `edge-mesh`.
		 *
		 * `edge-mesh` is bound to dev plus THIRTEEN production regions. Drawn
		 * as fourteen chips the chain wrapped to fourteen LINES at 1280 and the
		 * row grew to ~350px — the standing *"scale to many environments (4+
		 * prod regions) must not break the layout"* rule failing in the most
		 * literal way available.
		 *
		 * Regions are a SET: N copies of ONE promotion step, not N steps. So
		 * listing them states an order that does not exist AND spends a line
		 * each. They fold into `Chip role="count"` — the role `DESIGN.md`
		 * defines with the example `prod ×4` — so this is vocabulary the
		 * product already owns and it spends no new value.
		 *
		 * The region the reader is STANDING IN is never folded away: on
		 * `/envs/prod-af-south-1` the chain reads `DEV › AF-SOUTH-1 › +12
		 * regions`, so the one painted chip is still this page's own
		 * environment. That is the same invariant the highlight rule above
		 * states, held under collapse.
		 */
		if (regions.length === 0) return stages;
		if (regions.length === 1) return [...stages, regions[0]];

		const here = regions.find((r) => r.current);
		const folded = regions.filter((r) => r !== here);
		return [
			...stages,
			...(here ? [here] : []),
			{
				tier: '',
				label: here ? `+${folded.length} regions` : `${folded.length} regions`,
				theme: null,
				current: false,
				countTitle: folded.map((r) => r.tier).join(', ')
			}
		];
	}


	/**
	 * A CHART NEEDS A SHAPE, NOT A DATUM. Two bars in twelve buckets is a
	 * rendering glitch drawn at the size of data, restating a number printed
	 * 8px to its left. Same threshold `/apps/[name]` uses, for the same reason.
	 */
	const SPARK_MIN = 3;

	// ───────────────────────────── The modal ───────────────────────────────
	let modalOpen = $state(false);
	let modalRollout = $state<Rollout | null>(null);
	let modalVersion = $state<string | null>(null);
	let modalCluster = $state<string | undefined>(undefined);

	function openPromote(cell: AppCell, tag: string) {
		modalRollout = cell.rollout;
		modalVersion = tag;
		modalCluster = cell.sourceCluster || localClusterName || undefined;
		modalOpen = true;
	}
</script>

<svelte:head>
	<title>kuberik | {envName}</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	{#if query.isLoading}
		<div class="space-y-6">
			<div class="space-y-2">
				<div class="h-8 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
				<div class="h-4 w-1/3 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
			</div>
			<div class="h-20 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
			<div class="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
			<div class="h-56 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
		</div>
	{:else if query.isError}
		<div class="rounded-xl border border-gray-200 p-4 text-sm text-red-700 dark:border-gray-700 dark:text-red-400">
			Failed to load: {(query.error as Error).message}
		</div>
	{:else if !envExists}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<LayersSolid class="mb-3 h-10 w-10 text-gray-500 dark:text-gray-400" />
			<p class="t-body font-medium text-gray-900 dark:text-white">Environment not found</p>
			<p class="t-dense mt-1 max-w-sm text-gray-500 dark:text-gray-400">
				No <code class="t-code-sm rounded bg-gray-100 px-1 dark:bg-gray-800">Environment</code>
				resources reference <code class="t-code-sm rounded bg-gray-100 px-1 dark:bg-gray-800">{envName}</code>.
			</p>
			<a href="/environments" class="{BTN_DEFAULT} mt-4">
				<ArrowLeftOutline class="h-3.5 w-3.5" /> Back to environments
			</a>
		</div>
	{:else}
		<!-- ── HEADER ──────────────────────────────────────────────────────
		     §6: "Header (existing pattern): env label + namespace mono + meta
		     line ('N of M healthy', failed/active counts, last deploy ago +
		     DeployVolumeSparkline)."

		     ONE env chip, and it REPLACES a gray title-case restatement of the
		     identifier 3px to its left. It takes the SHORT label, and that was
		     measured rather than preferred: `PRODUCTION` rendered 82.2px and
		     231.6 presence against the `stuck` alarm's 199.8 — an identity mark
		     louder than the alarm, which is the one ceiling that may never be
		     crossed. `prod` renders 41.3px and 118.2. -->
		<div class="mb-6">
			<h1 class="flex min-w-0 flex-wrap items-baseline gap-x-3">
				<span class="t-display-id min-w-0 truncate text-gray-900 dark:text-white">{envName}</span>
				<Chip
					role="env"
					theme={slotTheme}
					label={envShort}
					title={envTitle ? `${envName} — ${envTitle}` : envName}
					wide class="self-center"
				/>
			</h1>
			<!-- THE META LINE. Failed and active counts print only when they are
			     non-zero — a `0 failing` on every healthy environment is the page
			     marking the norm — and the namespace prints only when the tier
			     HAS one (see `namespaces`). -->
			<p class="t-micro mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-500 dark:text-gray-400">
				<!-- THE SEPARATOR BELONGS TO THE CLAUSE THAT FOLLOWS IT, never to the
				     one before. `production environment` / `pipeline stage` sat in the
				     middle of this line and owned a trailing `·`; deleting the clause
				     left the dot behind and the line read `3 namespaces · · last
				     deploy 19m ago`. Leading separators cannot strand. -->
				{#if namespaces.length === 1}
					<span class="t-code-sm text-gray-500 dark:text-gray-400">{namespaces[0]}</span>
				{:else if namespaces.length > 1}
					<span>{namespaces.length} namespaces</span>
				{/if}
				<!-- ⛔ NO TIER CAPTION. `production environment` / `pipeline stage` was
				     a two-word gloss on the identity chip 26px above it, which already
				     prints the environment's own name in its own colour. THE HEALTH
				     COUNTS went the same way earlier and for the same reason: they were
				     prose here AND marks in the `Apps` tile, the same fact in two type
				     roles 60px apart. -->
				{#if lastDeployTs}
					{#if namespaces.length > 0}<span aria-hidden="true">·</span>{/if}
					<span title={formatDate(lastDeployTs)}
						>last deploy {formatTimeAgoCompact(lastDeployTs, $now)} ago</span
					>
				{/if}
				{#if deploys24h >= SPARK_MIN}
					<DeployVolumeSparkline
						rollouts={slots.map((s) => s.cell.rollout)}
						hours={24}
						buckets={12}
					/>
				{/if}
			</p>
		</div>

		<!-- ── METRICS STRIP ───────────────────────────────────────────────
		     §6: "A metrics strip card with: Apps count · Deploys 24h + spark ·
		     Median bake · Promotion rate. NO auto-promote toggle. NO env-level
		     upstream/current/downstream chain."

		     ⛔ THE EXPLANATORY PARAGRAPH IS DELETED (2026-08-27). §6 also asked,
		     verbatim, for "a short paragraph on the right of the metrics strip"
		     reading *"Each app defines its own promotion chain — see the inline
		     chips per row."* The human's instruction retires it:

		       *"We need to design dashboard in such a way that user's attention
		        is pulled in to where is necessary. Text doesn't cut it and just
		        pollutes."*

		     It was 260px of 12.5px prose whose entire job was to point at the
		     `Promotion chain` COLUMN — a column that is 300px to its lower left,
		     has its own header naming it, and prints the chips the sentence was
		     describing. Measured before deletion it was the THIRD loudest object
		     on `/envs/dev` (70.5 ink units light, 59.0 dark) — a paragraph
		     out-shouting every chip on a page whose job is to show what is
		     running. What now says "chains are per app" is the fact that each row
		     draws a different one.

		     A grid, not a flex row with `w-px` dividers: those were siblings in a
		     wrap container, so at 390px the strip broke 3+1 and left a rule
		     hanging with nothing after it. A grid needs no separators to read as
		     columns. With the paragraph gone the five tiles take the whole
		     width. -->
		<section class="{PANEL} mb-6 px-4 py-4">
			<div class="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
				<!-- APPS — the count, and nothing else. The gray tick strip and
				     its `1 stuck · 1 baking · 1 healthy` caption are gone; see the
				     tombstone in the script. The tile is now one of five that are
				     each a LABEL and a NUMBER, which is the only shape this strip
				     ever needed. -->
				<div class="min-w-0">
					<div class="t-label text-gray-500 dark:text-gray-400">Apps</div>
					<div class="t-headline mt-1 {STAT_QUIET}">{rows.length}</div>
				</div>
				<div class="min-w-0">
					<div class="t-label text-gray-500 dark:text-gray-400">Deploys · 24h</div>
					<div class="mt-1 flex items-baseline gap-2">
						<span class="t-headline {STAT_QUIET}">{deploys24h}</span>
						{#if deploys24h >= SPARK_MIN}
							<DeployVolumeSparkline
								rollouts={slots.map((s) => s.cell.rollout)}
								hours={24}
								buckets={12}
							/>
						{/if}
					</div>
				</div>
				<div class="min-w-0">
					<div class="t-label text-gray-500 dark:text-gray-400">Median bake</div>
					<div class="t-headline mt-1 {STAT_QUIET}" title="Median measured bake window across this environment's deploy history">
						{medianBakeMs === null ? '—' : formatDurationMs(medianBakeMs)}
					</div>
				</div>
				<div class="min-w-0">
					<div class="t-label text-gray-500 dark:text-gray-400">Promotion rate</div>
					<div
						class="t-headline mt-1 {STAT_QUIET}"
						title="Share of apps here running their app's newest build"
					>
						{promotionRate === null ? '—' : `${promotionRate}%`}
					</div>
				</div>
			</div>
		</section>

		<!-- ── BODY: app list + right rail ─────────────────────────────────
		     §6: "Right rail: existing activity timeline scoped to this env."
		     Same `ActivityRail` `/apps/[name]` and `/namespaces/[name]` use, so
		     it is not a new object — and it carries the one dimension the list
		     beside it cannot: WHEN each app moved, and what it moved from.
		     `showEnv` is false because every row here is this environment; a
		     chip identical on every row is a mark that marks nothing. -->
		<!-- TWO COLUMNS FROM `xl`, NOT `lg`. Measured at 1280 with the 176px
		     sidebar: a 300px rail left the app list 732px, and seven tracks
		     inside 732px pushed a three-stage promotion chain onto two lines and
		     squeezed the build badge into an ellipsis. The list needs ~1050px
		     before a rail beside it is affordable, so between `lg` and `xl` the
		     rail moves BELOW the list at full width instead — it loses nothing
		     but its adjacency, and the list keeps every column legible. -->
		<div class="xl:grid xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start xl:gap-6">
			<section class="mb-6 min-w-0 xl:mb-0">
				<!-- `Running now`, not `Running now in PROD`. The environment is
				     named by the `h1`, by the identity chip beside it and by the
				     breadcrumb — three times above the fold — so the trailing
				     `in <ENV>` was the section head restating the page. -->
				<h2 class="t-label mb-3 text-gray-500 dark:text-gray-400">Running now</h2>
				<div class="{PANEL} overflow-hidden">
					{#if rows.length === 0}
						<div class="t-dense px-4 py-10 text-center text-gray-500 dark:text-gray-400">
							No apps deployed to {envName} yet.
						</div>
					{:else}
						<div
							class="t-label hidden border-b border-gray-200 px-4 py-3 text-gray-500 lg:grid {ROW_GRID} gap-x-3 dark:border-gray-700 dark:text-gray-400"
						>
							<span></span>
							<span>App</span>
							<span>Promotion chain</span>
							<span>Build</span>
							<span>Age</span>
							<span></span>
						</div>
						<!-- `gray-200`, NOT `gray-100`. `/apps/[name]` draws the seams
						     between its task rows in `divide-gray-200` and this page drew
						     the seams between its app rows one step lighter, so the two
						     detail pages spent two different values on the same hairline
						     and this page carried a light-theme value that appears nowhere
						     else on it. Dark was already agreed at `gray-700`. -->
						<ul class="divide-y divide-gray-200 dark:divide-gray-700">
							{#each rows as row (row.key)}
								{@const chain = chainFor(row.slot.group)}
								<!-- MOBILE IS A LAYOUT, NOT A FALLBACK. Below `lg` the row is
								     `24px │ 1fr │ auto` and every cell is placed EXPLICITLY:
								     line 1 app + age, line 2 the chain, line 3 the build badge,
								     line 4 the action. Nothing is left to auto-flow, because
								     that is how the build badge previously fell into the glyph
								     gutter and clipped its own rank word to `NE…`. -->
								<li
									class="grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-4 py-3 lg:items-center {ROW_GRID} hover:bg-gray-50 dark:hover:bg-gray-700/30"
								>
									<!-- STATUS CIRCLE — the repo's atom, exactly as
									     `RolloutGrid.svelte` draws it: the neutral ground disc
									     from `getStatusCircleClass()` with `BakeStatusIcon`'s
									     COLOURED glyph inside. Succeeded is a GREEN check, baking
									     a YELLOW pulse, deploying a BLUE spinner, failed a RED
									     exclamation, never-deployed a gray pause. Baking and
									     Deploying are different states and may never share a
									     hue — the component is what keeps that true everywhere. -->
									<span
										class="col-start-1 row-start-1 {STATUS_CIRCLE} {getStatusCircleClass(row.status)}"
										title={stateLabel(row.status)}
									>
										<BakeStatusIcon bakeStatus={row.status} size="small" />
									</span>

									<!-- APP -->
									<div class="col-start-2 row-start-1 flex min-w-0 flex-col gap-1">
										<div class="flex min-w-0 flex-wrap items-center gap-2">
											<a
												href={rolloutHref(row.slot.cell)}
												class="t-code min-w-0 truncate text-gray-900 hover:underline dark:text-white"
												>{row.appName}</a
											>
											{#if row.slot.cell.rollout.spec?.wantedVersion}
												<PinBadge version={row.slot.cell.rollout.spec.wantedVersion} size="xs" />
											{/if}
											{#if row.stuck}
												<Chip role="alarm" label="stuck" title="{row.appName} is stuck here" />
											{/if}
										</div>
										<!-- CRITERION 3 — *"what's mid-rollout in this env?"* — is
										     answered by the status circle 12px to the left, in the
										     BLUE and YELLOW the whole product uses for it, and by
										     the row's position: `severity` sorts in-flight rows
										     above settled ones. It is NOT answered again in words.
										     See the `Row` type. What is left here is the app's own
										     OCI title, and only when it differs from its name. -->
										{#if row.title}
											<span class="t-micro truncate text-gray-500 dark:text-gray-400"
												>{row.title}</span
											>
										{/if}
									</div>

									<!-- AGE -->
									<div class="col-start-3 row-start-1 justify-self-end lg:col-start-5 lg:row-start-1 lg:justify-self-start">
										{#if row.timestamp}
											<span
												class="t-micro text-gray-500 dark:text-gray-400"
												title={formatDate(row.timestamp)}
												>{formatTimeAgoCompact(row.timestamp, $now)}</span
											>
										{:else}
											<span class="t-micro text-gray-500 dark:text-gray-400">—</span>
										{/if}
									</div>

									<!-- PER-APP PROMOTION CHAIN. See `chainFor`. The current env
									     is the one PAINTED chip and it wears its own identity
									     colour; the rest are neutral. A single-env app renders that
									     one chip alone — no sentence, no chevron. -->
									<div class="col-start-2 col-end-4 row-start-2 min-w-0 lg:col-start-3 lg:col-end-4 lg:row-start-1">
										{#if chain.length === 0}
											<span></span>
										{:else}
											<div class="flex min-w-0 flex-wrap items-center gap-1">
												{#each chain as link, i (link.tier || `set-${i}`)}
													{#if link.current}
														<Chip
															role="env"
															theme={link.theme}
															label={link.label}
															title="{link.tier} — this page"
															wide class="shrink-0"
														/>
													{:else if link.tier}
														<a href="/envs/{encodeURIComponent(link.tier)}" class="shrink-0">
															<Chip
																role="count"
																label={link.label}
																title={link.tier}
																wide
															/>
														</a>
													{:else}
														<!-- THE FOLDED FAN-OUT, and it is deliberately NOT a
														     link: it stands for a SET, and there is no
														     `/envs/` route for a set. The tooltip names every
														     environment it folds, so nothing is hidden — only
														     un-listed. -->
														<Chip
															role="count"
															label={link.label}
															title={link.countTitle ?? link.label}
															wide class="shrink-0"
														/>
													{/if}
													{#if i < chain.length - 1}
														<ChevronRightOutline
															class="h-3 w-3 shrink-0 text-gray-500 dark:text-gray-400"
															aria-hidden="true"
														/>
													{/if}
												{/each}
											</div>
										{/if}
									</div>

									<!-- BUILD — the WORD inside the box varies, and so does the
									     number of HALVES. `head` is the same gray as `count`, so
									     the norm spends no colour and the only coloured token in
									     this column is the deviation.

									     ⛔ THE `pending` ROW HAS NO VALUE HALF, AND IT USED TO HAVE
									     A DIMMED EM DASH (2026-08-28). `value="—" valueDim` drew a
									     placeholder at reduced opacity — the DIM-INSTEAD-OF-EXPLAIN
									     pattern the human rejected on the revisions pages, where
									     replacing it with structure turned out strictly better.
									     Here the em dash said "no build" and the word one pixel to
									     its left already said `pending`: one fact, two encodings,
									     one of them spelled as an absence of ink. The fix is the
									     same one the revisions pages took — carry the distinction
									     by STRUCTURE. A row that has a build renders a JOINED box
									     with two halves; a row that has none renders a LONE chip
									     with one. The column's own shape is now the signal, and it
									     is legible at a glance down the track in a way a 60%-alpha
									     em dash never was. This was the LAST `valueDim` call site
									     outside `RolloutGrid.svelte`. -->
									<div class="col-start-2 col-end-4 row-start-3 flex min-w-0 items-center lg:col-start-4 lg:col-end-5 lg:row-start-1">
										{#if !row.version}
											<Chip
												role="unranked"
												label="pending"
												title="No deploy yet"
												class="min-w-0"
											/>
										{:else if rankRole(row.rank) && row.rank.kind !== 'newest'}
											<Chip
												role={rankRole(row.rank) ?? 'rank'}
												label={rankLabel(row.rank) ?? ''}
												title={row.rank.kind === 'diverged'
													? 'Running a build that is on no environment’s release list'
													: `${rankBehindBy(row.rank)} build${rankBehindBy(row.rank) === 1 ? '' : 's'} behind the newest`}
												value={row.version}
												valueHref={row.versionHref}
												class="min-w-0"
											/>
										{:else}
											<Chip
												role="head"
												label="head"
												title="{row.version} — the newest build this app has"
												value={row.version}
												valueHref={row.versionHref}
												class="min-w-0"
											/>
										{/if}
									</div>

									<!-- ACTION — ONE button, adverse rows only, at every width.
									     No hover-reveal anywhere on this page: `.row-reveal` lives
									     inside a `min-width:1024px` media query, so it hides
									     nothing on a phone, and a control designed to appear on
									     hover is permanently on wherever hover does not exist.

									     `promoteTag` is `newestDeployableCandidate`: the newest
									     build EVERY gate has already allowed. An offer that would
									     be refused is worse than no offer, so a blocked row gets
									     the gates link instead. -->
									{#if row.adverse}
										<div
											class="col-start-2 col-end-4 row-start-4 flex-wrap items-center gap-2 lg:col-start-6 lg:col-end-7 lg:row-start-1 lg:flex lg:justify-end {row.primary
												? 'flex'
												: 'hidden lg:flex'}"
										>
											{#if row.promoteTag}
												<button
													type="button"
													class={row.primary ? BTN_PRIMARY : BTN_DEFAULT}
													onclick={() => openPromote(row.slot.cell, row.promoteTag!)}
													title="Deploy the newest build every gate allows"
												>
													Promote
												</button>
											{:else}
												<a
													href={rolloutHref(row.slot.cell)}
													class={row.primary ? BTN_PRIMARY : BTN_DEFAULT}
												>
													{row.block.blockingGates.length > 0 ? 'Review gates' : 'Open rollout'}
												</a>
											{/if}
										</div>
									{:else}
										<div class="hidden lg:col-start-6 lg:row-start-1 lg:block"></div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</section>

			{#if rows.length > 0}
				<div class="min-w-0">
					<ActivityRail
						rollouts={slots.map((s) => s.cell.rollout)}
						{environments}
						limit={8}
						showEnv={false}
						activityHref={`/activity?env=${encodeURIComponent(envName)}`}
						{localClusterName}
					/>
				</div>
			{/if}
		</div>

		<ChangeVersionModal
			bind:open={modalOpen}
			rollout={modalRollout}
			isPinVersionMode={false}
			initialSelectedVersion={modalVersion}
			cluster={modalCluster}
		/>
	{/if}
</div>
