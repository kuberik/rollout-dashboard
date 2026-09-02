<svelte:options runes={true} />

<script lang="ts">
	import {
		getDisplayVersion,
		formatTimeAgoCompact,
		formatTimeAgo,
		formatDate,
		shortenVersion
	} from '$lib/utils';
	import { buildPath, repoKeyFromSource } from '$lib/version-utils';
	import { rankVerdictsByRollout, rankLabel, rankRole, rankTitle } from '$lib/view-models/env-rank';
	import {
		CalendarMonthSolid,
		ClockSolid,
		UndoOutline,
		ChevronRightOutline
	} from 'flowbite-svelte-icons';
	import {
		getRolloutEnvironmentTheme,
		getEnvironmentThemeStyle,
		shortEnvLabel
	} from '$lib/environment-theme';
	import { rolloutPath, sourceClusterName } from '$lib/source-dashboard';
	import { now } from '$lib/stores/time';
	import Chip from '$lib/components/Chip.svelte';
	import type { Rollout, Environment } from '../../types';
	import { BAKE_WORD } from '$lib/bake-status';
	import { deployActs, type DeployAct } from '$lib/history-marks';

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
		collapseAfter = null
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
		 * FALSE WHEN THE CALLER IS ALREADY A `Card`.
		 *
		 * This component draws its own `t-label` caption above its own bordered
		 * box — the "caption floating over a box" shape that
		 * `COMPOSITION-GRAMMAR.md` identifies as the one every rejected page is
		 * built from, against a reference page where every region is a TITLED
		 * CARD with an icon and a right-aligned rollup. `/apps/[name]` wraps it
		 * in `Card` now; passing `chrome={false}` drops the caption and the box
		 * so the two do not nest.
		 *
		 * DEFAULT TRUE, so `/envs/[name]` — the other call site, owned by
		 * another pass — renders byte-identically.
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
		 * entry, i.e. what is running in that place RIGHT NOW. It is the only
		 * row a rank may be attached to. See `ranks` below.
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
	};

	/**
	 * ⭐ THE RELATIVE VERSION, AND THE FENCE AROUND IT. (2026-09-01)
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
	 * WHAT IS TRUE, AND IS THEREFORE WHAT THE RAIL PRINTS: exactly one row per
	 * rollout is the deploy that is STILL LIVE. That row is the present tense,
	 * so the shared verdict applies to it unchanged — same `rankVerdictsByRollout`,
	 * same words, same joined `[verdict][sha]` chip `/` and `/rollouts` draw.
	 * Every row below it keeps the plain `old → new` pair and carries no rank,
	 * which also means the CHIP ITSELF is the mark that says "this is what is
	 * running" — no second encoding, no legend.
	 */
	const ranks = $derived(rankVerdictsByRollout(rollouts, environments));

	const entries = $derived.by<ActivityEntry[]>(() => {
		const list: ActivityEntry[] = [];
		for (const r of rollouts) {
			const history = r.status?.history ?? [];
			let seenNewest = false;
			const env = environments.find(
				(e) =>
					e.metadata?.namespace === r.metadata?.namespace &&
					e.spec?.rolloutRef?.name === r.metadata?.name
			);
			const envName = env?.spec?.environment ?? '';
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
					timestamp: h.timestamp,
					href: rolloutPath(
						sourceClusterName(r) || localClusterName,
						r.metadata?.namespace ?? '',
						r.metadata?.name ?? ''
					),
					isRunning: bs === 'InProgress' || bs === 'Deploying',
					source: r.status?.source ?? null,
					isLive,
					rollout: r,
					rollbackAct
				});
			}
		}
		list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
		return list.slice(0, limit);
	});

	type DayGroup = { label: string; key: string; entries: ActivityEntry[] };
	function dayKey(ts: string): string {
		const d = new Date(ts);
		return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
	}
	function dayLabel(ts: string, refNow: Date): string {
		const d = new Date(ts);
		const today = new Date(refNow.getFullYear(), refNow.getMonth(), refNow.getDate());
		const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
		const days = Math.round((today.getTime() - that.getTime()) / 86_400_000);
		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
	function hourLabel(ts: string): string {
		const d = new Date(ts);
		return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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
	const autoCapApplies = $derived(collapseAfter === null && showAppName !== false);
	const autoCapped = $derived.by<ActivityEntry[]>(() => {
		if (!autoCapApplies) return entries;
		const out: ActivityEntry[] = [];
		const daysSeen = new Set<string>();
		for (const a of entries) {
			if (out.length >= AUTO_CAP_ENTRIES) break;
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
	const STATUS_DOT: Record<string, string> = {
		Succeeded: 'bg-green-700 dark:bg-green-400',
		Failed: 'bg-red-700 dark:bg-red-400',
		InProgress: 'bg-yellow-700 dark:bg-yellow-400',
		Deploying: 'bg-blue-700 dark:bg-blue-400',
		Cancelled: 'bg-gray-500 dark:bg-gray-400',
		None: 'bg-gray-300 dark:bg-gray-600'
	};
	const STATUS_TEXT: Record<string, string> = {
		Succeeded: 'text-green-700 dark:text-green-400',
		Failed: 'text-red-700 dark:text-red-400',
		InProgress: 'text-yellow-700 dark:text-yellow-400',
		Deploying: 'text-blue-700 dark:text-blue-400',
		Cancelled: 'text-gray-500 dark:text-gray-400',
		None: 'text-gray-500 dark:text-gray-400'
	};
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
	const STATUS_LABEL: Record<string, string> = BAKE_WORD;
	function isRunning(s: string) {
		return s === 'InProgress' || s === 'Deploying';
	}
</script>

<!-- The `prev -> new` pair. Rendered on line 1 when the app name is suppressed
     (a page already scoped to one app), on line 2 when it is not. One snippet so
     the two layouts cannot drift apart.

     ⭐ ON THE LIVE ROW THE `new` HALF BECOMES THE JOINED `[verdict][sha]` CHIP —
     the same unit `/` and `/rollouts` draw, from the same `env-rank.ts`. On
     every other row it stays a plain sha, because a rank on a superseded
     deploy is a claim nobody can make. See `ranks`. -->
{#snippet versionSnippet(a: ActivityEntry)}
	{@const rank = ranks.get(a.rollout) ?? { kind: 'unknown' as const }}
	<!-- `ml-auto`, NOT `justify-between` ON THE PARENT — this snippet is now
	     the ONLY thing that ever sits on the right of its row (line 2, both
	     `showAppName` variants), and an auto margin holds it flush right
	     whether or not the row has wrapped. See the row markup below. -->
	<span class="ml-auto flex min-w-0 shrink-0 items-center gap-1">
		{#if a.previousVersion}
			<span class="t-code-sm text-gray-500 line-through dark:text-gray-400"
				>{a.previousVersion}</span
			>
			<span class="t-micro text-gray-500 dark:text-gray-400">→</span>
		{/if}
		{#if a.version && a.isLive}
			<Chip
				role={rankRole(rank)}
				label={rankLabel(rank)}
				title={rankTitle(rank, a.displayName)}
				value={shortenVersion(a.version)}
				valueHref={buildPath(repoKeyFromSource(a.source, a.rolloutName), a.revision, a.version)}
				valueTitle={a.version}
				class="min-w-0"
			/>
		{:else if a.version}
			<a
				href={buildPath(repoKeyFromSource(a.source, a.rolloutName), a.revision, a.version)}
				class="t-code-sm text-gray-700 hover:underline dark:text-gray-300">{a.version}</a
			>
		{/if}
	</span>
{/snippet}

<!-- ⭐ THE ROLLBACK MARK'S ICON. (DESIGN PASS 2) `Chip`'s `icon` prop takes a
     snippet, not a component reference — this replaces the private
     `<UndoOutline>` literal that used to sit inside the filled pill below.
     Same glyph; only the box around it changed. -->
{#snippet rollbackIcon()}
	<UndoOutline class="mr-[3px] h-[11px] w-[11px] shrink-0" aria-hidden="true" />
{/snippet}

<section>
	{#if chrome}
		<div class="mb-3 flex items-baseline justify-between">
			<h2 class="t-label text-gray-500 dark:text-gray-400">Recent activity</h2>
			<!-- `.nav-link`, NOT a private `t-micro` spelling. (2026-09-02) This
			     was `view all ›` at 12px/400 with the `›` glyph — a control that
			     only changes what you are looking at, wearing a treatment none of
			     its siblings (`/`'s rail, and every route-level `rollup` snippet
			     wrapping this component with `chrome={false}`) use any more. Same
			     wording and glyph `HomeRail` settled on: "View all activity ›",
			     the SVG chevron rather than the character, `.nav-link`'s own
			     14px/500. -->
			<a href={activityHref} class="nav-link" aria-label="View all recent activity">
				View all activity <ChevronRightOutline class="h-3.5 w-3.5" />
			</a>
		</div>
	{/if}
	<div
		class={chrome
			? 'overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800'
			: ''}
	>
		{#if entries.length === 0}
			<div class="flex flex-col items-center px-4 py-10 text-center">
				<div
					class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700"
				>
					<span class="block h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600"></span>
				</div>
				<p class="t-dense text-gray-700 dark:text-gray-300">No activity yet</p>
				<p class="t-micro mt-1 text-gray-500 dark:text-gray-400">
					Deployments will appear here as a timeline.
				</p>
			</div>
		{:else}
			<div class="p-4">
				{#each byDay as group, gi}
					{@const roll = dayRollup(group.entries)}
					<div class={gi > 0 ? 'mt-5' : ''}>
						<!-- THE GROUP HEADER IS A HEADER: an icon, the label, and a
						     right-aligned rollup. `COMPOSITION-GRAMMAR.md` §1 and §3 — the
						     page the human calls beautiful carries 115 icons and this rail
						     carried none. The clock/calendar pair is the one `/activity`
						     already spends on the same distinction. -->
						<div class="mb-3 flex items-center gap-2">
							{#if group.label === 'Today'}
								<ClockSolid class="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400" />
							{:else}
								<CalendarMonthSolid class="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400" />
							{/if}
							<span class="t-label text-gray-500 dark:text-gray-400">{group.label}</span>
							<span
								class="h-px flex-1 bg-gradient-to-r from-gray-200 to-transparent dark:from-gray-700"
							></span>
							{#if roll.failed > 0}
								<span class="t-micro text-red-700 dark:text-red-400">{roll.failed} failed</span>
								<span class="t-micro text-gray-500 dark:text-gray-400">·</span>
							{/if}
							<span class="t-code-sm text-gray-500 dark:text-gray-400">{roll.count}</span>
						</div>
						<ol class="relative">
							<span
								class="absolute top-1.5 bottom-1.5 left-[7px] w-px bg-gray-200 dark:bg-gray-700"
								aria-hidden="true"
							></span>
							{#each group.entries as a, ai}
								{@const isLast = ai === group.entries.length - 1}
								<li
									class="environment-theme-scope relative pl-6 {isLast ? '' : 'pb-3'}"
									style={a.theme ? getEnvironmentThemeStyle(a.theme) : undefined}
								>
									<span
										class="absolute top-1 left-0 inline-flex h-3.5 w-3.5 items-center justify-center"
									>
										{#if isRunning(a.bakeStatus)}
											<span
												class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {STATUS_DOT[
													a.bakeStatus
												]}"
											></span>
										{/if}
										<span
											class="relative inline-flex h-2.5 w-2.5 rounded-full {STATUS_DOT[
												a.bakeStatus
											] ?? STATUS_DOT.None} ring-2 ring-white dark:ring-gray-800"
										></span>
									</span>
									<!-- ⭐ `.tap-zone`, NOT AN OVERLAY ANCHOR. (2026-09-01) The
									     row's destination used to be an `<a class="absolute
									     inset-0">` with an `aria-label` and no text, which
									     forced every other element in the row to carry a
									     hand-written `pointer-events-none` or `z-10` and gave a
									     keyboard user a focus ring around an empty rectangle.
									     The mechanism in `app.css` puts the `::after` on the
									     anchor that already owns the destination and raises the
									     rest by rule. Zero added tab stops, no nested anchors. -->
									<div
										class="tap-zone -mx-2 block rounded px-2 py-1 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
									>
										<div class="flex items-center justify-between gap-2">
											<div class="flex min-w-0 items-center gap-2">
												{#if showEnv && (a.envName || a.theme)}
													<Chip
														role="env"
														theme={a.theme}
														label={shortEnvLabel(a.theme) || a.envName || a.theme?.label || ''}
														wide
														class="shrink-0"
													/>
												{/if}
												{#if showAppName}
													<!-- THE LIVE ROW LEADS. It is the one row of the ten
													     that describes the present, so it takes the
													     weight; the rest are history and read as it. -->
													<a
														href={a.href}
														class="tap-link t-dense min-w-0 truncate text-gray-900 dark:text-white {a.isLive
															? 'font-semibold'
															: ''}">{a.displayName}</a
													>
												{/if}
												<!-- ⛔ THE VERSION PAIR USED TO LIVE HERE WHEN
												     `showAppName` WAS FALSE, ALONGSIDE THE TIMESTAMP
												     BELOW — TWO `shrink-0` ANCHORS ON ONE LINE, NEITHER
												     ABLE TO YIELD. Measured at 390 on
												     `/apps/hello-frontend-app`: the version chip and the
												     timestamp overlapped by up to 42px, because
												     `justify-between` with negative free space just
												     distributes a NEGATIVE gap instead of wrapping. It
												     now lives on line 2 below, unconditionally, which is
												     the one place a `showAppName` row already puts it —
												     see `versionSnippet`'s own `ml-auto`. -->
											</div>
											{#if showAppName}
												<span
													class="t-code-sm shrink-0 text-gray-500 dark:text-gray-400"
													title={formatDate(a.timestamp)}
												>
													{hourLabel(a.timestamp)}
												</span>
											{:else}
												<!-- NO NAME TO HANG THE DESTINATION ON. On a page
												     already scoped to one app the row prints no app
												     name, so the timestamp is the anchor — it is the
												     one thing on the row that identifies THIS deploy,
												     and the accessible name still says what opens. -->
												<a
													href={a.href}
													aria-label="Open {a.displayName}"
													class="tap-link t-code-sm shrink-0 text-gray-500 dark:text-gray-400"
													title={formatDate(a.timestamp)}
												>
													{hourLabel(a.timestamp)}
												</a>
											{/if}
										</div>
										<!-- ⭐ LINE 2 IS UNCONDITIONAL NOW. It used to render only
										     when `showAppName` was true (the version pair's ONLY
										     home) or the bake status was not `Succeeded` — which is
										     exactly the branch that dropped a settled rollback on
										     the floor when `showAppName` was false: line 1 had the
										     version pair, line 2 never rendered, nowhere for the
										     rollback mark to go. It is the version pair's one home
										     now, on every call site, and `flex-wrap` (not
										     `justify-between`) is the fallback if a long state word
										     and a long version pair still cannot both fit — the row
										     stacks instead of overlapping again. -->
										<div class="t-micro mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
											{#if a.bakeStatus !== 'Succeeded'}
												<span class={STATUS_TEXT[a.bakeStatus] ?? STATUS_TEXT.None}
													>{STATUS_LABEL[a.bakeStatus]}</span
												>
											{:else if a.rollbackAct}
												<!-- THE WORD, AT REST — same `Chip` the History tab
												     and `/activity` use (`history-marks.ts`'s own
												     `word` and `sentence`, never a private copy of
												     them), so a rollback cannot be spelled two ways
												     between the surfaces that all read `deployActs`.

												     ⛔ SUPERSEDED (DESIGN PASS 2). This used to be a
												     hand-rolled `bg-gray-900` filled pill — the SAME
												     fill the `7d` window and `All` status selectors
												     use on `/activity`, so one page's loudest object
												     meant both "you clicked this" and "this deploy
												     went backwards". A domain STATUS may not share a
												     fill with a SELECTION state. `role="count"` is
												     the neutral, text-only tone `HELD`/`PINNED`/
												     `1 BEHIND` already use product-wide — going
												     backwards is still a fact about the deploy, not
												     an alarm about it; only the geometry moved onto
												     the shared `.chip` (20px, 4px radius) instead of
												     a private `rounded-full` box. -->
												<Chip
													role="count"
													label={a.rollbackAct.word}
													icon={rollbackIcon}
													title={a.rollbackAct.sentence}
												/>
											{/if}
											{@render versionSnippet(a)}
										</div>
									</div>
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
						class="t-micro mt-4 text-gray-500 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
						onclick={() => (expanded = true)}>Show {hiddenCount} earlier deploys ›</button
					>
				{/if}
			</div>
		{/if}
	</div>
</section>
