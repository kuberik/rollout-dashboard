<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ENVIRONMENTS — the COMPARISON page.
	 *
	 * THE RUBRIC THIS IS BUILT AGAINST (`PAGE-CRITERIA.md` §03, the "on open
	 * you ask" criteria recovered from the Claude Design project):
	 *
	 *   1. Is each environment healthy?      — rolled-up health
	 *   2. How many apps run where?          — capacity + occupancy
	 *   3. Which env is furthest behind?     — aggregate distance from head
	 *
	 *   > "Envs are places — treat them as capacity." One card each: health
	 *   > bar, app count, aggregate drift. Prod regions bracketed as a fleet.
	 *
	 * And `DESIGN-INTENT.md`'s one-line brief for the page: *"Overview ACROSS
	 * environments — must beat reading each env page in isolation."*
	 *
	 * ─── WHAT WAS HERE AN HOUR AGO, AND WHY IT WENT ──────────────────────
	 *
	 * A faithful transcription of design handoff §3: one stacked full-width
	 * SECTION per environment, each printing its apps as rows with a 6-tick
	 * deploy-history strip. It implemented §3's layout notes exactly and it
	 * had never been measured against the criteria above. Measured, on the
	 * fixture the product actually has:
	 *
	 * · **Criterion 3 was not answered at all.** Nothing on the page stated
	 *   how far behind an environment was in aggregate, so the one question
	 *   that RANKS environments against each other had no answer, and the
	 *   ranking is the entire reason a list exists rather than 22 bookmarks.
	 * · **It did not beat reading each env page in isolation — it WAS reading
	 *   each env page in isolation, 22 times, concatenated.** The row it drew
	 *   (app · history strip · build badge · age) is the same object at the
	 *   same fidelity that `/envs/[name]` draws. Twenty-two copies of the
	 *   detail page stacked vertically is the literal thing `DESIGN-INTENT`
	 *   says this page must beat.
	 * · **It did not scale.** The fixture has 22 environments, 18 of which are
	 *   production regions with ONE app each. That is eighteen bordered
	 *   panels, eighteen headers and eighteen count rows to carry eighteen
	 *   facts — against the standing rule *"scale to many environments (4+
	 *   prod regions) must not break the layout"* and *"fewer, denser, more
	 *   purposeful panels"*.
	 *
	 * So the two pages are split BY JOB rather than by scope: **this page
	 * compares environments, `/envs/[name]` inspects one.** The apps did not
	 * disappear — they moved to the page whose own criterion 1 is *"what's
	 * running here right now — every app's live version"*, where they are
	 * printed with a promotion chain and an action this page never had room
	 * for.
	 *
	 * ─── CARDS vs ROWS (the proposal's mock is a 2-up card grid) ──────────
	 *
	 * Rows, in two bracketed panels. The mock's four facts per environment are
	 * all kept; what changes is that they sit in ALIGNED COLUMNS.
	 *
	 * Criterion 3 is a comparison, and a comparison needs its quantity at ONE
	 * x-position. A 2-up grid alternates every quantity between two columns,
	 * so "which env is furthest behind" is answered by hopping left-right-
	 * left down the page; a single-column table answers it by reading straight
	 * down one track. The product agrees with itself here: `/` uses cards for
	 * the two things that need a person and ROWS for the twenty-one it wants
	 * you to scan, and 22 environments is a population to scan. Cards also
	 * cost roughly double the height for the same four facts, which at 22
	 * environments is the difference between a page and a scroll.
	 *
	 * ─── ORDER: THE LINE AND THE SET ─────────────────────────────────────
	 *
	 * The two brackets are ordered by DIFFERENT rules, because the domain says
	 * they are different kinds of thing (`DESIGN-INTENT.md`): *"Stages are a
	 * LINE — they run in order. Production regions are a SET — they do not run
	 * in order. Never force one shape onto both."*
	 *
	 * · **Pipeline stages** keep `compareEnvironmentNames` order. Reading order
	 *   IS promotion order; sorting dev below prod because prod is redder
	 *   would state a promotion order that does not exist.
	 * · **The production fleet** has no inherent order, so it is free to sort
	 *   WORST FIRST — and it is the bracket where criterion 3 actually bites,
	 *   because it is the one with eighteen members.
	 *
	 * ─── WHAT THE DATA CANNOT SUPPORT, stated rather than faked ──────────
	 *
	 * · The criterion's words are "rolled-up POD health". `/api/rollouts`
	 *   returns Rollouts and Environments; ready/desired replicas live behind
	 *   the per-rollout managed-resources call, one fetch per row. Health here
	 *   is rolled up from BAKE state plus the `stuck` detector — which is what
	 *   every other page in the product means by healthy — and the page never
	 *   says "pods".
	 * · The prototype's per-environment `sub` is deploy POLICY ("auto-promote
	 *   on green", "manual approval"). Nothing in the Environment CRD carries
	 *   it. The sub prints the one thing the name does evidence: whether this
	 *   is a pipeline stage or a production region, which is also the
	 *   LINE-vs-SET distinction the brackets turn on.
	 */
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { rolloutMatchesEnvironment } from '$lib/source-dashboard';
	import { groupRolloutsByApp } from '$lib/version-utils';
	import type { AppGroup } from '$lib/version-utils';
	import { rankVerdicts, rankBehindBy } from '$lib/view-models/env-rank';
	import type { RankVerdict } from '$lib/view-models/env-rank';
	import { regionLabel } from '$lib/view-models/regions';
	import { getEnvironmentRank, sortEnvironmentNames } from '$lib/env-order';
	import { buildRolloutCards } from '$lib/rollout-cards';
	import type { StatusKey } from '$lib/rollout-cards';
	import { formatTimeAgoCompact, formatDate, detectStuck, detectStuckBehind } from '$lib/utils';
	import { getRolloutEnvironmentTheme, shortEnvLabel } from '$lib/environment-theme';
	import type { EnvironmentTheme } from '$lib/environment-theme';
	import Chip from '$lib/components/Chip.svelte';
	import { ChevronRightOutline } from 'flowbite-svelte-icons';
	import { now } from '$lib/stores/time';
	import type { Rollout, Environment } from '../../types';

	const PANEL = 'rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800';

	/**
	 * ONE APP IN ONE ENVIRONMENT — the worst true thing about it.
	 *
	 * Declared HERE rather than imported from `EnvHealthStrip`, which this page
	 * no longer renders (see the tombstone at the row snippet). The buckets are
	 * still mutually exclusive and still in severity order, because `severity`
	 * and the page's H2 verdict are both built from them.
	 */
	type EnvAppState = 'failing' | 'stuck' | 'deploying' | 'baking' | 'healthy' | 'pending';
	type EnvHealthApp = { name: string; state: EnvAppState };

	/**
	 * THE ROW — one environment, five facts, aligned.
	 *
	 * `120px chip │ 1fr name │ 168px state │ 64px apps │ 132px behind │ 80px age │ 16px ›`
	 *
	 * ONE flexible track, and it is the NAME — everything else is fixed, which
	 * is the rule (*"every non-flexible grid track must be a FIXED width; one
	 * flexible track per grid"*).
	 *
	 * ── THE BADGES ARE LEFT-ALIGNED AGAIN, AND THE LEFT EDGE IS WHY (2026-08-27)
	 *
	 * > *"the badges misalign"* — the human, on the pass below this one.
	 *
	 * The 2026-08-27 pass flush-righted the badges in a 128px track so the gap
	 * from badge to name would be a constant 12px. Measured afterwards at 1440
	 * on the 22-environment fixture: **right edges all at x=345 (spread 0.0px),
	 * LEFT edges spanning x=235.5 → 310.5 — a 75.0px ragged edge down the
	 * column.** It traded one misalignment for a worse one. Reading down a
	 * column the LEFT edge is the strong cue — it is where every scan starts —
	 * and the name track's left edge was already hard at x=357 regardless of
	 * what the badge did, so the "constant gap" bought nothing the name column
	 * did not already have.
	 *
	 * Left-aligned in a fixed track, BOTH columns have a hard left edge: badge
	 * left spread 0.0px, name left spread 0.0px. The badge's right edge is
	 * ragged, which is what a column of variable-length labels looks like in
	 * every table ever printed, and it is the weak cue rather than the strong
	 * one.
	 *
	 * 120px, not 128: the widest badge on either fixture is `AP-NORTHEAST-1` at
	 * 109.5px, so the track is the content plus one 8px scale step of slack.
	 * The 8px it gives back goes to the name.
	 *
	 * ── THE 200px HEALTH TRACK IS NOW A 168px STATE TRACK ──────────────────
	 * See the `EnvHealthStrip` tombstone at the row snippet: the tick strip is
	 * gone and the column holds the row's worst state as a WORD, in the
	 * product's own chip, at one x down the whole list.
	 */
	const ROW_GRID = 'lg:grid-cols-[120px_minmax(0,1fr)_168px_64px_132px_80px_16px]';

	/**
	 * THE ADVERSE ROW'S GROUND — full-bleed, and NEUTRAL BY ARITHMETIC.
	 *
	 * > *"I think there's also a better way to show issues such as stuck on the
	 * > apps list page instead of just showing a badge - same goes for
	 * > environments list."* — the human.
	 *
	 * A chip is one ~50px object on a ~1250x66px row; at 22 rows it is 0.07% of
	 * the surface and the row around it is identical to a settled one. The ROW
	 * carries it now: a ground band, which is the only channel that reads in
	 * peripheral vision before anything is read at all.
	 *
	 * ⛔ **IT CANNOT BE A COLOURED FILL, AND THE INK FORMULA IS WHY.** Presence
	 * is `area x chroma`. The row's box measures 1248 x 66 = 82,368px2. The
	 * palest chromatic step in the product — `red-50`, OKLCH C 0.013 — costs
	 * `82368 x 0.013 = 1071` ink units on its own, against the `stuck` alarm's
	 * **218.6**: a 4.9x inversion of the one ceiling this product holds. That is
	 * not a new finding; it is the measurement that deleted `/apps/[name]`'s
	 * `bg-red-50/80` field (*"C 0.0103 — invisible as a colour — but over that
	 * area it measured 719 ink units, 3.5x the alarm chip"*). A row-scale fill
	 * is available in LIGHTNESS only.
	 *
	 * So it is `bg-gray-100 dark:bg-gray-700/60`, one step stronger than
	 * `tk--broken`'s `bg-gray-50 dark:bg-gray-700/30` because this is a 50-row
	 * scan target rather than one card in a two-item panel: measured, `gray-100`
	 * on white is dL 0.033 against `gray-50`'s 0.015, and both values are
	 * already spent on this page (`divide-gray-100`, `divide-gray-700/60`), so
	 * the treatment costs **ZERO colour values**.
	 *
	 * IT NEVER FIRES ON A HEALTHY ROW. `severity >= 3` is `failing` or `stuck` —
	 * the two states that need a person — and never `behind`, which is the
	 * normal state of a promotion pipeline.
	 */
	const ADVERSE_ROW = 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700/60 dark:hover:bg-gray-700';
	const NORMAL_ROW = 'hover:bg-gray-50 dark:hover:bg-gray-700/30';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 15000, refetchInterval: 15000 } })
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	const groups = $derived.by<Map<string, AppGroup>>(() =>
		groupRolloutsByApp(rollouts, environments)
	);

	// The same succeeded|failed|active|pending classification the Rollouts list
	// and the home page use, so "healthy" here means what it means everywhere.
	const statusByRollout = $derived.by<Map<Rollout, StatusKey>>(() => {
		const map = new Map<Rollout, StatusKey>();
		for (const c of buildRolloutCards(rollouts, environments, $now))
			map.set(c.rollout, c.statusKey);
		return map;
	});

	// ONE ladder per app, not one per (app, environment) pair — 22 environments
	// over 6 apps would otherwise rebuild the same ladder 22 times.
	const ranksByApp = $derived.by<Map<string, Map<unknown, RankVerdict>>>(() => {
		const map = new Map<string, Map<unknown, RankVerdict>>();
		for (const [name, group] of groups) map.set(name, rankVerdicts(group));
		return map;
	});

	/** Every tier any app is bound to, in promotion order. */
	const envTiers = $derived.by<string[]>(() => {
		const set = new Set<string>();
		for (const group of groups.values()) {
			for (const cell of group.cells) {
				const tier = cell.environment?.spec?.environment;
				if (tier) set.add(tier);
			}
		}
		return sortEnvironmentNames([...set]);
	});

	// One representative theme per tier: the first app bound to it resolves the
	// badge colour. An env chip's colour is a function of the environment's
	// NAME and nothing else, so which app resolves it cannot matter.
	const themeByTier = $derived.by<Map<string, EnvironmentTheme | null>>(() => {
		const map = new Map<string, EnvironmentTheme | null>();
		for (const tier of envTiers) {
			let theme: EnvironmentTheme | null = null;
			for (const env of environments) {
				if (env.spec?.environment !== tier) continue;
				const r = rollouts.find((x) => rolloutMatchesEnvironment(x, env));
				theme = getRolloutEnvironmentTheme(r ?? null, env);
				break;
			}
			map.set(tier, theme ?? getRolloutEnvironmentTheme(null, tier));
		}
		return map;
	});

	/**
	 * The row's LABEL. Exact-name match only for the preset words: a
	 * `prod-eu-west` row headed `Production` would be naming a DIFFERENT
	 * environment from the one it describes.
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
	/** rank 7 = the tier IS production; rank 8 = a production REGION. */
	function isRegion(tier: string): boolean {
		return getEnvironmentRank(tier) === 8;
	}
	/**
	 * The row's TITLE is the ADDRESSABLE NAME — `prod-ap-northeast-1`, the
	 * string you would type at kubectl — while the chip beside it carries the
	 * short distinguishing segment and the production identity colour. That is
	 * the same split the `/envs/[name]` h1 already uses (`prod` in mono, then
	 * a `PROD` chip): the chip is the mark, the title is the identifier.
	 */
	function tierTitle(tier: string): string {
		const exact = PRESET_TITLES[tier.trim().toLowerCase()];
		if (exact) return exact;
		return tier;
	}
	function tierSub(tier: string): string {
		const rank = getEnvironmentRank(tier);
		if (rank === 8) return 'production region';
		if (rank === 7) return 'production';
		if (rank === 6) return '';
		return 'pipeline stage';
	}
	/** The badge. Regions print the DISTINGUISHING segment, never `PROD-US-EAS…`. */
	function tierBadge(tier: string): string {
		if (isRegion(tier)) return regionLabel(tier);
		return shortEnvLabel(themeByTier.get(tier) ?? tier) || tier;
	}

	type EnvRow = {
		tier: string;
		title: string;
		sub: string;
		badge: string;
		theme: EnvironmentTheme | null;
		href: string;
		apps: number;
		/** One entry per app here; the strip does its own worst-first ordering. */
		health: EnvHealthApp[];
		/**
		 * The DEEPEST ladder rank in this environment, and the number of apps
		 * that are behind at all.
		 *
		 * DELIBERATELY NOT A MEAN, which is what the proposal's mock prints
		 * (`avg drift 2.6`). Two reasons. A mean is a fact about no app: you
		 * cannot click it, you cannot promote it, and 2.6 and 2.6 can be one
		 * app 8 behind or four apps 2-3 behind, which are different mornings.
		 * And a mean over a set that mixes rankable rows with `unknown` ones is
		 * exactly the *"never render an unresolvable comparison as a claim"*
		 * failure — the denominator would silently exclude rows the reader can
		 * see. `−19 · 2 of 3 behind` is two numbers that both exist, in the
		 * product's own chip, and the pair ranks environments just as well.
		 */
		worstBehind: number;
		behindCount: number;
		divergedCount: number;
		lastDeployTs: string | null;
		/**
		 * WHICH APPS NEED A PERSON HERE — the one thing this page gave up when
		 * the per-environment app lists went to `/envs/[name]`, bought back in
		 * the track that had the slack for it.
		 *
		 * `1 failing` in the health caption tells you an environment is bad;
		 * `checkout-worker failing` tells you what to open, and it is the fact
		 * that makes reading this page beat reading twenty-two env pages —
		 * you can see the SAME app fine in one place and failing in another,
		 * on one screen, without a single click.
		 *
		 * Only failing and stuck. Being behind is the normal state of a
		 * promotion pipeline and is already the `Behind` column's whole job;
		 * naming twenty-two trailing apps here would mark the norm.
		 */
		needs: { name: string; word: string }[];
		/** Fleet sort key. Adverse states first, then depth of lag. */
		severity: number;
	};

	const rowsByTier = $derived.by<Map<string, EnvRow>>(() => {
		const out = new Map<string, EnvRow>();
		for (const tier of envTiers) {
			const health: EnvHealthApp[] = [];
			let apps = 0;
			let worstBehind = 0;
			let behindCount = 0;
			let divergedCount = 0;
			let lastDeployTs: string | null = null;
			const needs: { name: string; word: string }[] = [];

			for (const group of groups.values()) {
				const ranks = ranksByApp.get(group.appName);
				for (const cell of group.cells) {
					if (cell.environment?.spec?.environment !== tier) continue;
					apps++;
					const latest = cell.rollout.status?.history?.[0];
					const status = latest?.bakeStatus || 'None';
					const statusKey = statusByRollout.get(cell.rollout) ?? 'pending';

					let isStuck = !!detectStuck(cell.rollout, { now: $now });
					if (!isStuck) {
						for (const peer of group.cells) {
							if (peer === cell) continue;
							if (detectStuckBehind(cell.rollout, peer.rollout, peer.envName, { now: $now })) {
								isStuck = true;
								break;
							}
						}
					}

					// MUTUALLY EXCLUSIVE, in severity order — the bucket an app
					// lands in is the worst true thing about it, so the buckets
					// always add up to the app count printed beside them.
					if (status === 'Failed') {
						health.push({ name: group.appName, state: 'failing' });
						needs.push({ name: group.appName, word: 'failing' });
					} else if (isStuck) {
						health.push({ name: group.appName, state: 'stuck' });
						needs.push({ name: group.appName, word: 'stuck' });
					} else if (status === 'Deploying')
						health.push({ name: group.appName, state: 'deploying' });
					else if (status === 'InProgress') health.push({ name: group.appName, state: 'baking' });
					else if (statusKey === 'succeeded')
						health.push({ name: group.appName, state: 'healthy' });
					else health.push({ name: group.appName, state: 'pending' });

					const rank = ranks?.get(cell) ?? { kind: 'unknown' };
					if (rank.kind === 'behind') {
						behindCount++;
						worstBehind = Math.max(worstBehind, rankBehindBy(rank));
					} else if (rank.kind === 'diverged') {
						divergedCount++;
					}

					const ts = latest?.timestamp ?? null;
					if (ts && (!lastDeployTs || new Date(ts) > new Date(lastDeployTs))) lastDeployTs = ts;
				}
			}

			out.set(tier, {
				tier,
				title: tierTitle(tier),
				sub: tierSub(tier),
				badge: tierBadge(tier),
				theme: themeByTier.get(tier) ?? null,
				href: `/envs/${encodeURIComponent(tier)}`,
				apps,
				health,
				worstBehind,
				behindCount,
				divergedCount,
				lastDeployTs,
				// Failing before stuck, so the two words never interleave and the
				// first name printed is always the worst one here.
				needs: needs.sort((a, b) => (a.word === b.word ? 0 : a.word === 'failing' ? -1 : 1)),
				severity: health.some((h) => h.state === 'failing')
					? 4
					: health.some((h) => h.state === 'stuck')
						? 3
						: divergedCount > 0
							? 2
							: behindCount > 0
								? 1
								: 0
			});
		}
		return out;
	});

	/**
	 * THE TWO BRACKETS. Production regions are a SET and everything else is a
	 * LINE, so they are separated and ordered by different rules.
	 *
	 * `regions.ts` states the vocabulary rule this obeys: *"the word 'region'
	 * appears NOWHERE in the kuberik API; 'region' is only a legitimate word
	 * for that shape when there is more than one of them."* With one
	 * production-tier environment there is no fleet, and the row folds back
	 * into the stages bracket rather than sitting alone under a header that
	 * names a set of one.
	 */
	const FLEET_MIN = 2;

	const regionRows = $derived.by<EnvRow[]>(() => {
		const regions = envTiers.filter(isRegion).map((t) => rowsByTier.get(t)!);
		if (regions.length < FLEET_MIN) return [];
		// A SET has no promotion order, so it is free to rank itself. Worst
		// first, then deepest lag: criterion 3's answer is the top of this list.
		return regions.sort(
			(a, b) =>
				b.severity - a.severity || b.worstBehind - a.worstBehind || a.tier.localeCompare(b.tier)
		);
	});

	const stageRows = $derived.by<EnvRow[]>(() => {
		const inFleet = new Set(regionRows.map((r) => r.tier));
		// `envTiers` is already `compareEnvironmentNames` order, and reading
		// order IS promotion order for a LINE. Do not sort this.
		return envTiers.filter((t) => !inFleet.has(t)).map((t) => rowsByTier.get(t)!);
	});

	const fleetApps = $derived(regionRows.reduce((n, r) => n + r.apps, 0));
	const fleetWorstBehind = $derived(regionRows.reduce((n, r) => Math.max(n, r.worstBehind), 0));
	const fleetBehindCount = $derived(
		regionRows.reduce((n, r) => n + r.behindCount + r.divergedCount, 0)
	);
	/**
	 * The fleet's own STATE, one scope up — the same rollup idiom the panel
	 * already applies to its app count and its deepest lag. `failing` before
	 * `stuck`, so the word on the header is the worst true thing in the set.
	 * One entry per (app, region) pair, because `edge-mesh` can be fine in
	 * twelve regions and failing in the thirteenth.
	 */
	const fleetNeeds = $derived.by<{ name: string; word: string }[]>(() =>
		regionRows
			.flatMap((r) => r.needs.map((n) => ({ name: `${n.name} · ${r.tier}`, word: n.word })))
			.sort((a, b) => (a.word === b.word ? 0 : a.word === 'failing' ? -1 : 1))
	);

	/**
	 * ⚠️ IS EVERY MEMBER OF THIS BRACKET BEHIND? (2026-08-27, colour audit §3.)
	 *
	 * If it is, then `behind` is the GROUP'S NORM and the per-row `−N` is not
	 * marking a deviation — it is repeating, once per row, a fact the group
	 * header already states in words (`18 of 18 behind`). Measured on the mock
	 * at 1440 before this: **20 red `−N` chips on 22 rows, ~660 ink units**,
	 * against a page whose own H2 is *"1 of 22 environments has a failing
	 * deploy"* — and the one genuinely adverse chip in that column,
	 * `DIVERGED`, was drawn in the same red at the same size as the eighteen
	 * chips around it saying the ordinary thing.
	 *
	 * So in a uniformly-behind bracket the rank chip takes the `count` gray —
	 * the same gray `head`, `count` and `unranked` already use — and the red in
	 * that panel is left to `diverged`, `failing` and `stuck`, which are the
	 * marks that mean a person is needed.
	 *
	 * THIS IS NOT "ONE CHIP, TWO COLOURS". It is DESIGN.md's own *"mark the
	 * deviation, never the norm"* applied at GROUP scope, which is the rule
	 * that deleted twelve green `newest` chips from `/apps`; and it is the same
	 * shape as *"CONVERGED RUNS RECEDE"* on `/apps/[name]`, where the 2nd+ row
	 * of a run keeps every mark and loses only the REPETITION. The predicate is
	 * a property of the BRACKET, printed in that bracket's own header, never of
	 * the individual environment — so the chip and the caption above it can
	 * never disagree. And the colour only ever moves toward red, when a
	 * sibling recovering makes lag exceptional again.
	 *
	 * The FLEET ROLLUP's own `−N` keeps the red: it is one summary mark for
	 * the whole bracket, not one per row.
	 */
	const isBehind = (r: EnvRow) => r.behindCount + r.divergedCount > 0;
	const fleetAllBehind = $derived(
		regionRows.length > 1 && regionRows.every((r) => r.apps > 0 && isBehind(r))
	);
	const stagesAllBehind = $derived(
		stageRows.length > 1 && stageRows.every((r) => r.apps > 0 && isBehind(r))
	);

	/**
	 * ONE sentence, built only from counts that are marked on screen below it.
	 * It names WHAT IS OBSERVABLE and never a mechanism.
	 */
	const verdict = $derived.by<string>(() => {
		const total = envTiers.length;
		if (total === 0) return '';
		const all = [...rowsByTier.values()];
		const failing = all.filter((r) => r.health.some((h) => h.state === 'failing')).length;
		const stuck = all.filter((r) => r.health.some((h) => h.state === 'stuck')).length;
		const behind = all.filter((r) => r.behindCount > 0 || r.divergedCount > 0);
		const deepest = all.reduce((n, r) => Math.max(n, r.worstBehind), 0);
		if (failing > 0)
			return `${failing} of ${total} environments ${failing === 1 ? 'has' : 'have'} a failing deploy.`;
		if (stuck > 0) return `${stuck} of ${total} environments ${stuck === 1 ? 'is' : 'are'} stuck.`;
		if (behind.length > 0)
			return `${behind.length} of ${total} environments ${behind.length === 1 ? 'is' : 'are'} behind, the deepest by ${deepest}.`;
		return `All ${total} environments are on their apps' newest builds.`;
	});
</script>

<svelte:head>
	<title>kuberik | Environments</title>
</svelte:head>

<!-- ── THE COLUMN HEADER ───────────────────────────────────────────────
     Printed once per bracket. `Behind` and not "Drift": drift framing is a
     standing hard NO (*"Drift is the normal state of a promotion pipeline.
     The only adverse state is stuck."*) and the product's own word for the
     distance is `behind`, which `/` prints as its `Trailing` section and
     `/envs/[name]` as its `Behind newest` stat. -->
{#snippet columnHeader()}
	<!-- THE BADGE TRACK IS NOT A SEPARATE COLUMN AND MUST NOT BE HEADED LIKE
	     ONE. Before 2026-08-27 this row printed an EMPTY cell over the badges
	     and put `Environment` over the names, so `DEV` / `STAGING` / `PROD` sat
	     in an unlabelled track at x=222 while their own header sat 135px to the
	     right — the badge read as an orphan graphic rather than as half of the
	     identity it labels. `Environment` now starts at column 1 and spans the
	     badge AND the name, because that is what it names: one subject, two
	     marks. THAT half of the fix stands and is what binds the two tracks
	     together; the flush-right half of it is reverted — see the left-edge
	     measurement at `ROW_GRID`. -->
	<div
		class="t-label hidden gap-x-3 border-b border-gray-100 px-4 py-3 text-gray-500 lg:grid {ROW_GRID} dark:border-gray-700 dark:text-gray-400"
	>
		<span class="col-span-2">Environment</span>
		<span>State</span>
		<span>Apps</span>
		<span>Behind</span>
		<span>Deployed</span>
		<span></span>
	</div>
{/snippet}

<!-- ── THE ROW ─────────────────────────────────────────────────────────
     MOBILE IS A LAYOUT, NOT A FALLBACK. Below `lg` the row is
     `auto │ 1fr │ auto` and EVERY cell is placed explicitly: line 1 the chip,
     the name and the age; line 2 the state cell; line 3 the app count and
     the behind badge. Nothing is left to auto-flow, which is how a badge
     previously fell into a glyph gutter and clipped its own rank word.

     ⛔ ── `EnvHealthStrip` IS GONE FROM THIS PAGE. (2026-08-27) ────────────
     > *"i also don't understand what these gray bars mean there and on the
     > detail page"* — the human.

     The strip drew one 6px tick per app, worst-first, and since the colour
     pass took `green-700` off the healthy tick it drew them GRAY. On this
     fixture that is 22 rows of identical gray dashes: **the object was 92%
     norm.** A reader cannot decode a mark whose common case means nothing,
     and a mark that has to be explained is the same failure as the fleet
     legend the human had deleted — the brief forbids adding one, correctly.

     It also had no monopoly on its own fact. `1 stuck · 3 healthy` sat 4px
     under it saying the same thing in words, and the strip was anonymous
     where the caption could be specific.

     WHAT CARRIES CRITERION 1 (*"is each environment healthy — rolled-up
     health"*) NOW, and it is MORE than the strip carried:
       · the STATE column — the row's worst state as a WORD in the product's
         own chip, at ONE x down the whole list, empty when the environment
         is healthy. Presence in a scan column is self-evident with no
         legend, which is exactly what the ticks were not;
       · its caption NAMES the apps (`checkout-edge · checkout-worker`),
         which the ticks could only do on hover;
       · the row's own GROUND (`ADVERSE_ROW`), so the answer arrives before
         anything is read.

     `EnvHealthStrip.svelte` is NOT deleted: `/envs/[name]` still imports it
     and that page belongs to someone else this round. The recommendation for
     it is the same and is stated in the handoff.

     ── EVERY COLUMN SITS ON THE SAME TWO BASELINES (2026-08-27) ──────────
     From the human: *"Environment list is not nicely aligned because of badge
     positioning."* Measured at 1440 before the fix, the row had FIVE vertical
     rhythms and no column agreed with its neighbour:

       badge          centred in the row       y 255
       name + sub     two lines from the top   y 245 / 265
       health         6px ticks + caption      y 247 / 260
       apps           one line, centred        y 255
       behind         chip + caption, BUT ONLY WHEN THERE IS A CHIP —
                      `−2` / `4 of 4 behind` at 370 / 391 on a lagging row,
                      and a lone centred `all on head` at 255 on a settled
                      one, so the same column's caption moved 10px depending
                      on the DATA
       deployed       one line, centred        y 255

     The row is now `align-items: start` at `lg`, and every cell is a
     `MARK LINE` of exactly 20px followed by an optional 11px CAPTION line
     4px under it (`.env-line`). Two baselines, every column, every row,
     with data or without: the `−2` chip and the `DEV` badge and the `6` and
     the `13m` are all centred in one 20px band, and `4 of 4 behind`,
     `all on head`, `1 healthy` and `production region` all share the line
     below it. A cell with no mark keeps the empty 20px rather than sliding
     its caption up, which is what makes "no chip" — the encoding for `on
     head` — cost alignment nothing. -->
{#snippet envRow(r: EnvRow, groupAllBehind: boolean)}
	<a
		href={r.href}
		class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-4 py-3 {ROW_GRID} {r.severity >=
		3
			? ADVERSE_ROW
			: NORMAL_ROW}"
	>
		<!-- IDENTITY. An env chip's colour is a function of the environment's
		     NAME and nothing else — status lives in the State track two columns
		     right, never on this chip.
		     LEFT-ALIGNED IN ITS TRACK, so the column has a hard LEFT edge. See
		     the measurement at `ROW_GRID`: flush right the left edges spanned
		     75.0px down 22 rows.

		     AT 390 IT TAKES ITS OWN LINE, and that is the phone card's whole
		     alignment fix. Inline before the name it was a VARIABLE-WIDTH
		     leading element — `DEV` 34.5px, `PROD` 41.3px, `STAGING` 61.8px,
		     `AP-NORTHEAST-1` 109.5px — so the name after it, and every caption
		     that inherits the name's x, started somewhere different on every
		     card: a 75px ragged left edge down the stack, invisible inside any
		     one card and glaring when you read down them. This is the SAME
		     defect the 120px track fixed at 1440, and 120px of a 324px content
		     box is not a track a phone can afford. On its own line the badge
		     costs no horizontal budget at all, is itself at a constant x, and
		     is still the first thing read. The line is bought back below by
		     folding the sub onto the name. -->
		<span class="env-line col-start-1 row-start-1">
			<Chip role="env" theme={r.theme} label={r.badge} title={r.tier} wide class="shrink-0" />
		</span>

		<!-- THE SUB FOLDS ONTO THE NAME AT 390 and unfolds to the caption line
		     at `lg`. That is what pays for the badge's new line: a healthy card
		     was `name+age / sub / metrics` = 3 lines and is `badge+age /
		     name+sub / metrics` = 3 lines. Card height is unchanged, and every
		     content line now starts at the card's own padding edge.
		     `items-baseline` at 390 so a 13px mono name and an 11px sans kind
		     sit on one baseline rather than being centred against each other;
		     `lg:flex-col` restores the 20px mark line over a 4px-gapped
		     caption, which is the desktop row's two-baseline contract. -->
		<div
			class="col-start-1 col-end-3 row-start-2 flex min-w-0 flex-row flex-wrap items-baseline gap-x-2 gap-y-1 lg:col-start-2 lg:col-end-3 lg:row-start-1 lg:flex-col lg:items-stretch lg:gap-1"
		>
			<!-- THE SUBJECT LINE IS THE NAME AND NOTHING ELSE now. The state chip
			     used to sit here, beside the title, and that put the page's
			     headline fact at a DIFFERENT x on every row — after `Development`
			     on one and after `prod-ap-northeast-1` on another, a 110px swing.
			     A mark you have to find is a mark that does not pull. It moved to
			     its own fixed track (below), which is the whole reason the tick
			     strip's 200px was worth reclaiming rather than deleting outright.

			     BOLD ON AN ADVERSE ROW. Weight is the second zero-colour channel
			     after the ground, and the two agree: the rows the eye lands on
			     are the rows with something in the State column. -->
			<span class="env-line min-w-0 gap-2">
				<span
					class="t-code min-w-0 truncate text-gray-900 dark:text-white {r.severity >= 3
						? 'font-semibold'
						: ''}">{r.title}</span
				>
			</span>
			<!-- WHAT KIND OF PLACE THIS IS. Constant per environment, so it never
			     competes with the State column for the reader's attention: the
			     column that changes is the one that matters. -->
			{#if r.sub}
				<span class="t-micro truncate text-gray-500 dark:text-gray-400">{r.sub}</span>
			{/if}
		</div>

		<!-- LAST DEPLOY — line 1 at phone width, its own track at `lg`. It is
		     the cheapest honest answer to "is this place still moving", and it
		     is always populated, unlike a sparkline over a 24h window that most
		     of eighteen regions have nothing in. -->
		<span
			class="env-line col-start-2 row-start-1 justify-self-end lg:col-start-6 lg:justify-self-start"
		>
			{#if r.lastDeployTs}
				<span class="t-micro text-gray-500 dark:text-gray-400" title={formatDate(r.lastDeployTs)}
					>{formatTimeAgoCompact(r.lastDeployTs, $now)}</span
				>
			{:else}
				<span class="t-micro text-gray-500 dark:text-gray-400">—</span>
			{/if}
		</span>

		<!-- CRITERION 1 — is this environment healthy. ONE COLUMN, ONE x.
		     The mark is the row's worst state as a WORD; the caption NAMES the
		     apps it belongs to. An environment with nothing wrong prints
		     NOTHING here — mark the deviation, never the norm — and the empty
		     20px mark line keeps the column's baseline, the same trick the
		     Behind column uses for `all on head`.

		     `stuck` takes the alarm and `failing` takes `rank`'s red text-only,
		     so the alarm is still the only chip on this page with a FILL and
		     still the loudest mark on it. ZERO colour values added: both roles
		     were already rendering on this page one track to the left. -->
		<!-- AT PHONE WIDTH AN EMPTY STATE CELL IS HIDDEN, NOT HELD. The 20px
		     mark line exists to keep one BASELINE across a row of columns, and
		     below `lg` there are no columns — the row is a stack, so an empty
		     cell is 24px of nothing between `pipeline stage` and `6 apps` on
		     every healthy row. Measured at 390 before this: 18 of 22 rows paid
		     it. `hidden lg:flex`, so the desktop baseline is untouched. -->
		<div
			class="col-start-1 col-end-3 row-start-3 min-w-0 flex-col gap-1 lg:col-start-3 lg:col-end-4 lg:row-start-1 lg:flex {r
				.needs.length > 0
				? 'flex'
				: 'hidden'}"
		>
			<span class="env-line">
				{#if r.needs.length > 0 && r.needs[0].word === 'stuck'}
					<Chip
						role="alarm"
						label="stuck"
						title="{r.needs.length} app{r.needs.length === 1 ? ' is' : 's are'} stuck in {r.tier}"
						class="shrink-0"
					/>
				{:else if r.needs.length > 0}
					<Chip
						role="failing"
						label="failing"
						title="The last deploy failed in {r.tier}: {r.needs
							.filter((n) => n.word === 'failing')
							.map((n) => n.name)
							.join(', ')}"
						class="shrink-0"
					/>
				{/if}
			</span>
			<!-- WHICH APPS. The one thing the tick strip could only say on hover,
			     and the fact that makes reading this page beat reading 22 env
			     pages. Neutral ink — colour goes on marks, never on prose. -->
			{#if r.needs.length > 0}
				<span
					class="t-micro truncate text-gray-500 dark:text-gray-400"
					title={r.needs.map((n) => `${n.name} ${n.word}`).join(' · ')}
				>
					{#each r.needs.slice(0, 2) as n, i (n.name + n.word)}{i > 0 ? ' · ' : ''}<span
							class="t-code-sm">{n.name}</span
						>{/each}{#if r.needs.length > 2}&nbsp;· +{r.needs.length - 2}{/if}
				</span>
			{/if}
		</div>

		<!-- ── THE PHONE CARD'S MEASURE LINE ──────────────────────────────
		     > *"Environments list is a problem on mobile."* — the human.

		     THE DEFECT: two grid cells that are legitimate COLUMNS at `lg`
		     survived into a STACK at 390 still carrying their column alignment.
		     `4 apps` sat flush left on one line and `−4` / `1 of 4 behind` sat
		     flush RIGHT on the next, so a card zigzagged; and stripped of the
		     column headers that explain them, `4` and `−4` read as two
		     unrelated figures with nothing joining them. On a settled row it
		     was worse — a lone `all on head` floating right under a
		     left-aligned `4 apps`.

		     THE FIX IS `display: contents`, which is the one mechanism that
		     lets ONE markup be two designs rather than one design narrowed.
		     Below `lg` this wrapper is a real box: a single LEFT-ALIGNED
		     wrapping line reading `3 apps · −19 · 3 of 3 behind`, where the
		     rank chip sits 8px from the caption that labels it, so adjacency
		     does the job the column header does on desktop. At `lg` the wrapper
		     is `display: contents` — it stops generating a box entirely and its
		     two children become direct grid items again, taking the `Apps` and
		     `Behind` tracks by their own `lg:col-start-*`. **The desktop row is
		     byte-identical; nothing about the two-baseline alignment moves.**

		     Everything on the card is now at ONE x. The only right-aligned
		     object left is the deploy age on the identity line, which is the
		     top-right timestamp slot every list in this product uses and is
		     paired with the name rather than orphaned from it.

		     `t-micro` numbers are unchanged and so is the ink: capacity is
		     `gray-900 / white` (DESIGN.md: *"`gray-300` / `gray-600` may NEVER
		     carry a number"*). -->
		<div
			class="col-start-1 col-end-3 row-start-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 lg:contents"
		>
			<!-- CRITERION 2 — capacity + occupancy. -->
			<div class="env-line lg:col-start-4 lg:row-start-1">
				<span class="t-dense text-gray-900 tabular-nums dark:text-white">{r.apps}</span>
				<span class="t-micro text-gray-500 dark:text-gray-400"
					>&nbsp;app{r.apps === 1 ? '' : 's'}</span
				>
			</div>

			<!-- CRITERION 3 — how far behind, in the product's ONE rank chip. The
		     mark is the DEEPEST lag here; the caption is how much of the
		     environment is behind at all. An environment with nothing behind
		     prints no chip: the norm is not marked, and `head` in a column of
		     `−19`s would be the good-news word drawn eighteen times — but the
		     20px mark line is kept EMPTY rather than collapsed, so the caption
		     under it stays on the column's one baseline. That is the whole
		     defect the human reported: a column that mixed a chip-over-caption
		     stack with a bare centred sentence had no baseline at all. -->
			<div
				class="flex min-w-0 flex-row items-center gap-x-2 lg:col-start-5 lg:row-start-1 lg:flex-col lg:items-start lg:gap-1"
			>
				<span class="env-line">
					{#if r.worstBehind > 0}
						<!-- `count` GRAY WHEN THE WHOLE BRACKET IS BEHIND — see
					     `fleetAllBehind` above. Same chip, same geometry, same
					     word; only the tone follows whether this row is saying
					     something its own group header has not already said. -->
						<Chip
							role={groupAllBehind ? 'count' : 'rank'}
							label={`−${r.worstBehind}`}
							title="The deepest lag in {r.tier}: {r.worstBehind} build{r.worstBehind === 1
								? ''
								: 's'} behind that app's newest"
							wide
						/>
					{:else if r.divergedCount > 0}
						<Chip
							role="diverged"
							label="diverged"
							title="Running a build that is on no environment’s release list"
							wide
						/>
					{/if}
				</span>
				<span class="t-micro truncate text-gray-500 dark:text-gray-400">
					{#if r.behindCount + r.divergedCount > 0}
						{r.behindCount + r.divergedCount} of {r.apps} behind
					{:else if r.apps > 0}
						all on head
					{:else}
						—
					{/if}
				</span>
			</div>
		</div>

		<ChevronRightOutline
			class="hidden h-4 w-4 shrink-0 text-gray-400 lg:col-start-7 lg:row-start-1 lg:mt-1 lg:block dark:text-gray-500"
			aria-hidden="true"
		/>
	</a>
{/snippet}

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<div class="mb-6">
		<div class="flex flex-wrap items-baseline gap-x-3">
			<h1 class="t-display truncate text-gray-900 dark:text-white">Environments</h1>
			{#if envTiers.length > 0}
				<span class="t-code-sm text-gray-500 dark:text-gray-400"
					>{envTiers.length} env{envTiers.length === 1 ? '' : 's'}</span
				>
			{/if}
		</div>
		{#if verdict}
			<p class="t-headline mt-2 text-gray-900 dark:text-white">{verdict}</p>
		{/if}
	</div>

	{#if query.isLoading}
		<div class="space-y-6">
			<div class="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
			<div class="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
		</div>
	{:else if query.isError}
		<div
			class="rounded-xl border border-gray-200 p-4 text-sm text-red-700 dark:border-gray-700 dark:text-red-400"
		>
			Failed to load environments: {(query.error as Error).message}
		</div>
	{:else if envTiers.length === 0}
		<div class="mx-auto max-w-2xl py-12 text-center">
			<p class="t-body font-semibold text-gray-900 dark:text-white">No environments configured</p>
			<p class="t-dense mx-auto mt-2 max-w-md text-gray-500 dark:text-gray-400">
				Create <code class="t-code-sm rounded bg-gray-100 px-1 dark:bg-gray-800">Environment</code>
				resources to see what is running in each one.
			</p>
		</div>
	{:else}
		<div class="space-y-6">
			<!-- ── BRACKET 1 · THE LINE ─────────────────────────────────── -->
			{#if stageRows.length > 0}
				<section>
					<div class="mb-3 flex flex-wrap items-baseline gap-x-3">
						<h2 class="t-label text-gray-500 dark:text-gray-400">
							{regionRows.length > 0 ? 'Pipeline stages' : 'Environments'}
						</h2>
						<span class="t-micro text-gray-500 dark:text-gray-400">
							{stageRows.length}
							{stageRows.length === 1 ? 'environment' : 'environments'} · promotion order
						</span>
					</div>
					<div class="{PANEL} overflow-hidden">
						{@render columnHeader()}
						<div class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each stageRows as r (r.tier)}
								{@render envRow(r, stagesAllBehind)}
							{/each}
						</div>
					</div>
				</section>
			{/if}

			<!-- ── BRACKET 2 · THE SET ──────────────────────────────────────
			     "Prod regions bracketed as a fleet" (`PAGE-CRITERIA.md`). One
			     panel, one header, one rollup — where the previous build drew
			     eighteen bordered panels with one app each. The header carries
			     the SAME strip its rows do, one scope up, which is the idiom
			     the rollout-detail page already uses for a panel's rolled-up
			     verdict (`Health Checks · 1/1 healthy`, `Resources · 6/6
			     ready`). -->
			{#if regionRows.length > 0}
				<section>
					<div class="mb-3 flex flex-wrap items-baseline gap-x-3">
						<h2 class="t-label text-gray-500 dark:text-gray-400">Production fleet</h2>
						<span class="t-micro text-gray-500 dark:text-gray-400">
							{regionRows.length} regions · {fleetApps} app{fleetApps === 1 ? '' : 's'} · worst first
						</span>
					</div>
					<div class="{PANEL} overflow-hidden">
						<!-- THE FLEET ROLLUP. Not a row — it has no environment of
						     its own to link to — so it is the panel's header line,
						     with the same marks in the same tracks its members use so
						     the fleet and a region are read the same way. -->
						<div
							class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 border-b border-gray-100 bg-gray-50 px-4 py-3 {ROW_GRID} dark:border-gray-700 dark:bg-gray-700/30"
						>
							<span class="env-line col-start-1 row-start-1">
								<Chip
									role="count"
									label="fleet"
									title="All {regionRows.length} production regions, rolled up"
									wide
									class="shrink-0"
								/>
							</span>
							<span
								class="env-line col-start-1 col-end-3 row-start-2 min-w-0 lg:col-start-2 lg:col-end-3 lg:row-start-1"
							>
								<span class="t-dense min-w-0 truncate font-semibold text-gray-900 dark:text-white"
									>All regions</span
								>
							</span>
							<div
								class="col-start-1 col-end-3 row-start-3 min-w-0 flex-col gap-1 lg:col-start-3 lg:col-end-4 lg:row-start-1 lg:flex {fleetNeeds.length >
								0
									? 'flex'
									: 'hidden'}"
							>
								<span class="env-line">
									{#if fleetNeeds.length > 0 && fleetNeeds[0].word === 'stuck'}
										<Chip
											role="alarm"
											label="stuck"
											title="{fleetNeeds.length} app-region pair{fleetNeeds.length === 1
												? ' is'
												: 's are'} stuck across the production fleet"
											class="shrink-0"
										/>
									{:else if fleetNeeds.length > 0}
										<Chip
											role="failing"
											label="failing"
											title="Last deploy failed: {fleetNeeds
												.filter((n) => n.word === 'failing')
												.map((n) => n.name)
												.join(', ')}"
											class="shrink-0"
										/>
									{/if}
								</span>
								{#if fleetNeeds.length > 0}
									<span
										class="t-micro truncate text-gray-500 dark:text-gray-400"
										title={fleetNeeds.map((n) => `${n.name} ${n.word}`).join(' · ')}
										>{fleetNeeds.length}
										of {fleetApps} need someone</span
									>
								{/if}
							</div>
							<!-- THE ROLLUP TAKES THE ROW'S OWN MEASURE LINE, and it had
							     the defect in its worst form: `18 apps` was pinned FLUSH
							     RIGHT on the identity line at 390 while its own `−4` and
							     `18 of 18 behind` sat flush LEFT two lines below. Same
							     `lg:contents` wrapper, same result — one left-aligned
							     line at phone width, two untouched columns at `lg`. -->
							<div
								class="col-start-1 col-end-3 row-start-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 lg:contents"
							>
								<div class="env-line lg:col-start-4 lg:row-start-1">
									<span class="t-dense text-gray-900 tabular-nums dark:text-white">{fleetApps}</span
									>
									<span class="t-micro text-gray-500 dark:text-gray-400"
										>&nbsp;app{fleetApps === 1 ? '' : 's'}</span
									>
								</div>
								<div
									class="flex min-w-0 flex-row items-center gap-x-2 lg:col-start-5 lg:col-end-6 lg:row-start-1 lg:flex-col lg:items-start lg:gap-1"
								>
									<span class="env-line">
										{#if fleetWorstBehind > 0}
											<Chip
												role="rank"
												label={`−${fleetWorstBehind}`}
												title="The deepest lag anywhere in the production fleet"
												wide
											/>
										{/if}
									</span>
									<span class="t-micro truncate text-gray-500 dark:text-gray-400">
										{#if fleetBehindCount > 0}
											{fleetBehindCount} of {fleetApps} behind
										{:else}
											all on head
										{/if}
									</span>
								</div>
							</div>
						</div>
						{@render columnHeader()}
						<div class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each regionRows as r (r.tier)}
								{@render envRow(r, fleetAllBehind)}
							{/each}
						</div>
					</div>
				</section>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* ── THE MARK LINE. Every column's first line is exactly 20px tall and
	     centres whatever mark it holds; the caption under it is 4px below.
	     Two baselines, every column, every row.

	     20px IS THE CHIP'S OWN HEIGHT, not a new number — the tallest mark any
	     of these cells carries is a chip, so the band is sized to it and the
	     `13m`, the `6 apps`, the environment name and the health ticks all
	     centre against the same edge the `−19` chip does.

	     IT MUST HOLD ITS HEIGHT WHEN IT IS EMPTY. That is the `Behind` column's
	     whole fix: an environment on head prints no rank chip (mark the
	     deviation, never the norm), and before this the cell collapsed and slid
	     `all on head` up into the band where every other row draws a chip. */
	.env-line {
		display: flex;
		align-items: center;
		min-height: 20px;
	}
</style>
