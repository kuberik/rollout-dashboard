<svelte:options runes={true} />

<script lang="ts">
	/**
	 * DEPENDENCIES — what this rollout is waiting on, on both of its axes.
	 *
	 * ── THE TWO AXES ARE NEVER ONE LIST ─────────────────────────────────
	 *
	 *   · a CONTRACT GATE (`RolloutDependency`) is a PERMISSION about ANOTHER
	 *     SERVICE — "am I allowed to go at all";
	 *   · the PROMOTION CHAIN is a DISTANCE on THIS service's own line —
	 *     "how far have I got".
	 *
	 * so they get two cards, two geometries, and no shared row. A single list
	 * holding `prod depends on staging` beside `frontend depends on api` would
	 * put two different relations in one badge.
	 *
	 * ── ⛔ THE PAGE WAS SAYING SOMETHING FALSE, AND THE FIX IS THE SOURCE ──
	 *
	 * From the human, on the live cluster: the DEV node of
	 * `hello-frontend-app` rendered a `NOT DEP…` chip — "this environment has
	 * never deployed" — beside a promotion chain with exactly ONE node, for an
	 * app that runs in three environments. `/apps/hello-frontend-app` showed
	 * `DEV 2.66.0-66`, `STAGING 2.66.0-66`, `PROD 2.66.0-66`, `3 of 3 up to
	 * date`, and the API agreed. **Both defects are one bug and the bug is
	 * WHICH OBJECT THE CHAIN WAS READ FROM.**
	 *
	 * The chain was derived entirely from
	 * `Environment.status.environmentInfos`, which the environment-controller
	 * populates from its GitHub-deployments backend. For `hello-frontend-app`
	 * that list is DEGENERATE — measured on the hub, all three namespaces
	 * serve exactly:
	 *
	 *     "environmentInfos": [ { "environment": "dev" } ]
	 *
	 * one self-entry, no `relationship`, no `history`. `chain()` therefore
	 * produced one row, and `currentEntry()` returned null for it, which
	 * `StageChain` renders as the `not deployed` chip. Every step was locally
	 * correct and the output was a confident lie, because an EMPTY MIRROR was
	 * being read as an OBSERVATION. (`hello-world-app`'s environment IS fully
	 * populated, which is why this never showed there — and the `MOCK_API=1`
	 * fixture copied the populated shape rather than the live one, so no test
	 * could see it either. Both are fixed: the fixture now carries the live
	 * degenerate shape.)
	 *
	 * ⭐ SO THE CHAIN IS BUILT FROM THE ROLLOUTS, WHICH ARE THE AUTHORITY.
	 * `Rollout.status.history` is what the rollout controller itself wrote
	 * when it deployed; it is the same source `/apps/[name]` reads, which is
	 * exactly why that page was right about this app while this one was
	 * wrong. `environmentInfos` still contributes — it is UNIONED IN, so an
	 * environment the rollout list cannot see is not lost — but it may no
	 * longer be the only witness for "never deployed".
	 *
	 * The ORDER still comes from the `After` edges, because that is a fact
	 * about the pipeline; it is read from each sibling `Environment`'s own
	 * `spec.relationship` (`prod After staging`, `staging After dev`), with
	 * `environmentInfos[].relationship` as the fallback.
	 *
	 * **The general rule this page now obeys: an absent record is not an
	 * observation.** Nothing here says "never deployed" unless a ROLLOUT with
	 * an empty history says so.
	 *
	 * ── THE COMPOSITION PASS AND THE NOVICE PASS, BOTH OF WHICH THIS PAGE
	 *    HAD MISSED ────────────────────────────────────────────────────────
	 *
	 * It was built before `COMPOSITION-GRAMMAR.md` existed and no agent owned
	 * it during either pass, so it kept the shape all six rejected pages had:
	 * `t-label` eyebrows over bare bordered boxes, no icons, no rollups, a
	 * 12px type ceiling, and mechanism vocabulary throughout. Both cards are
	 * `Card` now (8px radius, 47px header, 16px icon, right-aligned rollup),
	 * the one blocking fact is an `AlertPanel`, buttons are `.btn` at 14px via
	 * `NextStep`, and the type runs 24 → 10.
	 *
	 * THE JARGON, AND WHAT IT BECAME:
	 *   `CONTRACT GATES`                 → `Waiting on other services`
	 *   `PROMOTION CHAIN`                → `Where it's running`
	 *   `NEEDS api`                      → the `[API][1.66.0]` version badge
	 *   `deployed 1.66.0 · rel-66`       → `Now on api 1.66.0` / `from rel-66`
	 *   `in hello-dep-prod`              → `provided from hello-dep-prod`
	 *   `gates 2 of 7 environments`      → `no gate in 5 of 7 environments`
	 *   `N older builds blocked`         → `N older version(s) also held`
	 *   `requires api ^3.0.0 ·
	 *    ConstraintNotSatisfied`         → `BlockReason` — the consequence in
	 *                                       English, `rule:` demoted below it
	 *   `NOT DEP…` (truncated)           → gone; and where it is genuinely
	 *                                       true it is `never deployed`, `wide`
	 *
	 * ── NOTHING DRAWS `Satisfied=True` ──────────────────────────────────
	 *
	 * It is the norm and true on every gate on the live cluster. There is no
	 * green tick, no "satisfied" chip and no per-environment row for it. The
	 * card states its rollup once in the header, in neutral gray, and the
	 * adverse case — `blockedReleases` a person actually wants — is the only
	 * thing that spends colour.
	 */
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		ServerSolid,
		ShareNodesSolid,
		ArrowUpRightFromSquareOutline
	} from 'flowbite-svelte-icons';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import BlockReason, { contractBlockReason } from '$lib/components/BlockReason.svelte';
	import Card from '$lib/components/Card.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import NextStep from '$lib/components/NextStep.svelte';
	import StageChain from '$lib/components/StageChain.svelte';
	import UpToDate from '$lib/components/UpToDate.svelte';
	import { rolloutQueryOptions, rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getRolloutEnvironmentTheme, shortEnvLabel } from '$lib/environment-theme';
	import type { EnvironmentTheme } from '$lib/environment-theme';
	import { rolloutPath } from '$lib/source-dashboard';
	import { groupRolloutsByApp } from '$lib/version-utils';
	import type { Rollout, Environment, RolloutDependency } from '../../../../../../types';
	import { dependencySourceCluster } from '../../../../../../types/rollout-dependency-types';
	import {
		buildOrder,
		chain,
		contractBlocks,
		hopBetween,
		rankOfTag,
		type ChainEnv,
		type ContractBlock,
		type EnvHistoryEntry,
		type EnvInfo,
		type Release
	} from '$lib/view-models/dependencies';

	const cluster = $derived(page.params.cluster as string);
	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);

	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({ namespace, name, cluster, options: { refetchInterval: 5000 } })
	);

	/**
	 * THE LIST, FOR THE THINGS A SINGLE-ROLLOUT FETCH CANNOT KNOW.
	 *
	 *   1. `rolloutDependencies` — a dependency lives in the CONSUMER
	 *      environment's namespace, so the gates on staging and prod are in
	 *      namespaces this page's own detail fetch never touches.
	 *   2. Every sibling environment's ROLLOUT — the authority for what is
	 *      deployed where. See the header comment: this is the fix for the
	 *      chain that claimed dev had never deployed.
	 *   3. Each sibling's NAMESPACE, SOURCE CLUSTER and OWN theme, so a node
	 *      links inside this dashboard and is painted its own colour rather
	 *      than this environment's.
	 *
	 * The key is shared with `/rollouts`, so this is a cache read on any
	 * navigation from a list page rather than a second request.
	 */
	const listQuery = createQuery(() =>
		rolloutsListQueryOptions({ options: { refetchInterval: 15000 } })
	);

	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null | undefined);
	const environment = $derived(rolloutQuery.data?.environment as Environment | undefined);
	const environmentInfos = $derived(
		(environment?.status?.environmentInfos ?? []) as unknown as EnvInfo[]
	);

	const currentEnv = $derived(environment?.spec?.environment ?? '');
	const currentTheme = $derived(getRolloutEnvironmentTheme(rollout, environment));
	const appTitle = $derived(rollout?.status?.title || name);

	// ── THE APP'S OTHER ENVIRONMENTS ────────────────────────────────────
	const listRollouts = $derived((listQuery.data?.rollouts?.items ?? []) as Rollout[]);
	const listEnvironments = $derived((listQuery.data?.environments?.items ?? []) as Environment[]);

	type Sibling = {
		env: string;
		namespace: string;
		cluster: string;
		theme: EnvironmentTheme | null;
		rollout: Rollout;
		environment: Environment | null;
	};

	/**
	 * Every environment of this app, keyed by its tier name. Built with the
	 * SAME grouping `/apps` and `/apps/[name]` use, so this page cannot
	 * disagree with them about which rollouts are one app — which is the
	 * whole point, given that disagreement is what produced the false
	 * `not deployed` chip.
	 */
	const group = $derived(groupRolloutsByApp(listRollouts, listEnvironments).get(name));
	const boundToEnvironments = $derived(group?.hasEnvironmentBinding ?? false);

	const siblings = $derived.by<Map<string, Sibling>>(() => {
		const out = new Map<string, Sibling>();
		if (!boundToEnvironments) return out;
		for (const cell of group?.cells ?? []) {
			if (!cell.envName) continue;
			out.set(cell.envName, {
				env: cell.envName,
				namespace: cell.rollout.metadata?.namespace ?? '',
				cluster: cell.sourceCluster || cluster,
				theme: cell.theme,
				rollout: cell.rollout,
				environment: cell.environment ?? null
			});
		}
		return out;
	});

	/**
	 * The theme for one environment.
	 *
	 * The fallback passes NO ROLLOUT, deliberately. `getRolloutEnvironmentTheme`
	 * lets a rollout's `dashboard.rollout.kuberik.com/theme` annotation win over
	 * the environment name, so handing it THIS rollout while asking about
	 * STAGING would paint staging in this environment's colour.
	 */
	function themeFor(env: string): EnvironmentTheme | null {
		return siblings.get(env)?.theme ?? getRolloutEnvironmentTheme(null, env);
	}

	function hrefFor(env: string): string | undefined {
		// The environment this page IS gets no link. "You are here" is already
		// marked by the breadcrumb and the header chip.
		if (env === currentEnv) return undefined;
		const s = siblings.get(env);
		if (!s || !s.namespace) return undefined;
		return rolloutPath(s.cluster, s.namespace, name, 'dependencies');
	}

	/**
	 * THE KEY A CONTRACT GATE IS FILED UNDER, WHICH IS NOT ALWAYS AN
	 * ENVIRONMENT. A rollout bound to NO `Environment` has no tier — and that
	 * is exactly the rollout for which a contract gate is the only thing
	 * holding it back — so the key falls back to the NAMESPACE, which is what
	 * `groupRolloutsByApp` already does. It is a grouping key and never
	 * printed.
	 */
	const currentEnvKey = $derived(currentEnv || namespace);

	// ── AXIS 1 · THE PROMOTION CHAIN ────────────────────────────────────

	/**
	 * ⭐ THE CHAIN'S INPUT, UNIONED FROM THE TWO SOURCES, ROLLOUT FIRST.
	 *
	 * See the header comment for the defect. In one sentence: the rollout is
	 * the thing that deployed, so the rollout's own history is what "is it
	 * deployed" means, and `environmentInfos` is a mirror that can be empty
	 * without that meaning anything at all.
	 *
	 * Per environment:
	 *   · `history`      — the sibling ROLLOUT's `status.history`, falling back
	 *                      to `environmentInfos[].history` when this cluster's
	 *                      list cannot see that rollout at all.
	 *   · `relationship` — the sibling `Environment`'s own `spec.relationship`
	 *                      (`{ environment, type: 'After' }`), falling back to
	 *                      `environmentInfos[].relationship`. Both carry the
	 *                      same shape; the spec is the declaration and the
	 *                      info is the mirror of it.
	 *
	 * The environment SET is the union of both, so neither source can drop a
	 * node the other knows about.
	 */
	const chainInfos = $derived.by<EnvInfo[]>(() => {
		if (!boundToEnvironments && environmentInfos.length === 0) return [];
		const byInfo = new Map(environmentInfos.map((i) => [i.environment, i] as const));
		const names: string[] = [];
		for (const env of siblings.keys()) names.push(env);
		for (const i of environmentInfos) if (!names.includes(i.environment)) names.push(i.environment);

		return names.map((env) => {
			const s = siblings.get(env);
			const info = byInfo.get(env);
			const rolloutHistory = (s?.rollout.status?.history ?? []) as unknown as EnvHistoryEntry[];
			const rel =
				(s?.environment?.spec as { relationship?: { environment: string; type: string } } | undefined)
					?.relationship ?? info?.relationship;
			return {
				environment: env,
				relationship: rel,
				history: rolloutHistory.length > 0 ? rolloutHistory : (info?.history ?? [])
			};
		});
	});

	/**
	 * THIS APP'S BUILD LADDER — one derivation, newest first, DERIVED FROM
	 * `created` rather than trusted from the array (the live hub serves
	 * `availableReleases` OLDEST-first).
	 *
	 * IT IS A UNION ACROSS EVERY ENVIRONMENT, not this rollout's list alone,
	 * for the reason `buildLadder` on `/apps/[name]` gives: each rollout has
	 * its OWN retention window, so prod may still know a build dev has aged
	 * out. Every version any environment has DEPLOYED is folded in too, so a
	 * build an environment is currently running can never be missing from the
	 * ladder and render as `unknown`.
	 */
	const order = $derived.by(() => {
		const releases: Release[] = [];
		const push = (r: Rollout | null | undefined) => {
			for (const rel of r?.status?.availableReleases ?? []) releases.push(rel as Release);
			for (const h of r?.status?.history ?? []) if (h.version) releases.push(h.version as Release);
		};
		push(rollout);
		for (const s of siblings.values()) push(s.rollout);
		for (const i of environmentInfos) for (const h of i.history ?? []) releases.push(h.version);
		return buildOrder(releases);
	});

	const chainRows = $derived(chain(chainInfos, order));
	const envOrder = $derived(chainRows.map((r) => r.env));

	/**
	 * The deploy-status mark, character for character `/apps/[name]`'s `DOT`.
	 * `StageChain` draws it ONLY for a deviation — a `Succeeded` node draws no
	 * dot — so a converged chain carries no status colour at all.
	 */
	const DOT: Record<string, { cls: string; word: string }> = {
		Failed: { cls: 'bg-red-700 dark:bg-red-400', word: 'deploy failed' },
		Deploying: { cls: 'bg-blue-700 dark:bg-blue-400', word: 'deploying' },
		InProgress: { cls: 'bg-yellow-700 dark:bg-yellow-400', word: 'baking' },
		Succeeded: { cls: 'bg-green-700 dark:bg-green-400', word: 'deploy succeeded' },
		Cancelled: { cls: 'bg-gray-300 dark:bg-gray-600', word: 'bake cancelled' },
		None: { cls: 'bg-gray-300 dark:bg-gray-600', word: 'no deploy recorded' }
	};

	/**
	 * MARK THE DEVIATION, NEVER THE NORM — the fan-out half of it.
	 *
	 * A production region on the build its FLEET agreed on keeps its full
	 * number and its full build and gives up only the colour. Measured on the
	 * seven-environment fixture without it, the chain printed SIX `N behind`
	 * chips down one column. A stage with a single child is the LINE, not a
	 * set, so it never goes quiet.
	 */
	const quietEnvs = $derived.by<Set<string>>(() => {
		const quiet = new Set<string>();
		const byParent = new Map<string, ChainEnv[]>();
		for (const r of chainRows) {
			const key = r.after ?? '';
			if (!byParent.has(key)) byParent.set(key, []);
			byParent.get(key)!.push(r);
		}
		for (const group of byParent.values()) {
			if (group.length < 2) continue;
			const counts = new Map<string, number>();
			for (const r of group) if (r.tag) counts.set(r.tag, (counts.get(r.tag) ?? 0) + 1);
			let modal: string | null = null;
			let best = 0;
			for (const [tag, n] of counts) {
				const better =
					n > best || (n === best && modal !== null && rankOfTag(order, tag) < rankOfTag(order, modal));
				if (better) {
					modal = tag;
					best = n;
				}
			}
			// A set where every member is on a different build has no agreed
			// build, so nothing recedes — that IS the interesting case.
			if (modal === null || best < 2) continue;
			for (const r of group) if (r.tag === modal) quiet.add(r.env);
		}
		return quiet;
	});

	const chainNodes = $derived(
		chainRows.map((r: ChainEnv) => {
			const d = DOT[r.bakeStatus ?? 'None'] ?? DOT.None;
			return {
				key: r.env,
				label: shortEnvLabel(themeFor(r.env)) || r.env,
				title: r.env,
				theme: themeFor(r.env),
				version: r.display,
				rank: r.rank,
				// Divergence needs the release LINE of every environment, which is
				// `/apps/[name]`'s `divergedFromLine`. A build this page cannot
				// place renders `unknown` instead of a claim it cannot support.
				diverged: false,
				dotClass: d.cls,
				statusWord: d.word,
				settled: r.bakeStatus === 'Succeeded',
				quiet: quietEnvs.has(r.env),
				href: hrefFor(r.env)
			};
		})
	);

	/**
	 * ⛔ A HOP IS A PROMOTION EDGE, NOT THE GAP BETWEEN TWO ADJACENT ROWS.
	 *
	 * Measured on the seven-environment fixture, the old `map` drew a rail and
	 * a count between EVERY consecutive pair, including
	 * `prod-af-south-1 → prod-ap-southeast-2` — two SIBLING production regions
	 * that share a parent and promote from it independently. It printed
	 * `2 versions ahead` for a comparison that is not a promotion at all, and a
	 * SOLID rail (which means "in sync") between the pairs whose ranks happened
	 * to match.
	 *
	 * `DESIGN-INTENT.md`: *"Stages are a LINE. Production regions are a SET.
	 * Do not force one shape onto both."* So a hop is drawn only where there is
	 * genuinely one edge to count: the next row is this row's `After` CHILD and
	 * this row has exactly ONE child. Inside a fan-out nothing is drawn — each
	 * region's own `N behind` chip already carries its distance, and it is the
	 * only honest statement available without picking one sibling as the
	 * fleet's representative.
	 */
	const childCount = $derived.by<Map<string, number>>(() => {
		const m = new Map<string, number>();
		for (const r of chainRows) {
			if (!r.after) continue;
			m.set(r.after, (m.get(r.after) ?? 0) + 1);
		}
		return m;
	});

	const chainHops = $derived(
		chainRows.map((r, i) => {
			const next = chainRows[i + 1];
			if (!next) return null;
			if (next.after !== r.env) return null;
			if ((childCount.get(r.env) ?? 0) !== 1) return null;
			return hopBetween(r, next);
		})
	);

	/** The card's rolled-up answer — `UpToDate`'s wording, shared with `/apps`. */
	const chainRollup = $derived.by(() => {
		const deployed = chainRows.filter((r) => r.tag);
		return {
			onHead: deployed.filter((r) => r.rank === 0).length,
			deployed: deployed.length,
			total: chainRows.length,
			spread: new Set(deployed.map((r) => r.tag)).size || 1,
			pending: chainRows.length - deployed.length,
			unknown: deployed.filter((r) => r.rank < 0).length
		};
	});

	// ── AXIS 2 · THE CONTRACT GATES ─────────────────────────────────────

	/**
	 * Read the dependencies from WHEREVER the backend lands them. The list
	 * payload is where they ride today; reading the detail payload too costs
	 * one line and means this page keeps working if they ever arrive there.
	 */
	const deps = $derived.by<RolloutDependency[]>(() => {
		const fromList = listQuery.data?.rolloutDependencies?.items;
		const fromDetail = (
			rolloutQuery.data as { rolloutDependencies?: { items?: RolloutDependency[] } }
		)?.rolloutDependencies?.items;
		const all = [...(fromList ?? []), ...(fromDetail ?? [])];
		const seen = new Set<string>();
		const out: RolloutDependency[] = [];
		for (const d of all) {
			// A dependency gates the Rollout named in `rolloutRef`, in its own
			// namespace. Anything pointing at another rollout is not this page's.
			if (d?.spec?.rolloutRef?.name !== name) continue;
			const k = `${d.metadata?.namespace ?? ''}/${d.metadata?.name ?? ''}`;
			if (seen.has(k)) continue;
			seen.add(k);
			out.push(d);
		}
		return out;
	});

	/** Namespace of every environment of this app, so a dependency can be placed. */
	const envByNamespace = $derived.by<Map<string, string>>(() => {
		const m = new Map<string, string>();
		for (const s of siblings.values()) if (s.namespace) m.set(s.namespace, s.env);
		// This rollout's own namespace is known from the route even when the
		// list has not arrived, so its own gate is never invisible.
		m.set(namespace, currentEnvKey);
		return m;
	});

	const currentTagByEnv = $derived.by<Map<string, string | null>>(() => {
		const m = new Map(chainRows.map((r) => [r.env, r.tag] as const));
		// With no chain there is nothing to read the running build from, so it
		// comes off the rollout's own newest history entry. Without this
		// `splitBlocked` treats EVERY blocked build as wanted.
		if (!m.has(currentEnvKey)) {
			m.set(currentEnvKey, rollout?.status?.history?.[0]?.version?.tag ?? null);
		}
		return m;
	});

	const blocks = $derived(
		contractBlocks({
			deps,
			envOf: (ns) => envByNamespace.get(ns) ?? null,
			envOrder: envOrder.length > 0 ? envOrder : [currentEnvKey],
			order,
			currentTagOf: (env) => currentTagByEnv.get(env) ?? null,
			// THIS environment's own gate is the authority for what its provider
			// is on. Folding to the first entry is what printed
			// `in hello-dep-prod` on the DEV rollout's page.
			preferEnv: currentEnvKey
		})
	);

	function providerHref(b: ContractBlock): string {
		// A consumer, its provider and the dependency are always in ONE
		// namespace on ONE cluster, so the dependency's own source-cluster
		// annotation is the provider's cluster.
		const own = b.entries.find((e) => e.env === currentEnvKey) ?? b.entries[0];
		const c = dependencySourceCluster(own?.dep) || cluster;
		return rolloutPath(c, b.providerNamespace, b.providerName);
	}

	/** Environments whose providers disagree — only rendered when they do. */
	function providerRows(b: ContractBlock) {
		return b.entries.filter((e) => e.providedVersion);
	}

	const hasChain = $derived(chainRows.length > 0);
	const hasContracts = $derived(blocks.length > 0);
	const twoColumns = $derived(hasChain && hasContracts);

	// ── THE PAGE'S ONE BLOCKING FACT ────────────────────────────────────
	//
	// A build is drawn ONLY when it is NEWER than what the environment holding
	// it is running (`splitBlocked`). On the live cluster the gate blocks
	// `rel-2`, the app's OLDEST build, while every environment runs `rel-66`:
	// that is the gate WORKING, no action follows from it, and a banner on it
	// would be the page crying wolf on every load.
	const adverse = $derived(blocks.filter((b) => b.blocked.length > 0));
	const heldTags = $derived(new Set(adverse.flatMap((b) => b.blocked.map((w) => w.tag))));
	const heldProviders = $derived([...new Set(adverse.map((b) => b.providerName))]);

	const banner = $derived.by(() => {
		if (heldTags.size === 0) return null;
		const n = heldTags.size;
		const one = heldProviders.length === 1;
		return {
			title: `${n} version${n === 1 ? '' : 's'} can't deploy yet`,
			message: one
				? `${heldProviders[0]} has to move first. Nothing newer goes out here until it does.`
				: `${heldProviders.length} other services have to move first. Nothing newer goes out here until they do.`,
			footnote: `Waiting on ${adverse.map((b) => b.contract).join(', ')}`,
			href: one ? providerHref(adverse[0]) : null,
			provider: one ? heldProviders[0] : null
		};
	});
</script>

<svelte:head>
	<title
		>kuberik | {rollout?.metadata
			? `${rollout.metadata.name} (${rollout.metadata.namespace}) - Dependencies`
			: 'Dependencies'}</title
	>
</svelte:head>

<div class="p-3 sm:p-4">
	{#if rolloutQuery.isLoading}
		<div class="grid max-w-[64rem] gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
			<div class="h-44 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
			<div class="h-44 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
		</div>
	{:else if rolloutQuery.error}
		<div
			class="rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm text-red-700 dark:border-gray-700 dark:bg-gray-800 dark:text-red-400"
			role="alert"
		>
			{rolloutQuery.error.message}
		</div>
	{:else}
		<div class="max-w-[64rem]">
			<!-- ══ PAGE HEADER — the 24px lead the composition grammar requires,
			     and the same structure the Overview tab uses (title, env chip,
			     one gray line under it). Before this the page's largest type was
			     a 10px `t-label` eyebrow. ══ -->
			<div class="mb-4">
				<div class="flex flex-wrap items-baseline gap-3">
					<h1 class="text-2xl font-bold text-gray-900 dark:text-white">{appTitle}</h1>
					{#if currentEnv}
						<Chip
							role="env"
							theme={currentTheme}
							label={currentEnv}
							title="This page is the {currentEnv} rollout"
							wide
							class="self-center"
						/>
					{/if}
				</div>
				<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
					What has to happen before a newer version of this app can go out.
				</p>
			</div>

			{#if !hasChain && !hasContracts}
				<div
					class="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
				>
					Nothing else has to happen first. This rollout waits on no other service, and it is
					not part of a promotion chain.
				</div>
			{:else}
				{#if banner}
					<!-- THE FILLED BANNER, for the page's ONE blocking fact. Amber,
					     because a contract block does not clear itself and does not
					     clear on approval either — somebody has to ship the other
					     service. `AlertPanel` is the product's only banner. -->
					<AlertPanel
						severity="warning"
						icon={ShareNodesSolid}
						title={banner.title}
						message={banner.message}
						footnote={banner.footnote}
					>
						{#snippet actions()}
							{#if banner.href && banner.provider}
								<NextStep
									step="open"
									href={banner.href}
									label="Open {banner.provider}"
									title="Open the {banner.provider} rollout"
								/>
							{/if}
						{/snippet}
					</AlertPanel>
				{/if}

				<!-- TWO COLUMNS FROM `xl`, NOT `lg`: at 1280 with the 176px sidebar
				     a 360px right column leaves the left one ~650px, which is where
				     a consequence sentence beside a held-version badge starts
				     wrapping. The contracts take the FLEXIBLE track because they
				     are the column that holds sentences; the chain holds two chips
				     per row and never wants more than the rail — wider, and
				     `StageChain`'s right-aligned build badge ends up 700px from the
				     environment chip it belongs to, which is the proximity
				     inversion the `/apps` convergence bar was rebuilt to fix.

				     ⚠️ 360px AND NOT 320px, WHICH IS A MEASUREMENT AND NOT A
				     PREFERENCE. `Card`'s header is `icon + title + ml-auto rollup`
				     and the rollup here is `UpToDate` (a 16px glyph plus
				     `All up to date` at 14px, ~117px). At 320 the title clipped to
				     `Where it's run…` — a clipped heading, which the novice pass
				     records as a hard defect. 360 leaves the 14px/600 title its
				     full width in both themes at 1440 and 1280.

				     `max-w-[64rem]` on the whole block: this page has a natural
				     maximum useful width and nothing on it benefits from 1264px.
				     A max-width is a TRACK, not a spacing value, so the
				     4/8/12/16/24 scale does not govern it; `/` already sets a
				     24rem grid track on the same reasoning. -->
				<div
					class="grid gap-4 {twoColumns
						? 'xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start'
						: ''}"
				>
					{#if hasContracts}
						<!-- ── AXIS 2 · CONTRACT GATES ─────────────────────────────
						     FIRST, and the reason is the growth curve: this card is
						     bounded by the number of contracts a service consumes,
						     while the chain grows with the number of environments
						     (thirteen on `edge-mesh`). The bounded, gate-carrying card
						     stays above the fold at 390 at every N. -->
						<Card
							icon={ShareNodesSolid}
							title="Waiting on other services"
							verdict={heldTags.size > 0
								? `${heldTags.size} version${heldTags.size === 1 ? '' : 's'} held`
								: 'Nothing held'}
							verdictTone={heldTags.size > 0 ? 'adverse' : 'neutral'}
							verdictTitle={heldTags.size > 0
								? 'Versions this app has built that a contract will not let it deploy'
								: 'No version this app has built is being held by a contract'}
							padded={false}
							class="min-w-0 {twoColumns ? '' : 'max-w-[44rem]'}"
						>
							<ul class="divide-y divide-gray-200 dark:divide-gray-700">
								{#each blocks as b (b.key)}
									<li class="px-4 py-4">
										<!-- SUBJECT LINE. The provider is what you are waiting
										     on, so it is the subject and it is the link; the
										     contract and the version it is on are ONE joined
										     badge in the `[word][identifier]` form every
										     identifier in this product lives in. That badge is
										     what replaced `NEEDS api` — a bare `NEEDS` names a
										     mechanism and carries no number, and the number is
										     the whole of "is it far enough along yet". -->
										<div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
											<ServerSolid
												class="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
												aria-hidden="true"
											/>
											<a
												href={providerHref(b)}
												class="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold text-gray-900 hover:underline dark:text-white"
												title="Open the {b.providerName} rollout"
											>
												<span class="min-w-0 truncate">{b.providerName}</span>
												<ArrowUpRightFromSquareOutline
													class="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-gray-500"
													aria-hidden="true"
												/>
											</a>
											{#if b.providedVersion && !b.providedVaries}
												<Chip
													role="count"
													label={b.contract}
													value={b.providedVersion}
													wide
													title="{b.providerName} has deployed {b.contract} {b.providedVersion}"
													valueTitle="Contract version {b.providerName} is serving"
													class="shrink-0"
												/>
											{/if}
											<!-- THE ROW'S OWN RIGHT-ALIGNED ROLLUP — the reference
											     page's `2/2 pods` / `10/10 ready` idiom, applied to
											     the one thing a contract can be asymmetric about.
											     WHERE the contract applies is the most interesting
											     thing this card can say (a gate on dev and staging
											     but not prod), and it was previously buried mid-way
											     along an 11px evidence line. It is `ml-auto`, not
											     `justify-between`, so a long provider name
											     truncates instead of shoving it off the row. -->
											{#if hasChain}
												<!-- ⛔ ONLY WHEN THIS APP HAS ENVIRONMENTS. A rollout
												     bound to no `Environment` has exactly one place and
												     no tier, so `in 1 environment` would be inventing an
												     identity it does not have — DESIGN.md's rule that a
												     rollout with no `Environment` must not be shown as
												     having one. -->
												<span
													class="ml-auto shrink-0 text-xs whitespace-nowrap text-gray-500 dark:text-gray-400"
													title={b.ungated > 0
														? `No ${b.contract} gate exists in ${b.ungatedEnvs.join(', ')}`
														: `Every environment of this app is gated on ${b.contract}`}
												>
													{#if b.ungated > 0}
														in {b.entries.length} of {b.entries.length + b.ungated}
														environments
													{:else}
														in {b.entries.length}
														{b.entries.length === 1 ? 'environment' : 'environments'}
													{/if}
												</span>
											{/if}
										</div>

										<!-- THE EVIDENCE LINE. Everything here is a HANDLE — a
										     tag, a namespace, a count — never a verdict, and every
										     clause prints only when it has something to say.
										     NOTHING DRAWS `Satisfied=True`. -->
										<p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
											{#if b.providedVaries}
												<!-- THE PROVIDERS DISAGREE, so there is no single
												     number and the page does not invent one. This is
												     the case the old first-non-null fold rendered as
												     one version for all of them. -->
												Each environment waits on its own copy of {b.providerName}.
											{:else if b.providedTag}
												Now on {b.contract}
												<span class="t-code-sm">{b.providedVersion}</span>, from
												<span class="t-code-sm">{b.providedTag}</span>
											{:else if !b.providedVersion}
												<!-- NEVER NAME A CAUSE YOU CANNOT EVIDENCE. An absent
												     `providedVersion` says the gate has not read one;
												     it does not say the provider is behind. -->
												No version of {b.contract} has been read from {b.providerName} yet
											{/if}
											{#if b.providerNamespace && b.providerNamespace !== namespace}
												· runs in <span class="t-code-sm">{b.providerNamespace}</span>
											{/if}
											{#if b.ungated > 0}
												<!-- WHICH ONES, IN WORDS — the count is already stated
												     by the row's rollup, so this names the exception
												     rather than restating the number. It is NOT a row
												     of chips: measured on the seven-environment
												     fixture, a contract gating ONE environment printed
												     SIX chips saying "not here", an object that grows
												     with the environments it is NOT about. -->
												· not needed in {b.ungatedEnvs.join(', ')}
											{/if}
											{#if b.pastTags.length > 0}
												<!-- COUNTED ONCE, NEVER SILENT. These are held builds
												     already BEHIND what every environment that would
												     take them runs — the gate working on candidates
												     nobody will deploy. Drawing them would make the page
												     cry wolf on every load; dropping them without a
												     number would hide a controller fact. -->
												· also holds {b.pastTags.length} older
												{b.pastTags.length === 1 ? 'version' : 'versions'} nobody is trying
												to deploy
											{/if}
										</p>

										{#if b.providedVaries}
											<!-- ONE ROW PER ENVIRONMENT, ONLY BECAUSE THEY DIFFER.
											     When they agree this whole block is a single badge on
											     the subject line — the norm, drawn once. -->
											<ul class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
												{#each providerRows(b) as e (e.env)}
													<li class="flex min-w-0 items-center gap-2">
														<Chip
															role="env"
															theme={themeFor(e.env)}
															label={shortEnvLabel(themeFor(e.env)) || e.env}
															title={e.env}
															wide
														/>
														<span class="t-code-sm text-gray-500 dark:text-gray-400"
															>{b.contract} {e.providedVersion}</span
														>
													</li>
												{/each}
											</ul>
										{/if}

										<!-- THE ADVERSE CASE, AND THE ONLY THING IN THIS CARD THAT
										     SPENDS AN ADVERSE COLOUR. Every other row is neutral or
										     an identity chip, so a quiet card means nothing is
										     held. -->
										{#each b.blocked as w (w.key)}
											<div
												class="mt-3 border-l-2 border-red-700/40 pl-3 dark:border-red-400/40"
											>
												<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
													<Chip
														role="blocked"
														label="held"
														value={w.display}
														valueTitle={w.tag}
														wide
														title="{w.envs.join(', ')} cannot deploy {w.tag} yet"
														class="shrink-0"
													/>
													{#if hasChain && w.envs.length > 0}
														<!-- WHERE IT IS HELD, only when there is a chain to
														     name into. An unbound rollout has one place and
														     no tier, so `in <namespace>` would print the
														     page's own subject back at it wearing an
														     environment chip's clothes. -->
														<span class="text-xs text-gray-500 dark:text-gray-400">in</span>
														{#each w.envs as env (env)}
															<Chip
																role="env"
																theme={themeFor(env)}
																label={shortEnvLabel(themeFor(env)) || env}
																title={env}
																wide
															/>
														{/each}
													{/if}
												</div>
												<!-- WHY, AS A CONSEQUENCE. `BlockReason` owns this
												     wording for the whole product: the sentence first,
												     then the generated gate name and the controller's
												     own open-string `reason` BELOW it, in muted mono,
												     prefixed `rule:` so neither can be mistaken for an
												     explanation again. The semver constraint is printed
												     VERBATIM inside the sentence — a bare version is an
												     EXACT match in Masterminds semver, so "at least
												     1.1.0" would be a lie with better grammar. -->
												<BlockReason
													class="mt-1.5"
													reason={contractBlockReason({
														provider: b.providerName,
														contract: b.contract,
														requiredVersion: w.requiredVersion,
														providedVersion: b.providedVersion,
														gateName: b.entries[0]?.dep?.status?.gateName ?? null,
														reason: w.reason
													})}
												/>
											</div>
										{/each}
									</li>
								{/each}
							</ul>
						</Card>
					{/if}

					{#if hasChain}
						<!-- ── AXIS 1 · THE PROMOTION CHAIN ────────────────────────
						     `StageChain` — the product's existing object for exactly
						     this question, shipped on `/apps/[name]`. Reusing it means
						     ZERO new visual vocabulary: it draws a status dot only for
						     a deviation, prints the rank and the build as ONE joined
						     chip, and its hop rail is SOLID when an edge is in sync so
						     "in sync" never has to be written on every edge.

						     The card's rollup is `UpToDate`, which is the same object
						     and the same words `/apps` uses for "is this thing
						     current" — WORDING reuse, so a reader learns it once. -->
						<!-- ⛔ THE CAP HOLDS IN BOTH SHAPES, AND THAT IS NOT COSMETIC.
						     In the two-column form the track is already 360px and the
						     class is a no-op; with no contract card the grid has no
						     template and this card stretched to the full 1024px, which
						     put every environment chip ~800px from the build badge it
						     belongs to — `StageChain` right-aligns that badge, so a
						     wide card is the same proximity inversion the `/apps`
						     convergence bar was rebuilt to fix. Measured on
						     `hello-world-app`, which has a chain and no contracts. -->
						<Card
							icon={ServerSolid}
							title="Where it's running"
							padded={true}
							class="min-w-0 {twoColumns ? '' : 'max-w-[360px]'}"
						>
							{#snippet rollup()}
								<UpToDate
									onHead={chainRollup.onHead}
									deployed={chainRollup.deployed}
									total={chainRollup.total}
									spread={chainRollup.spread}
									pending={chainRollup.pending}
									unknown={chainRollup.unknown}
									caption=""
									title="Environments of this app that are on its newest version"
								/>
							{/snippet}
							<StageChain
								nodes={chainNodes}
								hops={chainHops}
								emptyLabel="This rollout is not part of a promotion chain"
							/>
						</Card>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
