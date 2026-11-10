<svelte:options runes={true} />

<script lang="ts">
	import { placeKeyOf } from '$lib/view-models/sites-waves';
	import { displayTimeZone } from '$lib/timezone.svelte';
	import { startOfDayMs, zonedYMD, formatClockTime } from '$lib/display-time';
	import { getDisplayVersion } from '$lib/utils';
	import {
		getRolloutEnvironmentTheme,
		getEnvironmentThemeStyle,
		shortEnvLabel
	} from '$lib/environment-theme';
	import { rolloutPath, sourceClusterName } from '$lib/source-dashboard';
	import { now } from '$lib/stores/time';
	import ActivityDayHeader from './ActivityDayHeader.svelte';
	import ActivitySentence from '$lib/components/ActivitySentence.svelte';
	import { actorFrom, type Actor } from '$lib/actor';
	import type { ActivityKind } from '$lib/view-models/activity-verb';
	import { activityKindOf } from '$lib/view-models/activity-kind';
	import { getEnvironmentRank } from '$lib/env-order';
	import type { Rollout, Environment } from '../../types';
	import { changeBuildPath, repoKeyFromSource } from '$lib/version-utils';
	import { deployActs, type DeployAct } from '$lib/history-marks';
	import { historyEntrySince } from '$lib/view-models/event-age';

	/** The one member of `DeployAct` this rail ever attaches to a row. */
	type RollbackAct = Extract<DeployAct, { kind: 'rollback' }>;

	let {
		rollouts,
		environments = [],
		limit = 20,
		activityHref = '/activity',
		localClusterName = '',
		showAppName = true,
		showEnv = true,
		chrome = true,
		collapseAfter = null,
		maxEntries = null,
		avatarFor = () => undefined
	}: {
		rollouts: Rollout[];
		environments?: Environment[];
		limit?: number;
		activityHref?: string;
		/**
		 * False on a page already scoped to ONE environment. Same rule as
		 * `showAppName`, applied to the other axis: `/envs/prod` reached via an
		 * `h1` and a URL that both say `prod` was printing a PROD chip on every
		 * row of the rail. A chip that is identical on every row is a mark that
		 * cannot mark anything.
		 */
		showEnv?: boolean;
		/**
		 * ⚠️ DEPRECATED, KEPT AS A NO-OP (D-6, 2026-10-08 polish pass). This used
		 * to gate a PRIVATE drawing of the exact region `Card` already owns —
		 * this component's own `t-label` caption floating above its own
		 * bordered box, the "caption over a box" shape
		 * `COMPOSITION-GRAMMAR.md` names as what every rejected page is built
		 * from. Every call site (`/`, `/apps`, `/apps/<name>`, `/envs/<name>`,
		 * `/namespaces/<name>`) now wraps this component in a real `Card` and
		 * passes `chrome={false}`, so the private header/box had no caller
		 * left — removed rather than migrated. The prop stays, accepted and
		 * ignored, so an un-migrated `chrome={false}` passed from another
		 * lane's file does not need a matching edit here.
		 */
		chrome?: boolean;
		/**
		 * False on a page already scoped to ONE app. The app-detail page reached
		 * via a breadcrumb, an `h1` and a URL that all say `hello-world-app` was
		 * repeating that string 8 more times down the rail — the row restating
		 * the one fact its container already guarantees. Env detail and
		 * namespace detail DO need it, because those rails span many apps.
		 */
		showAppName?: boolean;
		// Cluster to route to when a rollout carries no source-cluster
		// annotation (e.g. a single-cluster dashboard, or a detail fetch that
		// doesn't stamp cross-cluster provenance).
		localClusterName?: string;
		/**
		 * ⭐ PROGRESSIVE DISCLOSURE FOR THE TAIL — `COMPOSITION-GRAMMAR.md` §8.
		 * Rows past this index sit behind one control.
		 *
		 * DEFAULT `null` (off) AND THAT IS DELIBERATE, not an omission. Of the
		 * three call sites, `/apps/[name]` ALREADY owns this control — it
		 * swaps `limit` between `ACTIVITY_SHOWN` and 40 and prints
		 * `Show N earlier deploys ›` itself — so turning it on by default
		 * would put two disclosures on one card and let the inner one
		 * re-collapse a list the reader had just expanded. `/envs/[name]`
		 * passes `limit={8}`, which is already the fold. `/namespaces/[name]`
		 * asks for 20 and is the one that needed it.
		 */
		collapseAfter?: number | null;
		/**
		 * Overrides `AUTO_CAP_ENTRIES` for a caller whose subject column is
		 * shorter than the default 6-row ceiling leaves room for. `null`
		 * (default) keeps the unmodified auto-cap. See the note on
		 * `effectiveCapEntries` below.
		 */
		maxEntries?: number | null;
		/** The signed-in account's picture, for its own rows (`actorFrom`'s `src`). */
		avatarFor?: (login: string) => string | undefined;
	} = $props();

	type ActivityEntry = {
		rolloutName: string;
		rolloutNamespace: string;
		displayName: string;
		envName: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		version: string;
		/**
		 * The git revision behind `version`. Carried so the link can be keyed by
		 * REVISION — `/versions` groups by commit now, and a display label is
		 * per-service, so linking by label would land on a page that has to
		 * resolve it back. null when the deploy carried no revision annotation.
		 */
		revision: string | null;
		previousVersion: string | null;
		bakeStatus: string;
		timestamp: string;
		href: string;
		isRunning: boolean;
		source: string | null;
		/**
		 * ⭐ THIS ROW IS THE ROLLOUT'S CURRENT DEPLOY — its newest history
		 * entry, i.e. what is running in that place RIGHT NOW. Still used to
		 * weight the name (the live row leads); no rank is attached to it
		 * any more — see the design-language course-correction note on
		 * `versionSnippet` below.
		 */
		isLive: boolean;
		rollout: Rollout;
		/**
		 * ⭐ WHETHER *THIS* HISTORY ENTRY WENT BACKWARDS — `history-marks.ts`'s
		 * per-index verdict, not `rollout-cards.ts`'s `detectRollback`.
		 * `detectRollback` only ever answers for the CURRENT deploy
		 * (`history[0]` vs `[1]`), so a rollback that has since been
		 * auto-corrected forward again (the live cluster's own
		 * `hello-world-dev/hello-world-app`) goes invisible the moment the
		 * correction lands — on the ROW where it actually happened. A rail
		 * that prints history has to answer this per row, the same way the
		 * History tab already does.
		 */
		rollbackAct: RollbackAct | null;
		/** Who did it (a person, CI, or the controller): the sentence's subject. */
		actor: Actor;
		/** What it was, in the one vocabulary (`activityKindOf`). */
		kind: ActivityKind;
	};

	/**
	 * ⭐ THE RELATIVE VERSION, AND THE FENCE AROUND IT. (2026-09-01, amended
	 * 2026-10-08)
	 *
	 * The rail printed ten rows of `<env> <old> → <new> <time>` with no
	 * relative signal at all, against `DESIGN-INTENT.md`'s standing rule that
	 * *relative version beats absolute*. The obvious fix — a rank beside every
	 * sha — is FORBIDDEN, and the reason is in `env-rank.ts`: a rank is a fact
	 * about an ENVIRONMENT'S UPGRADE PATH AS IT IS NOW, never a fact about a
	 * build. A deploy that happened on Tuesday has no distance from today's
	 * head; asking for one produces a number that changes every time some
	 * OTHER rollout deploys, attached to a row that has not moved.
	 *
	 * ⛔ SO THE `caught up to newest` MARK ON HISTORICAL ROWS IS REFUSED, and
	 * it is worth saying why rather than just not doing it. It looks safe —
	 * "this deploy reached the frontier build" is past tense and sounds like a
	 * fact about the deploy. It is not one. The frontier moves, so the
	 * predicate is evaluated against TODAY's ladder and then printed on a row
	 * dated Tuesday; and because a rollout's history contains many builds that
	 * were frontier-at-the-time, the mark would land on several rows of one
	 * rollout at once. That is precisely the `same sha, two numbers on
	 * adjacent rows` defect `env-rank.ts` was written to end, reintroduced one
	 * level down and in a prettier font.
	 *
	 * ⭐ DESIGN-LANGUAGE COURSE CORRECTION (2026-10-08) — AND NOW THE LIVE
	 * ROW'S RANK CHIP IS GONE TOO. A row already spends its two allowed
	 * emphases on the NAME and ONE state word; a joined rank chip on the
	 * live row was a third. `rankVerdictsByRollout` and its per-row lookup
	 * are no longer read here at all — `versionSnippet` below reads plain
	 * `old → new` text on every row, live or not, which also means "this is
	 * what is running" is carried by the row's OWN position (sorted newest
	 * first, one row per rollout) rather than a second encoding.
	 */
	const allEntries = $derived.by<ActivityEntry[]>(() => {
		const list: ActivityEntry[] = [];
		for (const r of rollouts) {
			const history = r.status?.history ?? [];
			let seenNewest = false;
			const env = environments.find(
				(e) =>
					e.metadata?.namespace === r.metadata?.namespace &&
					e.spec?.rolloutRef?.name === r.metadata?.name
			);
			const envName = env ? placeKeyOf(env, environments) : '';
			const theme = env ? getRolloutEnvironmentTheme(r, env) : getRolloutEnvironmentTheme(r);
			// Index-aligned with `history` — see `RollbackAct` above.
			const acts = deployActs(r);
			for (let i = 0; i < history.length; i++) {
				const h = history[i];
				if (!h.timestamp) continue;
				const act = acts[i];
				const rollbackAct = act?.kind === 'rollback' ? act : null;
				const ver = getDisplayVersion(h.version);
				let prev: string | null = null;
				for (let j = i + 1; j < history.length; j++) {
					const v = getDisplayVersion(history[j].version);
					if (v && v !== ver) {
						prev = v;
						break;
					}
				}
				const bs = h.bakeStatus || 'None';
				const actor = actorFrom(
					h.triggeredBy,
					h.triggeredBy?.name ? avatarFor(h.triggeredBy.name) : undefined
				);
				// The FIRST entry with a timestamp is the current deploy. Not
				// `i === 0`: the loop skips entries the controller wrote with no
				// timestamp, and one of those at the head would silently move
				// `live` onto the second-newest row.
				const isLive = !seenNewest;
				seenNewest = true;
				list.push({
					rolloutName: r.metadata?.name ?? '',
					rolloutNamespace: r.metadata?.namespace ?? '',
					displayName: r.metadata?.name ?? '',
					envName,
					theme,
					version: ver,
					revision: h.version?.revision ?? null,
					previousVersion: prev,
					bakeStatus: bs,
					// ⭐ shared/age-lag-total: ONE AGE PER EVENT. A Failed row used to
					// show the deploy's own START (`h.timestamp`) — the third of the
					// four disagreeing instants the coordinator's blind read found
					// (10:26 here vs the failure's own bakeEndTime everywhere else).
					// `historyEntrySince` is `bakeEndTime ?? timestamp`, the SAME
					// formula `pr-pipeline.ts`'s `failed` cell and `event-age.ts`'s
					// `eventAge('failed', …)` both read — every other status keeps
					// its own start unchanged (bakeEndTime is only ever read for a
					// concluded, failed attempt).
					timestamp: bs === 'Failed' ? historyEntrySince(h) ?? h.timestamp : h.timestamp,
					href: rolloutPath(
						sourceClusterName(r) || localClusterName,
						r.metadata?.namespace ?? '',
						r.metadata?.name ?? ''
					),
					isRunning: bs === 'InProgress' || bs === 'Deploying',
					source: r.status?.source ?? null,
					isLive,
					rollout: r,
					rollbackAct,
					actor,
					kind: activityKindOf({
						bakeStatus: bs,
						bakeStatusMessage: h.bakeStatusMessage,
						isRollback: !!rollbackAct,
						actorKind: actor.kind,
						envRank: getEnvironmentRank(envName),
						firstEnvRank: Math.min(firstRank.get(r.metadata?.name ?? '') ?? Infinity, getEnvironmentRank(envName))
					})
				});
			}
		}
		list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
		return list;
	});
	const entries = $derived(allEntries.slice(0, limit));

	/**
	 * Each app's FIRST environment (its lowest rank across the rollouts given):
	 * the controller acting there deployed; acting anywhere later it promoted.
	 */
	const firstRank = $derived.by(() => {
		// Over EVERY Environment of the app (not only the rollouts this rail was
		// handed — an env page's rail holds one stage, and its controller
		// deploys there are still promotions).
		const m = new Map<string, number>();
		const put = (name: string, env: string) => m.set(name, Math.min(m.get(name) ?? Infinity, getEnvironmentRank(env)));
		for (const e of environments) {
			const name = e.spec?.rolloutRef?.name;
			if (name && e.spec?.environment) put(name, e.spec.environment);
		}
		for (const r of rollouts) {
			const name = r.metadata?.name ?? '';
			if (!m.has(name)) m.set(name, Infinity);
		}
		return m;
	});

	/** Per-day totals over the whole history given (not just the rows shown). */
	const dayTotals = $derived.by(() => {
		// `open` = failures whose rollout is STILL failed (its newest history
		// entry is the failure) — the only ones drawn in danger ink. A resolved
		// past failure still counts, in neutral ink (coordinator ruling,
		// 2026-10-10; the same predicate DeployBars' `resolved` uses).
		const m = new Map<string, { n: number; failed: number; open: number }>();
		for (const a of allEntries) {
			const k = dayKey(a.timestamp);
			const t = m.get(k) ?? { n: 0, failed: 0, open: 0 };
			t.n++;
			if (a.kind === 'failed') {
				t.failed++;
				// Open only if THIS failure is the rollout's current state (its newest
				// entry): an older failure stays resolved even when a newer one failed.
				if (a.isLive) t.open++;
			}
			m.set(k, t);
		}
		return m;
	});
	const busiestDay = $derived(Math.max(1, ...[...dayTotals.values()].map((t) => t.n)));

	type DayGroup = { label: string; key: string; entries: ActivityEntry[] };
	function dayKey(ts: string): string {
		const d = new Date(ts);
		const { year, month, day } = zonedYMD(d);
		return `${year}-${month}-${day}`;
	}
	function dayLabel(ts: string, refNow: Date): string {
		const d = new Date(ts);
		const days = Math.round((startOfDayMs(refNow) - startOfDayMs(d)) / 86_400_000);
		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		const timeZone = displayTimeZone();
		if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long', timeZone });
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone });
	}
	// D-10/D-17 (2026-10-08, "system" lane): was `toLocaleTimeString(undefined,
	// {hour,minute})` with no `hour12: false` — locale-default 12h, which is
	// why this rail printed `07:12 AM` beside the History tab's 24h `Oct 8,
	// 06:49` for the same field, and why the two-letter suffix wrapped onto
	// its own line at 390 (D-10). `display-time.ts`'s `formatClockTime` is
	// the one 24h clock formatter now; this call site inherits it.
	function hourLabel(ts: string): string {
		return formatClockTime(ts);
	}

	/**
	 * ── THE TAIL, BEHIND ONE CONTROL ───────────────────────────────────────
	 * `COMPOSITION-GRAMMAR.md` §8: *"the card states its rollup, lists what
	 * matters, and hides the tail behind one control. It does not print all
	 * ten rows, and it does not omit them."* Twenty identical rows is the
	 * spreadsheet shape by itself, whatever the rows say.
	 */
	let expanded = $state(false);

	/**
	 * ⭐ THE RAIL IS A PREVIEW, NOT THE PAGE. (DESIGN PASS 2, defect #3)
	 *
	 * Measured column-bottom deltas at 1440×900: `/apps` 576 vs the rail's
	 * 1105 (Δ529), `/envs/prod` 628 vs 1097 (Δ469), `/` 545 vs 913 (Δ368).
	 * The subject the rail sits beside finishes and the rail runs on for
	 * another half-viewport, because `limit={8}` still lets a busy day (the
	 * live cluster's own rollback storm) fill the whole card with one day
	 * group. `View all activity ›` already sits in every caller's header —
	 * `HomeRail`'s own `rollup` snippet above, and the equivalent on `/apps`,
	 * `/envs/[name]` — so the rail does not need its own escape hatch; it
	 * needs a HARD ceiling.
	 *
	 * ⛔ NOT APPLIED WHEN THE CALLER ALREADY MANAGES ITS OWN FOLD
	 * (`collapseAfter` is set — `/namespaces/[name]`'s `collapseAfter={8}`,
	 * unmeasured by this defect and left exactly as it renders today) OR
	 * WHEN THIS IS THE APP-DETAIL PAGE'S MAIN COLUMN
	 * (`showAppName === false` — the one call site, `/apps/[name]`, that is
	 * not a narrow side rail at all: it IS the page's primary content, reads
	 * `activityLimit` and draws its own `Show N more deploys ›` control
	 * below this component. A second, tighter cap sitting inside it would be
	 * a SECOND disclosure over the same list — the exact defect
	 * `collapseAfter`'s own default-null note above already refuses.
	 * `showAppName={false}` is unique to that one call site: every rail that
	 * spans more than one app needs the app name on each row, so it is a
	 * reliable proxy for "this is a page, not a rail" without editing the
	 * route files this pass does not own.
	 *
	 * BOUNDED ON TWO AXES AT ONCE, whichever is hit first: at most
	 * `AUTO_CAP_ENTRIES` rows, and at most `AUTO_CAP_DAYS` day-groups — a
	 * single busy day must not alone fill the whole card past one viewport.
	 */
	const AUTO_CAP_ENTRIES = 6;
	const AUTO_CAP_DAYS = 2;
	/**
	 * ⭐ THE DEFAULT CEILING WAS STILL TOO GENEROUS ON THREE PAGES. (2026-09-03,
	 * design pass 9 re-check, F5) `/apps`, `/envs/<name>` and `/namespaces/<name>`
	 * all measured a rail ~1.9x the height of the subject column beside it —
	 * `AUTO_CAP_ENTRIES` bounds a single busy DAY, but a rail spanning 2 quieter
	 * days can still print more rows than the subject beside it has. `maxEntries`
	 * is the caller's own tighter number, read only where it is set; every other
	 * call site (`/`, via `HomeRail`) is byte-identical, since `null` falls
	 * through to the unmodified `AUTO_CAP_ENTRIES`.
	 */
	const effectiveCapEntries = $derived(maxEntries ?? AUTO_CAP_ENTRIES);
	const autoCapApplies = $derived(collapseAfter === null && showAppName !== false);
	const autoCapped = $derived.by<ActivityEntry[]>(() => {
		if (!autoCapApplies) return entries;
		const out: ActivityEntry[] = [];
		const daysSeen = new Set<string>();
		for (const a of entries) {
			if (out.length >= effectiveCapEntries) break;
			const key = dayKey(a.timestamp);
			if (!daysSeen.has(key)) {
				if (daysSeen.size >= AUTO_CAP_DAYS) break;
				daysSeen.add(key);
			}
			out.push(a);
		}
		return out;
	});

	const shown = $derived(
		collapseAfter === null ? autoCapped : expanded ? entries : entries.slice(0, collapseAfter)
	);
	const hiddenCount = $derived(entries.length - shown.length);

	const byDay = $derived.by<DayGroup[]>(() => {
		const refNow = $now;
		const map = new Map<string, DayGroup>();
		for (const a of shown) {
			const key = dayKey(a.timestamp);
			let g = map.get(key);
			if (!g) {
				g = { label: dayLabel(a.timestamp, refNow), key, entries: [] };
				map.set(key, g);
			}
			g.entries.push(a);
		}
		return Array.from(map.values());
	});

	/**
	 * THE DAY'S ANSWER, HARD RIGHT — the same rollup shape every card header in
	 * the product carries, at group-header scale. It used to be a bare count,
	 * which states the denominator and nothing else. The failure clause prints
	 * ONLY when there is one: marking the norm on every group is how a rollup
	 * becomes furniture.
	 */
	function dayRollup(list: ActivityEntry[]): { count: number; failed: number } {
		return { count: list.length, failed: list.filter((a) => a.bakeStatus === 'Failed').length };
	}

	// Same status ink as `BakeStatusIcon` (-700 light / -400 dark). The rail
	// used to carry a lighter green, a SECOND green in a product allowed
	// exactly one; red/yellow/blue had the same drift. Status hue is owned by
	// the glyph scale, so the dots read from it rather than near it.
	/**
	 * ⛔ THE RAIL SPEAKS `/activity`'S VOCABULARY NOW, NOT ITS OWN. (2026-08-30)
	 *
	 * This was a sixth private copy of the status words, and `InProgress` in it
	 * read `Baking` — the product's own CRD field name, printed to a reader, on
	 * `/apps/[name]`, `/envs/[name]` and `/namespaces/<ns>`. The word is
	 * `bake-status.ts`'s one table now.
	 *
	 * ⚠️ AND THE WHOLE TABLE GOES, NOT JUST THAT ONE ROW. Swapping only
	 * `Baking` would leave `checking` in a column that also prints `Failed` and
	 * `Cancelled`, i.e. one register inside one list. The register difference
	 * IS the drift: `/activity` renders the identical rail rows as
	 * `deploy failed` / `deploying` / `stopped`, and two objects describing one
	 * event in two registers is what "assembled, not designed" looks like.
	 * (`/activity` said `going live` there until 2026-08-30; the last private
	 * spelling on that page now goes through `BAKE_WORD` like the rest.)
	 * `Succeeded` is never reached — the row below is guarded on it, because
	 * the green dot has already said so.
	 */
	function isRunning(s: string) {
		return s === 'InProgress' || s === 'Deploying';
	}
</script>

<!-- The `prev -> new` pair. ONE ITEM IN THE ROW'S OWN SENTENCE now (see the
     row markup below) — not pinned to either line by its own margin. One
     snippet so the two `showAppName` layouts cannot drift apart.

     ⭐ ON THE LIVE ROW THE `new` HALF BECOMES THE JOINED `[verdict][sha]` CHIP —
     the same unit `/` and `/rollouts` draw, from the same `env-rank.ts`. On
     every other row it stays a plain sha, because a rank on a superseded
     deploy is a claim nobody can make. See `ranks`.

     ⛔ `ml-auto` IS GONE. (2026-09-03, UX-walk finding 2, re-check) It held
     this pair flush right against the OLD line 2, which is what let it sit
     on its own mostly-empty line while line 1 opened a 636–677px hole above
     it. It is a plain flow item now, joining the sentence right after the
     status word / rollback mark, exactly where `/activity`'s own version
     pair sits in its row. -->




<section>
	<!-- ⭐ D-6 (2026-10-08, polish pass). The header+box this used to draw for
	     itself under `{#if chrome}` is deleted, not migrated: every caller
	     already wraps this component in `Card` and supplies `Card`'s own
	     icon, title and `rollup` snippet (`.nav-link`, the same control this
	     block used to hand-draw). `chrome`/`activityHref` stay as accepted,
	     ignored props — see the doc comment above — so this is content-only
	     from here down, same reference `Card`'s body slot already is on
	     `/apps/[name]`'s Recent activity card. -->
	<div>
		{#if entries.length === 0}
			<div class="flex flex-col items-center px-4 py-10 text-center">
				<div
					class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-subtle"
				>
					<span class="block h-2 w-2 rounded-full bg-line-strong"></span>
				</div>
				<p class="t-body text-fg-muted">No activity yet</p>
				<p class="t-meta mt-1 text-fg-subtle">
					Deployments will appear here as a timeline.
				</p>
			</div>
		{:else}
			<div class="p-4">
				{#each byDay as group, gi}
					{@const roll = dayRollup(group.entries)}
					{@const t = dayTotals.get(group.key) ?? { n: roll.count, failed: roll.failed, open: roll.failed }}
					<div class={gi > 0 ? 'mt-5' : ''}>
						<!-- THE GROUP HEADER IS A HEADER: an icon, the label, and a
						     right-aligned rollup. `COMPOSITION-GRAMMAR.md` §1 and §3 — the
						     page the human calls beautiful carries 115 icons and this rail
						     carried none. The clock/calendar pair is the one `/activity`
						     already spends on the same distinction. -->
						<!-- The day: its label, ONE single-fill volume bar (share of the
						     busiest day shown) and "N deploys · M failed" — failures in
						     words and danger ink, never a red segment, omitted at 0. -->
						<ActivityDayHeader label={group.label} count={t.n} busiest={busiestDay} failed={t.failed} open={t.open} />
						<!-- ⭐ ONE ACTIVITY ROW PRODUCT-WIDE (squad-fleet, AD round 0 #2 /
						     round 2 #4): every rail renders the shared sentence —
						     avatar · actor verb app · env · old → new · time — never its
						     own dialect. A page scoped to one app passes
						     showAppName={false} (the app is implied); showEnv={false}
						     drops the env chip on a page scoped to one environment.
						     Consecutive rows by the same actor collapse to the avatar. -->
						<ol class="flex flex-col gap-3">
							{#each group.entries as a, ai}
								<li class="environment-theme-scope" style={a.theme ? getEnvironmentThemeStyle(a.theme) : undefined}>
									<ActivitySentence
										actor={a.actor}
										kind={a.kind}
										app={showAppName ? a.displayName : null}
										appHref={showAppName ? a.href : null}
										env={showEnv ? shortEnvLabel(a.theme) || a.envName || a.theme?.label || null : null}
										theme={a.theme}
										from={a.previousVersion}
										to={a.version}
										toHref={a.version ? changeBuildPath(repoKeyFromSource(a.source, a.rolloutName), a.revision, a.version) : null}
										time={hourLabel(a.timestamp)}
										href={a.href}
										live={a.isLive}
										compact
										repeatActor={showAppName &&
											ai > 0 &&
											group.entries[ai - 1].actor.kind === a.actor.kind &&
											group.entries[ai - 1].actor.name === a.actor.name}
									/>
								</li>
							{/each}
						</ol>
					</div>
				{/each}
				<!-- ONE CONTROL FOR THE TAIL, and it disappears once the tail is open —
				     a button reading `show 0 more` is an object drawing the norm. Same
				     shape and voice as the reference page's `Show 8 ready resources ›`.

				     ⛔ ONLY FOR AN EXPLICIT `collapseAfter`. The AUTO cap above has no
				     button of its own — its escape hatch is the caller's own
				     `View all activity ›`, and a second in-place expander here would
				     let a reader re-inflate the exact card `defect #3` shrank. -->
				{#if collapseAfter !== null && hiddenCount > 0}
					<button
						type="button"
						class="t-meta mt-4 text-fg-subtle hover:text-fg-muted hover:underline"
						onclick={() => (expanded = true)}>Show {hiddenCount} earlier deploys ›</button
					>
				{/if}
			</div>
		{/if}
	</div>
</section>
