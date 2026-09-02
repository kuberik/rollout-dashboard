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
	 * ── ⭐ 2026-08-30 · THE EDGE HAS TWO ENDS AND THE PAGE ONLY HAD ONE ──
	 *
	 * From the human: *"We had a half previously when dependencies tab was
	 * environments. So that we can see both ways. What it's blocking and what
	 * it's blocked by."* Correct, and measurable: every selector in the product
	 * matched `spec.rolloutRef` — the CONSUMER end — and NOTHING anywhere
	 * matched `spec.providerRef`. So the tab could answer *"what am I waiting
	 * on"* and could never answer *"who is waiting on me"*, and the rollout
	 * where the second question is the whole point got an empty page:
	 * `hello-api-app`, the provider `hello-frontend-app` is gated on in all
	 * three environments, showed NOTHING, because it consumes nothing.
	 *
	 * ⛔ THE THIRD CARD IS NOT THE SECOND ONE MIRRORED, AND THE REASON IS
	 * STRUCTURAL. `Waiting on other services` has N providers, each with its
	 * own version, so its subject is THE OTHER SERVICE and the number beside it
	 * is THEIRS. `Services waiting on this` has exactly ONE version and it is
	 * OURS, which every gate pointing at this rollout reads the same — so the
	 * subject is THAT NUMBER, stated once at the top, with the services
	 * standing on it hanging beneath. Mirroring the layout would have printed
	 * our own version once per consumer.
	 *
	 * The WEIGHTS differ too, which is the other half of the human's question.
	 * Being blocked is a TASK — somebody must ship, and the card is a list of
	 * those somebodies. Being a provider is a CONSEQUENCE: nothing asks the
	 * reader to act until a consumer is genuinely held, and what the card
	 * carries the rest of the time is THE FLOOR UNDER THIS ROLLOUT, read off
	 * `requires` on a release the consumer HAS DEPLOYED
	 * (`hello-frontend-app` runs `2.66.0-66`, which needs `api ^1.66.0`). That
	 * is an observation about a running system, not a warning the UI invented,
	 * and it is exactly what a person about to roll back needs.
	 *
	 * ⛔ AND THE NORM IS STILL NOT DRAWN. Most rollouts block nobody and are
	 * blocked by nobody. NEITHER contract card renders unless a
	 * `RolloutDependency` names this rollout on that end, so an ordinary
	 * rollout sees exactly what it saw before — the chain, alone — and a
	 * rollout with nothing on any axis does not get the tab at all. See the
	 * empty-state comment in the markup.
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
		CodeForkSolid,
		ArrowUpRightFromSquareOutline
	} from 'flowbite-svelte-icons';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import FactList, { type Fact } from '$lib/components/FactList.svelte';
	import BlockReason, { contractBlockReason } from '$lib/components/BlockReason.svelte';
	import { BAKE_WORD } from '$lib/bake-status';
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
	import { pollWhenHealthy } from '$lib/api/errors';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';
	import {
		dependencySourceCluster,
		releaseMetadataUnresolved,
		releaseRequires
	} from '../../../../../../types/rollout-dependency-types';
	import {
		buildOrder,
		chain,
		contractBlocks,
		currentEntry,
		displayOfTag,
		hopBetween,
		providedContracts,
		rankOfTag,
		type ChainEnv,
		type ConsumerState,
		type ContractBlock,
		type Dependent,
		type EnvHistoryEntry,
		type EnvInfo,
		type ProvidedContract,
		type Release
	} from '$lib/view-models/dependencies';
	import { rankVerdicts } from '$lib/view-models/env-rank';
	import DependencyNetwork from '$lib/components/DependencyNetwork.svelte';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { buildGateContext } from '$lib/view-models/blocking-story';
	import {
		buildRolloutGraph,
		neighbourhood,
		networkVerdict,
		nodeId
	} from '$lib/view-models/dependency-graph';

	const cluster = $derived(page.params.cluster as string);
	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);

	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace,
			name,
			cluster,
			options: { refetchInterval: pollWhenHealthy(5000) }
		})
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
		rolloutsListQueryOptions({ options: { refetchInterval: pollWhenHealthy(15000) } })
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
				(
					s?.environment?.spec as
						| { relationship?: { environment: string; type: string } }
						| undefined
				)?.relationship ?? info?.relationship;
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

	/**
	 * ⛔ THE `N behind` CHIPS ON THIS TAB ARE THE PRODUCT'S ONE NUMBER.
	 * (2026-08-31) They used to be `rankOfTag(order, …)` — the position on
	 * the UNION ladder above — and on the live hub that printed `20 BEHIND`
	 * on three rows whose own controllers published 16, 15 and 15 candidates.
	 * The ladder keeps its real job here (ordering builds for the hop and the
	 * blocked-tag sorts); the COUNT comes from `env-rank.ts`, the same object
	 * `/`, `/rollouts`, `/apps` and rollout detail read.
	 *
	 * `null` for an environment with no rollout in this group — `chain` then
	 * falls back to the ladder rather than fabricating a zero.
	 */
	const ownRanks = $derived.by<Map<string, number>>(() => {
		const out = new Map<string, number>();
		if (!group) return out;
		const verdicts = rankVerdicts(group);
		for (const cell of group.cells) {
			const v = verdicts.get(cell);
			if (!v || !cell.envName) continue;
			if (v.kind === 'newest') out.set(cell.envName, 0);
			else if (v.kind === 'behind') out.set(cell.envName, v.by);
			// `diverged` / `unknown` are not distances — leave them out so the
			// row renders the page's own `unknown` branch (`rank < 0`).
			else out.set(cell.envName, -1);
		}
		return out;
	});
	const chainRows = $derived(chain(chainInfos, order, (env) => ownRanks.get(env) ?? null));
	const envOrder = $derived(chainRows.map((r) => r.env));

	/**
	 * The deploy-status mark, character for character `/apps/[name]`'s `DOT`.
	 * `StageChain` draws it ONLY for a deviation — a `Succeeded` node draws no
	 * dot — so a converged chain carries no status colour at all.
	 */
	const DOT: Record<string, { cls: string; word: string }> = {
		Failed: { cls: 'bg-red-700 dark:bg-red-400', word: BAKE_WORD.Failed },
		Deploying: { cls: 'bg-blue-700 dark:bg-blue-400', word: BAKE_WORD.Deploying },
		InProgress: { cls: 'bg-yellow-700 dark:bg-yellow-400', word: BAKE_WORD.InProgress },
		Succeeded: { cls: 'bg-green-700 dark:bg-green-400', word: BAKE_WORD.Succeeded },
		Cancelled: { cls: 'bg-gray-300 dark:bg-gray-600', word: BAKE_WORD.Cancelled },
		// `no deploy recorded` was this page's own fourth spelling of `None`.
		None: { cls: 'bg-gray-300 dark:bg-gray-600', word: BAKE_WORD.None }
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
					n > best ||
					(n === best && modal !== null && rankOfTag(order, tag) < rankOfTag(order, modal));
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
	const allDeps = $derived.by<RolloutDependency[]>(() => {
		const fromList = listQuery.data?.rolloutDependencies?.items;
		const fromDetail = (
			rolloutQuery.data as { rolloutDependencies?: { items?: RolloutDependency[] } }
		)?.rolloutDependencies?.items;
		const all = [...(fromList ?? []), ...(fromDetail ?? [])];
		const seen = new Set<string>();
		const out: RolloutDependency[] = [];
		for (const d of all) {
			const k = `${d?.metadata?.namespace ?? ''}/${d?.metadata?.name ?? ''}`;
			if (!d?.spec || seen.has(k)) continue;
			seen.add(k);
			out.push(d);
		}
		return out;
	});

	/**
	 * ⭐ THE TWO ENDS OF THE EDGE, SELECTED SEPARATELY.
	 *
	 * A `RolloutDependency` names a CONSUMER (`spec.rolloutRef`, always in the
	 * dependency's own namespace) and a PROVIDER (`spec.providerRef`, which may
	 * be anywhere). Until now only the first was ever selected, so the page
	 * could answer "what am I waiting on" and could never answer "who is
	 * waiting on me" — and the rollout for which the second question is the
	 * whole point (a provider that consumes nothing) got an empty page.
	 */
	const deps = $derived(allDeps.filter((d) => d.spec?.rolloutRef?.name === name));

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

	/**
	 * ⭐ DOES A HELD ROW BELOW ALREADY DRAW `provider [contract|served] →
	 * [required]`? (2026-09-02.) `BlockReason`'s `contract` branch draws that
	 * relation whenever it has all three operands, and the card was printing
	 * the same two facts twice more above it: once as the subject line's
	 * `[API|1.66.0]` badge and once as the sentence `Now on api 1.66.0`. One
	 * card, `hello-api-app` three times, `api 1.66.0` three times.
	 *
	 * ⛔ THE PREDICATE IS THE DRAWING'S OWN, NOT AN APPROXIMATION OF IT. It
	 * mirrors `drawsVersions` in `BlockReason.svelte` exactly — contract,
	 * served version, required range — because the two must never disagree:
	 * a block whose relation cannot be drawn (no `requiredVersion`, or the
	 * providers disagree so there is no single served number) still needs the
	 * badge and the sentence, and losing them would leave the served version
	 * nowhere on the card.
	 */
	function drawsRelation(b: ContractBlock): boolean {
		return !!(
			b.contract &&
			b.providedVersion &&
			!b.providedVaries &&
			b.blocked.some((w) => w.requiredVersion)
		);
	}

	// ── AXIS 3 · WHAT THIS ROLLOUT IS HOLDING ───────────────────────────
	//
	// ⛔ SCOPED TO THIS ROLLOUT INSTANCE, WHICH IS THE OPPOSITE OF AXIS 2 AND
	// IS DELIBERATE. The contract card folds this app's environments together
	// because it is describing what the APP consumes. This card's subject is
	// ONE NUMBER — the contract version THIS rollout has deployed — and the
	// `hello-api-app` in `hello-dep-staging` is a different rollout serving a
	// different number, with its own page. Folding its consumers in here would
	// print one version for two, which is the `in hello-dep-prod` defect one
	// axis over.

	/** Every rollout the list can see, for resolving a consumer. */
	const rolloutByKey = $derived.by<Map<string, Rollout>>(() => {
		const m = new Map<string, Rollout>();
		for (const r of listRollouts) {
			const ns = r.metadata?.namespace ?? '';
			const n = r.metadata?.name ?? '';
			if (ns && n) m.set(`${ns}/${n}`, r);
		}
		return m;
	});

	/** The `Environment` bound to one rollout, so a consumer can wear its tier. */
	const environmentByKey = $derived.by<Map<string, Environment>>(() => {
		const m = new Map<string, Environment>();
		for (const e of listEnvironments) {
			const ns = e.metadata?.namespace ?? '';
			const rn = e.spec?.rolloutRef?.name ?? '';
			if (ns && rn) m.set(`${ns}/${rn}`, e);
		}
		return m;
	});

	/**
	 * WHAT ONE CONSUMER IS RUNNING, AND WHAT THAT RELEASE ASKS OF US.
	 *
	 * `requires` is read off the release the consumer HAS DEPLOYED, which is
	 * what makes the floor under this rollout an observation rather than a
	 * warning the UI invented: on the live hub `hello-frontend-app` runs
	 * `2.66.0-66`, whose `com.kuberik.rollout.requires.api` is `^1.66.0`, and
	 * this rollout serves `1.66.0`.
	 *
	 * ⛔ NULL, NOT AN EMPTY STATE, WHEN THE ROLLOUT CANNOT BE SEEN. Returning
	 * a zero-value here would let the card say "never deployed" about a
	 * service this dashboard simply cannot reach — the exact class of claim
	 * the chain was rebuilt to stop making.
	 */
	function consumerStateFor(ns: string, cname: string, contract: string): ConsumerState | null {
		const r = rolloutByKey.get(`${ns}/${cname}`);
		if (!r) return null;
		const releases: Release[] = [];
		for (const rel of r.status?.availableReleases ?? []) releases.push(rel as Release);
		for (const h of r.status?.history ?? []) if (h.version) releases.push(h.version as Release);
		const ord = buildOrder(releases);
		const history = (r.status?.history ?? []) as unknown as EnvHistoryEntry[];
		const cur = currentEntry({ environment: ns, history });
		const tag = cur?.version?.tag ?? null;
		const requires = releaseRequires(cur?.version)?.[contract] ?? null;
		return {
			order: ord,
			currentTag: tag,
			currentDisplay: tag ? displayOfTag(ord, tag) : null,
			requires,
			// A missing constraint and an UNREADABLE manifest are different
			// facts, and only the second may be reported as one.
			requiresUnresolved: !requires && releaseMetadataUnresolved(cur?.version),
			neverDeployed: history.length === 0
		};
	}

	const provided: ProvidedContract[] = $derived(
		providedContracts({
			deps: allDeps,
			provider: name,
			providerNamespace: namespace,
			consumerState: consumerStateFor,
			clusterOf: (d) => dependencySourceCluster(d) ?? null
		})
	);

	/**
	 * The generated `RolloutGate` this relation publishes. It is a HANDLE, not
	 * an explanation — `BlockReason` dresses it as one — and it is the SAME
	 * object the consumer's own page names, so the two ends of the edge quote
	 * one identifier rather than two.
	 */
	function gateNameOf(d: Dependent): string | null {
		return d.places[0]?.dep?.status?.gateName ?? null;
	}

	function consumerHref(d: Dependent): string | undefined {
		const p = d.places[0];
		if (!p) return undefined;
		return rolloutPath(p.cluster || cluster, p.namespace, d.name, 'dependencies');
	}

	/**
	 * The tier chip for one consumer instance, or null when it has no
	 * `Environment` binding — in which case the page prints the NAMESPACE and
	 * invents no tier, DESIGN.md's rule that a rollout with no `Environment`
	 * must not be shown as having one.
	 */
	function placeTheme(ns: string, rn: string): EnvironmentTheme | null {
		const env = environmentByKey.get(`${ns}/${rn}`);
		if (!env?.spec?.environment) return null;
		return getRolloutEnvironmentTheme(rolloutByKey.get(`${ns}/${rn}`) ?? null, env);
	}

	const hasChain = $derived(chainRows.length > 0);
	const hasContracts = $derived(blocks.length > 0);
	const hasDependents = $derived(provided.length > 0);
	const twoColumns = $derived(hasChain && (hasContracts || hasDependents));

	/** Consumer services this rollout is currently holding, across contracts. */
	const heldConsumers = $derived(
		provided.flatMap((c) => c.dependents.filter((d) => d.adverse).map((d) => ({ c, d })))
	);
	/**
	 * BOTH COUNTS ARE OVER DISTINCT SERVICES, NOT OVER ROWS. A consumer gated
	 * on two contracts of this rollout is ONE service on both sides of the
	 * fraction; counting rows would let the header print `2 of 1 held`.
	 */
	const dependentCount = $derived(
		new Set(provided.flatMap((c) => c.dependents.map((d) => d.name))).size
	);
	const heldCount = $derived(new Set(heldConsumers.map(({ d }) => d.name)).size);

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

	const blockedBanner = $derived.by(() => {
		if (heldTags.size === 0) return null;
		const n = heldTags.size;
		const one = heldProviders.length === 1;
		return {
			title: `${n} version${n === 1 ? '' : 's'} can't deploy yet`,
			message: one
				? `${heldProviders[0]} has to move first. Nothing newer goes out here until it does.`
				: `${heldProviders.length} other services have to move first. Nothing newer goes out here until they do.`,
			/**
			 * ⭐ A SET, SO IT IS A RECORD AND THE TRIGGER COUNTS. (2026-09-02)
			 * It was `Waiting on api, web` — a comma list with a verb in front
			 * of it, behind a control labelled `Details`, while the SAME page's
			 * gate rows one card below said `1 rule`. A contract is an
			 * identifier you go and look up, so it is a handle and is dressed as
			 * one; the PROVIDER only earns a row when the printed message did
			 * not already name it (`one` is exactly that test).
			 */
			facts: [
				...(one ? [] : heldProviders.map((n) => ({ label: 'Provider', value: n, handle: true }))),
				...[...new Set(adverse.map((b) => b.contract))].map((c) => ({
					label: 'Contract',
					value: c,
					handle: true
				}))
			] as Fact[],
			count: new Set(adverse.map((b) => b.contract)).size,
			noun: 'contract',
			href: one ? providerHref(adverse[0]) : null,
			label: one ? `Open ${heldProviders[0]}` : null
		};
	});

	/**
	 * ⭐ THE SECOND BANNER, AND THE RULE THAT KEEPS THERE BEING ONE.
	 *
	 * When another service cannot deploy because THIS rollout has not shipped a
	 * new enough contract, the stoppage is real, it does not clear itself, and
	 * the person who can end it is reading this page. That is the same weight
	 * the blocked-by banner carries and it gets the same object.
	 *
	 * ⛔ THEY NEVER STACK, and the blocked-by one wins. You cannot ship the
	 * thing they are waiting for until you can move yourself, so the banner
	 * that names YOUR stoppage is the one step that is available; the consumers
	 * are still stated, in their own card, four rows down. Two amber fields on
	 * one page would leave the page with no loudest object at all.
	 */
	const holdingBanner = $derived.by(() => {
		if (heldConsumers.length === 0) return null;
		const names = [...new Set(heldConsumers.map(({ d }) => d.name))];
		const one = names.length === 1;
		const contracts = [...new Set(heldConsumers.map(({ c }) => c.contract))];
		// Keyed by SERVICE and tag: two different services can build the same
		// tag string, and counting those as one version would understate it.
		const versions = new Set(
			heldConsumers.flatMap(({ d }) => d.holds.map((h) => `${d.name}/${h.tag}`))
		).size;
		const plural = versions === 1 ? '' : 's';
		return {
			title: one
				? `${names[0]} can't deploy until this one ships`
				: `${names.length} services can't deploy until this one ships`,
			message: one
				? `${versions} version${plural} of ${names[0]} need${plural ? '' : 's'} a newer ${contracts.join(', ')} than this rollout is serving.`
				: `Between them, ${versions} version${plural} need a newer ${contracts.join(', ')} than this rollout is serving.`,
			/**
			 * THE SET IS THE SERVICES, and the same argument applies: `Waiting on
			 * this: alpha, beta` is a list wearing a colon. Each name is a
			 * rollout you can go and open, so it is a handle.
			 */
			facts: names.map((n) => ({ label: 'Service', value: n, handle: true })) as Fact[],
			count: names.length,
			noun: 'service',
			href: one ? consumerHref(heldConsumers[0].d) : null,
			label: one ? `Open ${names[0]}` : null
		};
	});

	const banner = $derived(blockedBanner ?? holdingBanner);

	/**
	 * THE LEDE IS DERIVED, because the page genuinely answers a different
	 * question in each of its shapes and a fixed sentence would promise a half
	 * that is not there.
	 */
	const lede = $derived(
		hasDependents
			? hasContracts
				? 'What has to ship before this app can move, and what cannot move until it does.'
				: 'Other services can only run what this app has deployed.'
			: 'What has to happen before a newer version of this app can go out.'
	);
	/**
	 * ⭐ THE SAME GRAPH LANGUAGE, AT ONE NODE'S SCALE.
	 *
	 * From the human: *"dependencies we used a full graph to show whole network
	 * of dependencies."* `/dependencies` is that graph; this is the SAME
	 * component focused on this rollout's immediate neighbourhood, so the two
	 * pages are one idea at two scales rather than two designs — the way
	 * `/versions` and its detail page were built.
	 *
	 * It reads `allDeps` and every `Environment` — BOTH ends of both edge
	 * kinds, the whole payload — not the consumer-filtered `deps` below,
	 * because a map of one node's neighbourhood must include the neighbours
	 * that point AT it.
	 *
	 * ⭐ AND THE NEIGHBOURHOOD IS NOW BOTH RELATIONS. A node is a Rollout, so
	 * depth 1 from THIS rollout reaches the environment before and after it on
	 * its own line AND the services it must ship with inside its own
	 * environment. The tab used to show only the second; the promotion chain
	 * lived in a separate card in a different geometry, which is exactly the
	 * "two graphs" split the human rejected three times.
	 */
	const networkEnvOrder = $derived(
		[...new Set(listEnvironments.map((e) => e.spec?.environment).filter(Boolean) as string[])].sort(
			compareEnvironmentNames
		)
	);

	const networkGateContext = $derived(
		buildGateContext({
			environments: listQuery.data?.environments ?? null,
			rolloutDependencies: listQuery.data?.rolloutDependencies ?? null
		})
	);

	const fullNetwork = $derived(
		buildRolloutGraph({
			rollouts: listRollouts,
			environments: listEnvironments,
			dependencies: allDeps,
			envOrder: networkEnvOrder,
			gates: networkGateContext
		})
	);

	/**
	 * THIS rollout — cluster, namespace and name, not just the name. Three
	 * rollouts share the name `hello-api-app` and a name-keyed focus would ring
	 * whichever one sorted first.
	 */
	const focusId = $derived(nodeId(cluster, namespace, name));
	/** Its promotion neighbours and its contract neighbours. Depth 1 — no further. */
	const localNetwork = $derived(neighbourhood(fullNetwork, focusId, 1));
	const localVerdict = $derived(networkVerdict(localNetwork));

	/** The env identity theme for a tier, for the graph's chips. */
	const networkThemeOf = $derived((env: string) => {
		const e = listEnvironments.find((x) => x.spec?.environment === env);
		if (!e) return null;
		const r = listRollouts.find(
			(x) =>
				x.metadata?.namespace === e.metadata?.namespace &&
				x.metadata?.name === e.spec?.rolloutRef?.name
		);
		return getRolloutEnvironmentTheme(r ?? null, e);
	});
</script>

<svelte:head>
	<title
		>kuberik | {rollout?.metadata
			? `${rollout.metadata.name} (${rollout.metadata.namespace}) - Dependencies`
			: 'Dependencies'}</title
	>
</svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	{#if rolloutQuery.isLoading}
		<StillTryingNotice failureCount={rolloutQuery.failureCount} />
		<div class="grid gap-4 xl:grid-cols-[3fr_minmax(22rem,2fr)] xl:items-start">
			<div class="h-44 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
			<div class="h-44 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
		</div>
	{:else if rolloutQuery.isError}
		<!--
			⛔ WAS THE RAW `Error.message` AND NOTHING ELSE — on a 503 that is the
			string `Request failed (503)`, alone, in a box. This tab's whole subject
			is "what is blocking me / who is blocked on me", so a silent blank here
			says "nothing depends on you", which is the one answer it must never
			invent out of a failure.
		-->
		<ErrorState
			error={rolloutQuery.error}
			subject="the dependencies of this rollout"
			backHref={`/rollouts/${cluster}/${namespace}/${name}`}
			backLabel="Back to this rollout"
			onRetry={() => rolloutQuery.refetch()}
			isRetrying={rolloutQuery.isFetching}
			class="py-0"
		/>
	{:else}
		<div>
			<!-- ══ PAGE HEADER — the 24px lead the composition grammar requires,
			     and the same structure the Overview tab uses (title, env chip,
			     one gray line under it). Before this the page's largest type was
			     a 10px `t-label` eyebrow. ══ -->
			<div class="mb-4">
				<div class="flex flex-wrap items-baseline gap-3">
					<!-- Same display pair as the Overview tab and /apps/[name]: mono
					     identifier first, human title second in the light face. -->
					<h1 class="flex min-w-0 flex-wrap items-baseline gap-2">
						<span class="t-display-id min-w-0 truncate text-gray-900 dark:text-white">{name}</span>
						{#if appTitle !== name}
							<span class="t-display min-w-0 truncate text-gray-500 dark:text-gray-400">{appTitle}</span>
						{/if}
					</h1>
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
				<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{lede}</p>
			</div>

			{#if !hasChain && !hasContracts && !hasDependents}
				<!-- ⛔ THE EMPTY STATE IS DELIBERATE AND IT IS ONE SENTENCE, NOT TWO
				     EMPTY CARDS. Most rollouts block nobody and are blocked by
				     nobody, and a page that draws a `Waiting on other services` card
				     and a `Services waiting on this` card with nothing in
				     either would be the norm drawn twice, at card scale, on almost
				     every rollout in the product. Three components have been cut for
				     less. Neither card renders at all unless a `RolloutDependency`
				     names this rollout on that end.

				     And this state is mostly UNREACHABLE by design: the tab's own
				     `show:` predicate is `hasEnvironment || hasDependencies`, and
				     `hasDependencies` now matches BOTH ends of the edge, so a
				     rollout with nothing on any axis has no tab to land on. The
				     sentence exists for the seconds before the list arrives and for
				     a rollout whose gates were deleted while the page was open. -->
				<div
					class="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
				>
					Nothing else has to happen first. This rollout waits on no other service, nothing waits on
					it, and it is not part of a promotion chain.
				</div>
			{:else}
				{#if banner}
					<!-- THE FILLED BANNER, for the page's ONE blocking fact. Amber,
					     because a contract block does not clear itself and does not
					     clear on approval either — somebody has to ship the other
					     service. `AlertPanel` is the product's only banner. -->
					<!-- ⭐ THE RECORD, in the banner's own ink. -->
					{#snippet bannerFacts()}
						<FactList facts={banner?.facts ?? []} tone="banner" />
					{/snippet}
					<AlertPanel
						severity="warning"
						icon={ShareNodesSolid}
						title={banner.title}
						message={banner.message}
						footnoteBody={banner.facts.length > 0 ? bannerFacts : undefined}
						footnoteCount={banner.facts.length > 0 ? banner.count : undefined}
						footnoteNoun={banner.noun}
					>
						{#snippet actions()}
							{#if banner.href && banner.label}
								<NextStep
									step="open"
									href={banner.href}
									label={banner.label}
									title={banner.label}
								/>
							{/if}
						{/snippet}
					</AlertPanel>
				{/if}

				<!-- ══ THE MAP, BEFORE THE LISTS ═══════════════════════════════
				     The two cards below answer *"what blocks me"* and *"what do
				     I block"* — both are lists of this rollout's neighbours. A
				     list of neighbours is not a map, and the human asked for the
				     map twice. This is the SAME component `/dependencies`
				     renders the fleet with, focused on this node, so the reader
				     learns one geometry once.

				     It renders only when this rollout is actually in the network.
				     A service with no contracts gets no empty graph frame — the
				     norm is not drawn. -->
				{#if localNetwork.edges.length > 0}
					<Card icon={ShareNodesSolid} title="In the network" class="mb-4">
						{#snippet rollup()}
							<!-- HIDDEN BELOW `sm`: at 390 the verdict and the link together
							     pushed `In the network` to `In the netw…`, and a clipped card
							     title is a hard defect. The banner above already states the
							     block, so the phone loses nothing. -->
							<span
								class="hidden text-xs font-medium whitespace-nowrap sm:inline {localVerdict.tone ===
								'adverse'
									? 'text-red-700 dark:text-red-400'
									: 'text-gray-500 dark:text-gray-400'}">{localVerdict.text}</span
							>
							<a
								href="/dependencies"
								class="text-xs font-medium whitespace-nowrap text-blue-600 hover:underline dark:text-blue-400"
								>Whole network ›</a
							>
						{/snippet}
						<DependencyNetwork
							graph={localNetwork}
							focus={focusId}
							themeOf={networkThemeOf}
							compact
						/>
					</Card>
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

				     ⛔ AND THE BLOCK NO LONGER CAPS ITSELF AT `max-w-[64rem]`.
				     From the human: *"dependencies page doesn't use full width
				     like the other pages."* Measured at 1800, that cap was
				     literally true and it was THIS: the container is the
				     product's own `max-w-7xl` on every tab, but inside it this
				     block drew **1024px against the Overview and History tabs'
				     1232** — a 208px step on the right edge every time the
				     reader crossed the tab strip, on the same object, with the
				     navbar and the tabs not moving. The reason written here was
				     *"this page has a natural maximum useful width"*, which is
				     the exact argument `/activity`'s `max-w-5xl` was removed
				     for: a narrower measure is legitimate ONLY from LINE
				     LENGTH, and the widest thing on this page is a GRAPH, which
				     wants every pixel.

				     The tracks are `3fr / minmax(22rem, 2fr)` — the Overview
				     tab's own split, so the two tabs put their rail in the same
				     place. At 1800 that is a 730px column of sentences beside a
				     486px rail, not the 856px the bare removal would have
				     given; a contract sentence is prose and 856px is past its
				     measure even though the block is not. -->
				<div
					class="grid gap-4 {twoColumns
						? 'xl:grid-cols-[3fr_minmax(22rem,2fr)] xl:items-start'
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
									{@const drawn = drawsRelation(b)}
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
													class="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400"
													aria-hidden="true"
												/>
											</a>
											<!-- ⛔ ONLY WHERE THE HELD ROW BELOW DOES NOT DRAW IT.
											     See `drawsRelation`: when the relation is drawn,
											     `[API|1.66.0]` is already the left operand of
											     `⇄ hello-api-app [API|1.66.0] → [^1.67.0]` 60px
											     down, and printing it here made the provider and
											     its served version appear three times in one
											     card. One fact drawn twice is worse than one fact
											     narrated once. -->
											{#if b.providedVersion && !b.providedVaries && !drawn}
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
											{:else if b.providedTag && drawn}
												<!-- THE ONE FACT THE DRAWING DOES NOT CARRY: which
												     release line the served version came off. The
												     version itself is the drawn clause's left
												     operand, so the sentence is what is LEFT of it,
												     in the same `From <tag>` form the mirror card
												     one column over already prints. -->
												From <span class="t-code-sm">{b.providedTag}</span>
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
												{b.pastTags.length === 1 ? 'version' : 'versions'} nobody is trying to deploy
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
											<div class="mt-3 border-l-2 border-red-700/40 pl-3 dark:border-red-400/40">
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

					{#if hasDependents}
						<!-- ── AXIS 3 · WHAT THIS ROLLOUT IS HOLDING ───────────────
						     ⛔ THIS IS NOT THE CONTRACT CARD MIRRORED, AND THE
						     DIFFERENCE IS WHERE THE SUBJECT LIVES.

						     The contract card has N providers, each with its own
						     version, so its subject is THE OTHER SERVICE, once per
						     row, and the number beside it is THEIRS. Here there is
						     exactly ONE version and it is OURS — the release this
						     rollout has deployed, which every gate pointing at it
						     reads the same. So the subject is THAT NUMBER, stated
						     once at the top, and the services standing on it hang
						     beneath it. A second copy of the contract card's geometry
						     would have printed our own version once per consumer.

						     The weights differ too. Being blocked is a task: the card
						     above is a list of things somebody must do. Being a
						     provider is a CONSEQUENCE — nothing here asks the reader
						     to act until a consumer is actually held, and what the
						     card carries in the meantime is the floor under this
						     rollout, read off a release that is genuinely deployed
						     (`requires`), so a person about to change the version can
						     see what is standing on the current one. -->
						<Card
							icon={CodeForkSolid}
							title="Services waiting on this"
							verdict={heldCount > 0
								? `${heldCount} of ${dependentCount} held`
								: `${dependentCount} service${dependentCount === 1 ? '' : 's'}`}
							verdictTone={heldCount > 0 ? 'adverse' : 'neutral'}
							verdictTitle={heldCount > 0
								? 'Services with a version they cannot deploy until this rollout ships a newer contract'
								: 'Services gated on the contract version this rollout has deployed'}
							padded={false}
							class="min-w-0 {twoColumns ? '' : 'max-w-[44rem]'}"
						>
							<ul class="divide-y divide-gray-200 dark:divide-gray-700">
								{#each provided as c (c.key)}
									<li class="px-4 py-4">
										<!-- THE SUBJECT LINE — OUR OWN NUMBER, ONCE. The word
										     carries the verb and the joined badge carries the
										     `[contract][version]` pair in the same form the
										     contract card uses for a provider's, so a reader who
										     has learned one has learned both. -->
										<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
											<!-- ⛔ `Serving` IS A 12px CAPTION, NOT A 14px HEADING, AND
											     THAT IS THE HIERARCHY FIX. Measured on the live provider
											     page at 1440: with the word at 14px/600 it matched the
											     CONSUMER NAMES below it exactly, so the card had two
											     peers and no lead, and the eye had nothing to scan. The
											     names are what a reader is looking for — who is standing
											     on me — so they keep 14/600 and are the only things in
											     this body that have it. The premise keeps its WEIGHT in
											     the chip, which is a bordered box and reads without
											     borrowing type size. -->
											<span class="text-xs text-gray-500 dark:text-gray-400">Serving</span>
											{#if c.providedVersion && !c.providedVaries}
												<Chip
													role="count"
													label={c.contract}
													value={c.providedVersion}
													wide
													title="This rollout has deployed {c.contract} {c.providedVersion}"
													valueTitle="The contract version every service below is gated on"
													class="shrink-0"
												/>
											{:else}
												<span class="t-code-sm text-gray-500 dark:text-gray-400">{c.contract}</span>
											{/if}
										</div>

										<!-- THE CONSEQUENCE, ONCE PER CONTRACT. It is what makes
										     this card a warning rather than a task list, and it
										     is definitionally true of a `RolloutDependency` — it
										     names no cause it cannot evidence. -->
										<p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
											{#if c.providedVaries}
												<!-- The gates disagree about what they have read from
												     this one rollout, so there is no single number and
												     the page does not pick one. Each row prints its
												     own below. -->
												The gates have read different versions from this rollout.
											{:else if c.providedTag}
												From <span class="t-code-sm">{c.providedTag}</span> ·
											{:else if !c.providedVersion}
												<!-- NEVER NAME A CAUSE YOU CANNOT EVIDENCE. An absent
												     `providedVersion` says the gate has read none; it
												     does not say this rollout has deployed nothing. -->
												No version of {c.contract} has been read from this rollout yet ·
											{/if}
											{#if !c.providedVaries}
												what this serves decides which versions they can run
											{/if}
										</p>

										<ul class="mt-4 space-y-4">
											{#each c.dependents as d (d.key)}
												{@const unresolved = d.places.some((p) => p.state?.requiresUnresolved)}
												{@const nowhere = d.places.every((p) => p.state?.neverDeployed)}
												<li class="min-w-0">
													<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
														<a
															href={consumerHref(d)}
															class="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold text-gray-900 hover:underline dark:text-white"
															title="Open {d.name} and see this same relation from its side"
														>
															<span class="min-w-0 truncate">{d.name}</span>
															<ArrowUpRightFromSquareOutline
																class="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400"
																aria-hidden="true"
															/>
														</a>
														<!-- WHERE IT RUNS. A consumer bound to an
														     `Environment` wears its tier; one that is not
														     wears its NAMESPACE as a handle, because a
														     rollout with no Environment has no tier and
														     inventing one is the defect DESIGN.md names.

														     ⛔ THE PLACES ARE NAMED IN EXACTLY ONE ROW, AND
														     IT IS THE ROW THAT KNOWS SOMETHING ABOUT THEM.
														     Measured on the seven-environment fixture:
														     `checkout-api` is gated in five namespaces on
														     three different held builds, and printing the
														     full set here as well as on each hold rendered
														     THIRTEEN environment chips for ONE consumer,
														     over three wrapped lines. The holds carry the
														     places that DIFFER (`b-45` in three of them,
														     `b-43` in the other two) — that distinction is
														     the whole content — so when a consumer has
														     holds this row states only HOW MANY, in the
														     same right-aligned neutral count the contract
														     card uses for its own asymmetry. A consumer
														     with ONE place always names it: a count of one
														     is not a fact, and it would leave the row with
														     no location at all. -->
														{#if d.places.length > 1 && d.holds.length > 0}
															<span
																class="ml-auto shrink-0 text-xs whitespace-nowrap text-gray-500 dark:text-gray-400"
																title="Gated on this in {d.places
																	.map((p) => p.namespace)
																	.join(', ')}"
															>
																in {d.places.length} places
															</span>
														{:else}
															{#each d.places as p (p.namespace)}
																{@const th = placeTheme(p.namespace, d.name)}
																{#if th}
																	<Chip
																		role="env"
																		theme={th}
																		label={shortEnvLabel(th) || p.namespace}
																		title="{d.name} in {p.namespace}"
																		wide
																	/>
																{:else}
																	<span
																		class="t-code-sm text-gray-500 dark:text-gray-400"
																		title="{d.name} in {p.namespace}">{p.namespace}</span
																	>
																{/if}
															{/each}
														{/if}
													</div>

													<!-- ⭐ THE FLOOR UNDER THIS ROLLOUT, AS AN
													     OBSERVATION. `requires` is read off the release
													     the consumer HAS DEPLOYED, so this is a fact
													     about a running system and not a warning the UI
													     made up. It is printed VERBATIM: a bare version
													     is an EXACT match in Masterminds semver.
													     Everything here prints only when it has a
													     witness — an unreachable consumer says so, an
													     unreadable manifest says so, and neither is
													     rendered as "it needs nothing". -->
													<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
														{#if d.unobserved}
															This dashboard cannot see {d.name} to say what it is running
														{:else if d.runningVaries}
															Each place runs its own version of {d.name}
														{:else if d.running}
															Running <span class="t-code-sm">{d.running}</span
															>{#if d.requires && !d.requiresVaries}, which needs {c.contract}
																<span class="t-code-sm">{d.requires}</span
																>{:else if d.requiresVaries}, and its places ask different things of {c.contract}{:else if unresolved},
																and what it needs of {c.contract} could not be read{/if}
														{:else if nowhere}
															Has deployed nothing here yet
														{/if}
														{#if d.pastTags.length > 0}
															<!-- Counted once, never drawn. These are held
															     builds the consumer is already PAST — the gate
															     working on candidates nobody will deploy. -->
															· also holds {d.pastTags.length} older
															{d.pastTags.length === 1 ? 'version' : 'versions'} nobody is trying to
															deploy
														{/if}
													</p>

													<!-- THE ADVERSE CASE, AND THE ONLY THING IN THIS CARD
													     THAT SPENDS AN ADVERSE COLOUR. Same mark, same
													     sentence and same left rule as the contract card:
													     one relation stated identically from both ends. -->
													{#each d.holds as h (h.key)}
														<div
															class="mt-2 border-l-2 border-red-700/40 pl-3 dark:border-red-400/40"
														>
															<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
																<Chip
																	role="blocked"
																	label="held"
																	value={h.display}
																	valueTitle={h.tag}
																	wide
																	title="{d.name} cannot deploy {h.tag} until this rollout serves a newer {c.contract}"
																	class="shrink-0"
																/>
																{#if d.places.length > 1}
																	<span class="text-xs text-gray-500 dark:text-gray-400">in</span>
																	{#each h.places as ns (ns)}
																		{@const th = placeTheme(ns, d.name)}
																		{#if th}
																			<Chip
																				role="env"
																				theme={th}
																				label={shortEnvLabel(th) || ns}
																				title={ns}
																				wide
																			/>
																		{:else}
																			<span class="t-code-sm text-gray-500 dark:text-gray-400"
																				>{ns}</span
																			>
																		{/if}
																	{/each}
																{/if}
															</div>
															<BlockReason
																class="mt-1.5"
																reason={contractBlockReason({
																	provider: name,
																	contract: c.contract,
																	requiredVersion: h.requiredVersion,
																	providedVersion: c.providedVersion,
																	gateName: gateNameOf(d),
																	reason: h.reason
																})}
															/>
														</div>
													{/each}
												</li>
											{/each}
										</ul>
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
