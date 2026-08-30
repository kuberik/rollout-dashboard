<svelte:options runes={true} />

<script lang="ts">
	/**
	 * DEPENDENCIES — what this rollout is waiting on, on both of its axes.
	 *
	 * THE TAB WAS CALLED `Environments` AND THE NAME WAS THE PROBLEM. It drew
	 * one axis (the promotion chain) and had no place at all for the other
	 * (`RolloutDependency`, the cross-service contract gate), which was
	 * invisible in the product. `Dependencies` is the honest umbrella: the
	 * CRD is literally named `RolloutDependency`, and an `Environment`'s
	 * `relationship: { type: 'After' }` is literally an environment
	 * dependency. Both are answers to "what is holding this back".
	 *
	 * THE TWO AXES ARE NEVER ONE LIST. See `view-models/dependencies.ts` for
	 * the full argument; the short version is that
	 *
	 *   · a CONTRACT GATE is a PERMISSION about ANOTHER SERVICE —
	 *     "am I allowed to go at all";
	 *   · an ENVIRONMENT DEPENDENCY is a DISTANCE on THIS service's own
	 *     line — "how far have I got".
	 *
	 * so they get two sections, two geometries, and no shared row. A single
	 * list holding `prod depends on staging` beside `frontend depends on api`
	 * would put two different relations in one badge.
	 *
	 * ── WHAT HAPPENED TO THE VERSIONS PANEL ─────────────────────────────
	 *
	 * SPLIT ALONG THE AXIS BOUNDARY, AND THE HALF THAT ONLY DREW THE NORM IS
	 * CUT. The old left column was `Version Status`, and under a Dependencies
	 * framing it had two masters. Measured on the live hub it also had a
	 * bigger problem: `Deployed` printed FOUR rows, every one of them a green
	 * `Succeeded` tick, and `Upcoming` printed "No newer versions available."
	 * Seven green marks on a page whose entire content was "everything is
	 * converged".
	 *
	 *   · `Deployed` — CUT. It was this rollout's OWN deploy history, drawn
	 *     on the tab about the things it DEPENDS ON. The History tab is that
	 *     list in full, with timestamps, messages and who triggered each one,
	 *     and the Overview card names the current build. Four green ticks
	 *     restating a neighbouring tab is the `DeployHistoryStrip` cut again.
	 *   · `Upcoming` — MOVED ONTO THE CHAIN, as the hop count. Its verdict
	 *     was never a versions question: it read `currentDeps` and the
	 *     UPSTREAM ENVIRONMENT'S bake status, i.e. it was an
	 *     environment-dependency fact wearing a version panel's clothes. As a
	 *     hop it is one number on the edge it belongs to (`2 waiting`)
	 *     instead of a list of cards, and it collapses to a solid rail when
	 *     there is nothing to say. It was also dead on live data — it
	 *     requires `status.releaseCandidates`, which the hub serves as null.
	 *   · The NEW version story — `admittedVersions` / `blockedReleases` —
	 *     goes into the contract block, because it is a CONTRACT verdict.
	 *
	 * Net: no panel has two masters, because every version fact now sits
	 * under the gate that produced it. Nothing on this page draws
	 * `Satisfied=True`, `admittedVersions`, or a healthy deploy.
	 */
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import Chip from '$lib/components/Chip.svelte';
	import StageChain from '$lib/components/StageChain.svelte';
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
		type EnvInfo
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
	 * Three of them, and each is load-bearing:
	 *   1. `rolloutDependencies` — the backend is adding this collection to
	 *      `GET /api/rollouts`, alongside `rollouts` and `environments`. That
	 *      is the RIGHT endpoint for it: a dependency lives in the CONSUMER
	 *      environment's namespace, so the gates on staging and prod are in
	 *      namespaces this page's own detail fetch never touches — and it is
	 *      exactly the cross-environment view that makes the asymmetry
	 *      sayable.
	 *   2. Each sibling environment's NAMESPACE and SOURCE CLUSTER, so a
	 *      chain node links to that rollout inside this dashboard rather than
	 *      hopping to another cluster's origin via `environmentUrl`.
	 *   3. Each sibling environment's OWN theme. Deriving it from THIS
	 *      rollout's annotations would paint every node with this
	 *      environment's colour — the "three environments, one
	 *      indistinguishable mark" defect DESIGN.md names by name.
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

	/**
	 * THIS ROLLOUT'S BUILD LADDER — one derivation, newest first, DERIVED
	 * FROM `created` rather than trusted from the array. See `buildOrder`:
	 * the live hub serves `availableReleases` OLDEST-first and the page this
	 * replaces assumed the opposite.
	 */
	const order = $derived(buildOrder(rollout?.status?.availableReleases));

	// ── THE APP'S OTHER ENVIRONMENTS ────────────────────────────────────
	const listRollouts = $derived((listQuery.data?.rollouts?.items ?? []) as Rollout[]);
	const listEnvironments = $derived((listQuery.data?.environments?.items ?? []) as Environment[]);

	type Sibling = {
		env: string;
		namespace: string;
		cluster: string;
		theme: EnvironmentTheme | null;
	};

	/**
	 * Every environment of this app, keyed by its tier name. Built with the
	 * SAME grouping `/apps` and `/apps/[name]` use, so this page cannot
	 * disagree with them about which rollouts are one app.
	 */
	const siblings = $derived.by<Map<string, Sibling>>(() => {
		const out = new Map<string, Sibling>();
		const group = groupRolloutsByApp(listRollouts, listEnvironments).get(name);
		for (const cell of group?.cells ?? []) {
			if (!cell.envName) continue;
			out.set(cell.envName, {
				env: cell.envName,
				namespace: cell.rollout.metadata?.namespace ?? '',
				cluster: cell.sourceCluster || cluster,
				theme: cell.theme
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
	 * STAGING would paint staging in this environment's colour. With no rollout
	 * the theme is a function of the environment's NAME and nothing else, which
	 * is the product-wide invariant.
	 */
	function themeFor(env: string): EnvironmentTheme | null {
		return siblings.get(env)?.theme ?? getRolloutEnvironmentTheme(null, env);
	}

	function hrefFor(env: string): string | undefined {
		// The environment this page IS gets no link. Every other node does.
		// "You are here" is already marked by the navbar breadcrumb, which
		// prints this rollout's env chip 60px above — a second mark would be
		// the duplicate this product keeps deleting.
		if (env === currentEnv) return undefined;
		const s = siblings.get(env);
		if (!s || !s.namespace) return undefined;
		return rolloutPath(s.cluster, s.namespace, name, 'dependencies');
	}

	const currentEnv = $derived(environment?.spec?.environment ?? '');

	/**
	 * THE KEY A CONTRACT GATE IS FILED UNDER, WHICH IS NOT ALWAYS AN
	 * ENVIRONMENT.
	 *
	 * A `RolloutDependency` lives in a namespace, and the page turns that
	 * namespace into an environment tier so gates line up with the chain.
	 * A rollout bound to NO `Environment` has no tier — and that is exactly
	 * the rollout for which a contract gate is the only thing holding it
	 * back. Keyed on the tier alone the gate was unplaceable and the page
	 * rendered "no environment relationships and no contract gates" over a
	 * dependency the API had served.
	 *
	 * So the key falls back to the NAMESPACE, which is what
	 * `groupRolloutsByApp` already does for an unbound rollout. It is a
	 * grouping key and never printed: the env chip stays gated on a real
	 * binding, because DESIGN.md's rule is that a rollout with no
	 * `Environment` must not be shown as having one.
	 */
	const currentEnvKey = $derived(currentEnv || namespace);

	// ── AXIS 1 · THE PROMOTION CHAIN ────────────────────────────────────
	const chainRows = $derived(chain(environmentInfos, order));
	const envOrder = $derived(chainRows.map((r) => r.env));

	/**
	 * The deploy-status mark, character for character `/apps/[name]`'s `DOT`.
	 * `StageChain` draws it ONLY for a deviation — a `Succeeded` node draws no
	 * dot and keeps its 5px track — so a converged chain carries no status
	 * colour at all.
	 */
	const DOT: Record<string, { cls: string; word: string }> = {
		Failed: { cls: 'bg-red-700 dark:bg-red-400', word: 'deploy failed' },
		Deploying: { cls: 'bg-blue-700 dark:bg-blue-400', word: 'deploying' },
		InProgress: { cls: 'bg-yellow-700 dark:bg-yellow-400', word: 'baking' },
		Succeeded: { cls: 'bg-green-700 dark:bg-green-400', word: 'deploy succeeded' },
		Cancelled: { cls: 'bg-gray-300 dark:bg-gray-600', word: 'bake cancelled' },
		None: { cls: 'bg-gray-300 dark:bg-gray-600', word: 'no bake status' }
	};

	/**
	 * MARK THE DEVIATION, NEVER THE NORM — the fan-out half of it.
	 *
	 * `StageChain`'s `quiet` prop exists for this and `/apps/[name]` already
	 * uses it: a production region that is on the build its FLEET agreed on
	 * keeps its full number and its full build, and gives up only the red.
	 * Measured on the seven-environment fixture without it, the chain printed
	 * SIX red `-N` chips down one column — and being behind on a promotion
	 * chain is the pipeline WORKING, not a fault. With it, the two regions
	 * that differ from the fleet are the ones that stand out, which is the
	 * whole point of the column.
	 *
	 * A fan-out is siblings sharing one `After` parent. A stage with a single
	 * child is the LINE, not a set, so it never goes quiet: `staging` being
	 * behind `dev` is a real hop and keeps its colour.
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
				const better = n > best || (n === best && modal !== null && rankOfTag(order, tag) < rankOfTag(order, modal));
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
				// `/apps/[name]`'s `divergedFromLine`. This page has one rollout's
				// line, so it cannot make that claim: an unplaceable build renders
				// `unknown` instead, which is what "never render an unresolvable
				// comparison as a definite claim" requires.
				diverged: false,
				dotClass: d.cls,
				statusWord: d.word,
				settled: r.bakeStatus === 'Succeeded',
				quiet: quietEnvs.has(r.env),
				href: hrefFor(r.env)
			};
		})
	);

	const chainHops = $derived(
		chainRows.map((r, i) => (i < chainRows.length - 1 ? hopBetween(r, chainRows[i + 1]) : null))
	);

	// ── AXIS 2 · THE CONTRACT GATES ─────────────────────────────────────

	/**
	 * Read the dependencies from WHEREVER the backend lands them.
	 *
	 * The change in flight puts `rolloutDependencies` on the LIST payload.
	 * Reading the detail payload too costs one line and means this page also
	 * works if it arrives on `GET /api/rollouts/:ns/:name`, and keeps working
	 * if it arrives on both. Neither field exists yet, so both are optional
	 * reads against a shape declared in the view-model.
	 */
	const deps = $derived.by<RolloutDependency[]>(() => {
		// `rolloutDependencies` is typed on `RolloutsListResponse`. It may be
		// null when a source cluster has no RolloutDependency CRD installed —
		// that is not an error, and it is indistinguishable from "none defined",
		// so it renders as the absence of the whole section.
		const fromList = listQuery.data?.rolloutDependencies?.items;
		// The detail endpoint does not serve them today. Reading it costs one
		// line and means this page keeps working if it ever does.
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
		// With no `Environment` there is no chain to read the running build
		// from, so it comes off the rollout's own newest history entry. Without
		// this `splitBlocked` gets a null current tag and treats EVERY blocked
		// build as wanted — which would be right by accident here and wrong the
		// moment a gate blocks something already deployed past.
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
			currentTagOf: (env) => currentTagByEnv.get(env) ?? null
		})
	);

	/**
	 * The constraint and the reason, in ONE string.
	 *
	 * Both VERBATIM. The constraint is the BUILD's own
	 * `com.kuberik.rollout.requires.<contract>` annotation: a bare version is an
	 * EXACT match in Masterminds semver, so paraphrasing `1.1.0` into "at least
	 * 1.1.0" would be a lie with better grammar — and it is exactly the pair
	 * that looks wrong on the live cluster, where a build requiring `1.1.0` is
	 * blocked by a provider on `1.66.0`.
	 *
	 * `reason` IS AN OPEN STRING AND IS NOT MAPPED. The same build reports
	 * `ConstraintNotSatisfied` on one cluster and `ProviderVersionTooOld` on
	 * another, so a switch with a friendly label per case would ship its
	 * fallback. It is printed as the controller wrote it.
	 */
	function constraintLine(
		contract: string,
		w: { requiredVersion: string | null; reason: string | null }
	): string {
		const parts: string[] = [];
		if (w.requiredVersion) parts.push(`requires ${contract} ${w.requiredVersion}`);
		if (w.reason) parts.push(w.reason);
		return parts.join(' · ');
	}

	function providerHref(b: ContractBlock): string {
		// A consumer, its provider and the dependency are always in ONE
		// namespace on ONE cluster, so the dependency's own source-cluster
		// annotation is the provider's cluster. Falls back to the route's
		// cluster on a single-cluster payload, where nothing is annotated.
		const c = dependencySourceCluster(b.entries[0]?.dep) || cluster;
		return rolloutPath(c, b.providerNamespace, b.providerName);
	}

	const hasChain = $derived(chainRows.length > 0);
	const hasContracts = $derived(blocks.length > 0);

	const PANEL =
		'rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800';
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
		<div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
			<div class="h-40 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
			<div class="h-40 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
		</div>
	{:else if rolloutQuery.error}
		<div
			class="{PANEL} t-dense px-4 py-4 text-red-700 dark:text-red-400"
			role="alert"
		>
			{rolloutQuery.error.message}
		</div>
	{:else if !hasChain && !hasContracts}
		<div class="{PANEL} t-dense px-4 py-10 text-center text-gray-500 dark:text-gray-400">
			This rollout has no environment relationships and no contract gates.
		</div>
	{:else}
		<!-- TWO COLUMNS FROM `xl`, NOT `lg`, and the same call `/envs/[name]`
		     already made on the page next door: at 1280 with the 176px sidebar
		     a 320px right column leaves the left one ~700px, which is where a
		     constraint string beside a blocked build badge starts wrapping.
		     The contracts take the FLEXIBLE track because they are the column
		     that holds a sentence, and DESIGN.md's own rule is that overflow
		     always lands there. The chain takes the product's fixed 320px rail
		     width; it holds two chips and never wants more. -->
		<!-- `max-w-[64rem]`, a Tailwind scale value, because this page has a
		     natural maximum useful width and nothing on it benefits from 1400px.
		     Measured at 1440 without it: the contract column ran 890px wide to
		     hold two lines, and the `[NEEDS][api]` badge sat ~700px from the
		     provider name it belongs to — the exact proximity inversion the
		     `/apps` convergence bar was rebuilt to fix. A max-width is a TRACK,
		     not a spacing value, so the 4/8/12/16/24 scale does not govern it;
		     `/` already sets a 24rem grid track on the same reasoning. -->
		<div
			class="grid max-w-[64rem] gap-6 {hasContracts && hasChain
				? 'xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start'
				: ''}"
		>
			{#if hasContracts}
				<!-- ── AXIS 2 · CONTRACT GATES ─────────────────────────────
				     FIRST, and the reason is the growth curve. This section is
				     bounded by the number of contracts a service consumes (one,
				     here); the chain grows with the number of environments, which
				     `edge-mesh` takes to thirteen. Putting the bounded,
				     gate-carrying section first keeps it above the fold at 390 at
				     every N. It is also the Direction B split the app page uses:
				     the thing that can BLOCK on the left, read-only state on the
				     right. -->
				<!-- `max-w-[44rem]` for the same reason the chain takes 320px: with no
				     promotion chain to sit beside — a rollout gated by a contract and
				     bound to no `Environment` — the grid has no template and this
				     section would stretch to the full 1024px to hold one two-line
				     card. In the two-column form the track measures ~680px, so this
				     is a near-no-op there. -->
				<section class="min-w-0 max-w-[44rem]">
					<h2 class="t-label mb-3 text-gray-500 dark:text-gray-400">Contract gates</h2>
					<div class="{PANEL} overflow-hidden">
						<ul class="divide-y divide-gray-200 dark:divide-gray-700">
							{#each blocks as b (b.key)}
								<li class="px-4 py-3">
									<!-- SUBJECT LINE. The provider is what you are waiting on,
									     so it is the subject and it is a link; the contract is
									     the badge, in the `[word][identifier]` form every
									     identifier in this product lives in — the `/versions`
									     `[AS][1.66.0-66]` precedent. Two sections, never three.

									     THEY SIT TOGETHER, 8px APART, AND ARE NOT SPREAD TO THE
									     TRACK'S EDGES. `justify-between` put the badge ~700px
									     from the name it qualifies at 1440 — one unit reading as
									     two, which is the proximity measurement DESIGN.md
									     records against the `/apps` convergence bar. -->
									<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
										<a
											href={providerHref(b)}
											class="t-code min-w-0 truncate text-gray-900 hover:underline dark:text-white"
											title="Open the {b.providerName} rollout"
										>
											{b.providerName}
										</a>
										<Chip
											role="count"
											label="needs"
											value={b.contract}
											wide
											title="This rollout is gated on the {b.contract} contract"
											class="shrink-0"
										/>
									</div>

									<!-- STATE LINE. The provider's deployed contract version is
									     the whole of "is it far enough along", and it is stated
									     ONCE per contract rather than once per environment,
									     because it is a fact about the PROVIDER.

									     NOTHING HERE DRAWS `Satisfied=True`. It is the norm, it
									     is true on every gate on the live cluster, and three
									     components were cut from this product for painting the
									     norm. A satisfied contract renders these two lines and
									     stops. -->
									<p
										class="t-micro mt-1 text-gray-500 dark:text-gray-400"
										title={b.ungated > 0
											? `No ${b.contract} gate exists in ${b.ungatedEnvs.join(', ')}`
											: undefined}
									>
										{#if b.providedVersion}
											deployed <span class="t-code-sm">{b.providedVersion}</span>
											{#if b.providedTag}
												· <span class="t-code-sm">{b.providedTag}</span>
											{/if}
										{:else}
											<!-- NEVER NAME A CAUSE YOU CANNOT EVIDENCE. An absent
											     `providedVersion` says the gate has not read one;
											     it does not say the provider is behind. -->
											no contract version read yet
										{/if}
										{#if b.providerNamespace && b.providerNamespace !== namespace}
											· in <span class="t-code-sm">{b.providerNamespace}</span>
										{/if}
										{#if b.ungated > 0}
											<!-- PARTIAL COVERAGE, AS A COUNT.

											     A contract does not have to gate every environment,
											     and when it does not, that is worth one clause. It is
											     a NUMBER and not a row of environment chips: measured
											     on the seven-environment fixture, a contract gating
											     ONE environment printed SIX chips saying "not here",
											     which is an object that grows with the environments
											     it is NOT about — the norm, drawn N times. A count is
											     the same length at N=3 and at N=13, and the names are
											     in its `title`.

											     It prints nothing when the contract gates every
											     environment, which is the live cluster's own shape. -->
											· gates {b.entries.length} of {b.entries.length + b.ungated}
											{b.entries.length + b.ungated === 1 ? 'environment' : 'environments'}
										{/if}
										{#if b.pastTags.length > 0}
											<!-- COUNTED ONCE, NEVER SILENT. These are blocked builds
											     already BEHIND what every environment that would take
											     them runs — the gate working on candidates nobody will
											     deploy. Drawing them would make the page cry wolf on
											     every load; dropping them without a number would hide
											     a controller fact.

											     ONE CLAUSE PER CONTRACT, de-duplicated by BUILD. Per
											     environment it read `1 older build blocked in dev · 1
											     older build blocked in staging · 1 older build blocked
											     in prod` for what is one build held by one contract. -->
											· {b.pastTags.length} older
											{b.pastTags.length === 1 ? 'build' : 'builds'} blocked
										{/if}
									</p>

									<!-- THE ADVERSE CASE, AND THE ONLY THING ON THIS PAGE THAT
									     SPENDS AN ADVERSE COLOUR.

									     A blocked build is drawn ONLY when it is NEWER than what
									     that environment is running — see `splitBlocked`. On the
									     live cluster the gate blocks `rel-2`, the app's OLDEST
									     build, while every environment runs `rel-66`: that is the
									     gate WORKING, no action follows from it, and an alarm on
									     it would be the page marking the norm in red.

									     Every other row on this page is neutral or an identity
									     chip, so these rows are the page's only red — attention
									     goes here by design, and a quiet page means nothing is
									     held. -->
									{#each b.blocked as w (w.key)}
										<div
											class="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
										>
											<Chip
												role="blocked"
												label="blocked"
												value={w.display}
												valueTitle={w.tag}
												wide
												title="{w.envs.join(', ')} cannot deploy {w.tag}: the {b.contract} contract is not satisfied"
												class="shrink-0"
											/>
											<!-- THE CONSTRAINT AND THE REASON, BOTH VERBATIM.

											     The constraint is the BUILD's own
											     `com.kuberik.rollout.requires.<contract>` annotation
											     and is printed unchanged: a bare version is an EXACT
											     match in Masterminds semver, so paraphrasing `1.1.0`
											     into "at least 1.1.0" would be a lie with better
											     grammar — and it is exactly the pair that looks wrong
											     on the live cluster, where a build requiring `1.1.0`
											     is blocked by a provider on `1.66.0`.

											     `reason` IS AN OPEN STRING AND IS NOT MAPPED. The
											     same build reports `ConstraintNotSatisfied` on one
											     cluster and `ProviderVersionTooOld` on another, so a
											     switch with a friendly label per case would ship its
											     fallback. It is printed as the controller wrote it,
											     and two environments that disagree about why get two
											     rows rather than one guess.

											     Neutral ink on all of it — the chips are what carry
											     the colour. -->
											{#if w.requiredVersion || w.reason}
												<!-- ONE INTERPOLATED STRING, NOT NESTED `{#if}`s.
												     Svelte collapses the whitespace at an `{#if}`
												     boundary, so the nested form rendered
												     `^3.0.0·ConstraintNotSatisfied` with the separator
												     welded to both sides. Built in the script, the
												     spacing is the string's own. -->
												<span
													class="t-micro min-w-0 text-gray-500 dark:text-gray-400"
													title={w.reason ?? undefined}
												>
													<span class="t-code-sm">{constraintLine(b.contract, w)}</span>
												</span>
											{/if}
										</div>
										<!-- WHERE IT IS HELD. The environments wrap as chips after
										     the build they are held on, rather than each getting
										     its own copy of the build and its constraint — the
										     `/versions` bucket-card grouping. Measured on the
										     seven-environment fixture, two builds held in four
										     environments went from EIGHT rows with the constraint
										     printed four times to TWO rows.

										     ONLY WHEN THERE IS A CHAIN TO NAME INTO. A rollout
										     bound to no `Environment` has exactly one place and no
										     tier, so `held in <this one>` would print the page's own
										     subject back at it — and the chip would have to invent
										     an environment identity the rollout does not have. -->
										{#if hasChain}
											<p class="mt-1 flex min-w-0 flex-wrap items-center gap-2 pl-1">
												<span class="t-micro text-gray-500 dark:text-gray-400">held in</span>
												{#each w.envs as env (env)}
													<Chip
														role="env"
														theme={themeFor(env)}
														label={shortEnvLabel(themeFor(env)) || env}
														title={env}
														wide
													/>
												{/each}
											</p>
										{/if}
									{/each}
								</li>
							{/each}
						</ul>
					</div>
				</section>
			{/if}

			{#if hasChain}
				<!-- ── AXIS 1 · THE PROMOTION CHAIN ────────────────────────
				     `StageChain` — the product's existing object for exactly this
				     question, shipped on `/apps/[name]`. Reusing it means ZERO new
				     visual vocabulary and it already obeys every rule this page is
				     held to: it draws a status dot only for a deviation, it prints
				     the rank and the build as ONE joined chip, and its hop rail is
				     SOLID when an edge is in sync so "in sync" never has to be
				     written on every edge.

				     This replaces a dagre-laid-out SvelteFlow canvas that rendered
				     three ~160px nodes inside ~870x760px of dotted background, drew
				     the same three green ticks the version list beside it drew, and
				     used a hardcoded `#6b7280` edge stroke that is a duplicate
				     spelling of the product's own gray. -->
				<!-- `max-w-[320px]` ON THE SECTION, NOT ON THE GRID TRACK, so it holds
				     in BOTH shapes. In the two-column form the track is already
				     320px and this is a no-op; with no contract gates the grid has
				     no template and the panel stretched to the full 1024px, which
				     put every env chip ~800px from the build badge it belongs to —
				     `StageChain` right-aligns that badge, so a wide panel is the
				     same proximity inversion the contract card's subject line had.
				     The chain holds two chips and never wants more width. -->
				<section class="min-w-0 max-w-[320px]">
					<h2 class="t-label mb-3 text-gray-500 dark:text-gray-400">Promotion chain</h2>
					<div class="{PANEL} px-4 py-3">
						<StageChain
							nodes={chainNodes}
							hops={chainHops}
							emptyLabel="No environment relationships"
						/>
					</div>
				</section>
			{/if}
		</div>
	{/if}
</div>
