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
	import { shortenVersion } from '$lib/utils';
	import NextStep from '$lib/components/NextStep.svelte';
	import StageChain from '$lib/components/StageChain.svelte';
	import UpToDate from '$lib/components/UpToDate.svelte';
	import { rolloutQueryOptions, rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { getRolloutEnvironmentTheme, shortEnvLabel } from '$lib/environment-theme';
	import type { EnvironmentTheme } from '$lib/environment-theme';
	import { rolloutPath } from '$lib/source-dashboard';
	import { groupRolloutsByApp } from '$lib/version-utils';
	import type { Rollout, Environment, RolloutDependency } from '../../../../../../types';
	import { pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';
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
		type DependentPlace,
		type EnvHistoryEntry,
		type EnvInfo,
		type ProvidedContract,
		type Release
	} from '$lib/view-models/dependencies';
	import { rankVerdicts } from '$lib/view-models/env-rank';
	import DependencyNetwork from '$lib/components/DependencyNetwork.svelte';
	import { compareEnvironmentNames } from '$lib/env-order';
	import {
		buildGateContext,
		blockingStory,
		contractRuleCountLabel
	} from '$lib/view-models/blocking-story';
	import { countLabel } from '$lib/disclosure';
	import {
		buildRolloutGraph,
		neighbourhood,
		nodeId,
		namespacesByCluster,
		withNetworkSchedules
	} from '$lib/view-models/dependency-graph';
	import { fetchNetworkSchedules } from '$lib/api/schedules';

	const cluster = $derived(page.params.cluster as string);
	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);

	// ⭐ PERF-2026-09-04 §C.7 SLICE 4 — STREAM-AWARE (see Navbar.svelte).
	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace,
			name,
			cluster,
			// ⭐ CLUSTER-AWARE — this rollout's own cluster, not the fleet-wide
			// "every cluster up" gate. See rollout detail's identical comment.
			options: { refetchInterval: pollWhenHealthy(5000, 60000, cluster) }
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
	// ⭐ STREAM-AWARE (see RolloutGrid.svelte).
	const listQuery = createQuery(() =>
		rolloutsListQueryOptions({ options: { refetchInterval: pollWhenHealthy(15000, 60000) } })
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
	// ⛔ THE PROVIDED VERSION STAYS SCOPED TO THIS ROLLOUT INSTANCE — THE
	// DEPENDENTS LIST NO LONGER DOES. `hello-api-app` in `hello-dep-staging`
	// is a different rollout serving a different number, with its own page,
	// so `providedContracts`' `providerNamespace` still keeps THIS card's
	// headline `[api|1.66.0]` badge sourced from THIS instance's own gates
	// only — folding that would reopen the `in hello-dep-prod` defect this
	// comment used to warn about wholesale.
	//
	// ⭐ 2026-09-03 · BUT WHO IS STANDING ON THE CONTRACT IS NOW THE WHOLE
	// APP'S PICTURE, NOT THIS INSTANCE'S ALONE. From the coordinator, walking
	// `hello-api-app`'s own tab: the graph directly above this card already
	// draws `hello-frontend-app` held in dev, staging AND prod — it walks
	// this app's whole promotion line (`neighbourhood()`, AXIS-1-shaped) —
	// while this card, scoped to one namespace, printed `1 of 1 held` and
	// named only the one environment the page happened to be open on. THE
	// GRAPH COUNTS ROLLOUTS, WHICH IS THE PRODUCT'S UNIT, and the card one
	// scroll below it must not count something narrower. `providerNamespaces`
	// (passed to `providedContracts` below) is `siblings`' own namespace set —
	// the SAME authority `groupRolloutsByApp` gives the chain and the graph —
	// so this card cannot name an environment the rest of the tab disagrees
	// is part of this app.

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

	/**
	 * Every namespace THIS APP runs in — `siblings` is `groupRolloutsByApp`'s
	 * own set, the same authority the chain and the graph read, so this
	 * card's widened scope (below) cannot include an environment the rest of
	 * the tab does not also consider part of this app.
	 */
	const providerNamespaces = $derived([
		namespace,
		...[...siblings.values()].map((s) => s.namespace).filter(Boolean)
	]);

	const provided: ProvidedContract[] = $derived(
		providedContracts({
			deps: allDeps,
			provider: name,
			providerNamespace: namespace,
			providerNamespaces,
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
	/**
	 * ⭐ 2026-09-03 · THE OWN-NAMESPACE PLACE, PREFERRED. `d.places` now spans
	 * every environment of this APP (see AXIS 3's own note above), sorted
	 * alphabetically by namespace — so `d.places[0]` stopped being "the one
	 * place this instance has" and became "whichever namespace sorts first",
	 * `hello-dep-dev` on the live fleet regardless of which environment's
	 * page is open. The gate name and the "Open" link both belong to THIS
	 * instance's own sibling consumer when one exists (same pairing the rest
	 * of the fixture uses: one namespace per environment holds both ends),
	 * falling back to the first place when this app has no consumer in this
	 * exact namespace.
	 */
	function ownPlace(d: Dependent): DependentPlace | undefined {
		return d.places.find((p) => p.namespace === namespace) ?? d.places[0];
	}

	function gateNameOf(d: Dependent): string | null {
		return ownPlace(d)?.dep?.status?.gateName ?? null;
	}

	function consumerHref(d: Dependent): string | undefined {
		const p = ownPlace(d);
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
	// `hasNetwork`/`twoColumns` are declared further down, right after
	// `localNetwork` — see that declaration's own comment for why the rail
	// now has two possible occupants. (TS block scoping: `localNetwork` is
	// itself `$derived` from `fullNetwork`, which is built from query data
	// declared later in this file, so `hasNetwork` cannot live up here
	// without a used-before-declaration error.)

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

	/**
	 * ⭐ 2026-09-03 · THE CARD'S OWN VERDICT, IN ROLLOUTS — THE PRODUCT'S
	 * UNIT, PER THE GRAPH 20PX ABOVE IT. `dependentCount`/`heldCount` above
	 * are SERVICES (one `hello-frontend-app`, whichever or however many of
	 * its environments hold it); a rollout is one (service, namespace) pair,
	 * so `hello-frontend-app` held in dev, staging AND prod is 1 service but
	 * 3 rollouts, and the two must not be printed as if they were the same
	 * fraction. Counted over `d.places`/`h.places` now that AXIS 3 spans this
	 * app's whole promotion line, not row-counted — two contracts gating the
	 * same (service, namespace) pair is still one rollout.
	 */
	const rolloutCount = $derived(
		new Set(
			provided.flatMap((c) =>
				c.dependents.flatMap((d) => d.places.map((p) => `${d.name}/${p.namespace}`))
			)
		).size
	);
	const heldRolloutCount = $derived(
		new Set(
			heldConsumers.flatMap(({ d }) =>
				d.holds.flatMap((h) => h.places.map((ns) => `${d.name}/${ns}`))
			)
		).size
	);
	/**
	 * `3 rollouts held across 1 service` — the rollout count leads because
	 * it is what the reader can also see drawn in the graph above; the
	 * service count is the second clause, not a second fraction, because a
	 * card titled "Services waiting on this" still needs to say which and
	 * how many SERVICES those rollouts belong to.
	 */
	const providedVerdict = $derived(
		heldRolloutCount > 0
			? `${heldRolloutCount} rollout${heldRolloutCount === 1 ? '' : 's'} held across ${heldCount} service${heldCount === 1 ? '' : 's'}`
			: `${rolloutCount} rollout${rolloutCount === 1 ? '' : 's'} · ${dependentCount} service${dependentCount === 1 ? '' : 's'}`
	);

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
	/**
	 * ⛔ THE CARD'S ROLLUP COUNTS PROVIDERS, NOT `ContractBlock`s. A block is
	 * one (contract, provider) PAIR, so a single service this rollout waits on
	 * for two contracts is TWO blocks — and `1 of 2 holding` against one named
	 * service in the banner above is a number the page contradicts itself on.
	 * The card is titled "Waiting on other SERVICES"; `heldProviders` is
	 * already deduplicated by name, so the denominator must be too.
	 */
	const providerCount = $derived(new Set(blocks.map((x) => x.providerName)).size);

	/**
	 * ⛔ ONE `BlockReason` PER DISTINCT `reason`, AND REASONS ARE NEVER FOLDED
	 * TOGETHER. (2026-09-20)
	 *
	 * The first cut of the compacted table rendered ONE `BlockReason` per
	 * provider, built from the newest held build. That is only true when every
	 * held build is held for the same cause, and the controller does not
	 * guarantee it: `reason` is an open string and one dependency really does
	 * report `ConstraintNotSatisfied` for one release and `ProviderVersionTooOld`
	 * for another. Folding them printed the newest build's cause as the cause of
	 * all of them — a confident falsehood, which is the defect class this page
	 * was rebuilt to close.
	 *
	 * Insertion order is preserved, so the groups stay newest-first and so do
	 * the rows inside each one; `rows[0]` is therefore that group's own newest
	 * build, and its constraint is the one its sentence quotes.
	 */
	function byReason<T extends { reason: string | null; requiredVersion: string | null }>(
		rows: T[]
	): { reason: string | null; rows: T[] }[] {
		const out: { reason: string | null; rows: T[] }[] = [];
		for (const r of rows) {
			const g = out.find((x) => x.reason === r.reason);
			if (g) g.rows.push(r);
			else out.push({ reason: r.reason, rows: [r] });
		}
		return out;
	}

	const blockedBanner = $derived.by(() => {
		if (heldTags.size === 0) return null;
		const n = heldTags.size;
		const one = heldProviders.length === 1;
		return {
			title: `${n} build${n === 1 ? '' : 's'} held`,
			message: one
				? `${heldProviders[0]} has to move first. Nothing newer deploys here until it does.`
				: `${heldProviders.length} other services have to move first. Nothing newer deploys here until they do.`,
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
			/**
			 * ⭐ FINDING 2's OWN LABEL. `contractRuleCountLabel` reads
			 * `pageStory.gates` — this rollout's full, classified gate set, the
			 * same one the Overview banner counts — and names the promotion-order
			 * gate riding along with the contract when there is one, instead of
			 * silently counting only contracts. Falls back to the plain contract
			 * count if `blockingStory` finds nothing (a join timing mismatch,
			 * never the ordinary case), so the footnote is never blank.
			 */
			footnoteText:
				pageStory.gates.length > 0
					? contractRuleCountLabel(pageStory)
					: countLabel(new Set(adverse.map((b) => b.contract)).size, 'contract'),
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
				? `${names[0]} is held until this one ships`
				: `${names.length} services are held until this one ships`,
			message: one
				? `${versions} build${plural} of ${names[0]} need${plural ? '' : 's'} a newer ${contracts.join(', ')} than this rollout is serving.`
				: `Between them, ${versions} build${plural} need a newer ${contracts.join(', ')} than this rollout is serving.`,
			/**
			 * THE SET IS THE SERVICES, and the same argument applies: `Waiting on
			 * this: alpha, beta` is a list wearing a colon. Each name is a
			 * rollout you can go and open, so it is a handle.
			 */
			facts: names.map((n) => ({ label: 'Service', value: n, handle: true })) as Fact[],
			// A count of SERVICES waiting on this rollout, not a rule count —
			// `contractRuleCountLabel` does not apply here, so this keeps the
			// plain `N service(s)` `countLabel` already produced via
			// `footnoteCount`/`footnoteNoun`, just carried as the same string
			// shape `blockedBanner`'s sibling now uses.
			footnoteText: countLabel(names.length, 'service'),
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
			: 'What has to happen before a newer build of this app can deploy.'
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

	/**
	 * ⭐ SAME FIX AS `/dependencies` — see `withNetworkSchedules`'s own comment.
	 * Without this, a `RolloutSchedule`-owned gate anywhere in this rollout's
	 * neighbourhood fell through `classifyGate` to `'A check is not passing'`
	 * instead of naming the window, on the ONE tab whose whole job is to say
	 * what is holding this rollout. `''` is the local/hub cluster.
	 */
	const networkClusterNames = $derived([
		'',
		...(listQuery.data?.clusters ?? []).map((c) => c.name)
	]);
	// ⭐ STREAM-AWARE — see ControlCenter.svelte's identical comment.
	const networkSchedulesQuery = createQuery(() => ({
		queryKey: ['network-schedules', networkClusterNames],
		queryFn: () => fetchNetworkSchedules(networkClusterNames),
		staleTime: staleTimeWhenHealthy(15000, 30000),
		refetchInterval: pollWhenHealthy(30000, 60000),
		enabled: networkClusterNames.length > 0
	}));

	const networkGateContext = $derived(
		withNetworkSchedules(
			buildGateContext({
				environments: listQuery.data?.environments ?? null,
				rolloutDependencies: listQuery.data?.rolloutDependencies ?? null
			}),
			networkSchedulesQuery.data ?? new Map(),
			namespacesByCluster(listRollouts)
		)
	);

	/**
	 * ⭐ FINDING 2 (coordinator sweep, 2026-09-03): ONE PRODUCER FOR THIS
	 * ROLLOUT'S COUNT. `blockedBanner` below used to count DISTINCT CONTRACTS
	 * from this page's own `adverse`/`blocks` model (`1 contract`) with no
	 * reference to the rollout's full gate set — so the Overview banner for
	 * the identical rollout said `2 rules` (the contract gate PLUS the
	 * downstream promotion-order gate that exists only because the contract
	 * hasn't cleared) while this tab, sitting directly under it, said `1
	 * contract` and silently dropped the second gate. `pageStory` is the same
	 * `blockingStory` call the Overview makes, off the same schedule-aware
	 * `networkGateContext` this page already builds for its graph — so this
	 * tab's own footnote agrees with the banner above it.
	 */
	const pageStory = $derived(blockingStory(rollout, networkGateContext, { place: currentEnv }));

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
	/**
	 * Its promotion neighbours and its contract neighbours. Depth 1 — no
	 * further. `networkVerdict(localNetwork)` — this card's own EDGE-scoped
	 * count — is no longer read here; see the rollup snippet's own comment
	 * (§5e) for the argument. `networkVerdict` stays exported from
	 * `dependency-graph.ts` — `/dependencies` still rolls up its own network
	 * with it.
	 */
	const localNetwork = $derived(neighbourhood(fullNetwork, focusId, 1));

	const hasNetwork = $derived(localNetwork.edges.length > 0);
	/**
	 * ⭐ 2026-09-18 · THE RAIL NOW HAS TWO POSSIBLE OCCUPANTS.
	 *
	 * Was `hasChain && (hasContracts || hasDependents)`. `In the network`
	 * moved into the rail alongside `Where it's running` (see the composition
	 * comment above the grid markup below), so a rollout with a map and no
	 * chain — `standalone-api`, one provider, unbound from any `Environment` —
	 * now gets two columns where it used to get a single 44rem card floating
	 * in a page-wide container.
	 */
	const twoColumns = $derived((hasChain || hasNetwork) && (hasContracts || hasDependents));
	/**
	 * ⭐ THE MAP'S ROLLUP COUNTS WHAT IS DRAWN, AND NOTHING ELSE. (2026-09-20)
	 *
	 * §5e removed `1 of 1 links not read` for two reasons that still stand: it
	 * counted EDGES where the rest of the page counts builds and services, and
	 * it asserted a total the lists contradict — the map is this rollout's own
	 * environment plus one hop, the lists span every environment of the app.
	 * A card with a 47px header and no rollup is half the pattern, though, and
	 * this was the only one of the three on this page missing one.
	 *
	 * The resolution is a number whose scope IS the drawing: distinct service
	 * names in the box, minus this one. It cannot contradict the lists because
	 * it does not claim to be a total of anything — a reader can count the
	 * boxes and get the same answer, which is the test a rollup has to pass.
	 * The promotion line is collapsed by NAME so seven environments of one
	 * service are one service, not seven.
	 */
	const otherServicesDrawn = $derived(
		Math.max(0, new Set(localNetwork.nodes.map((n) => n.name)).size - 1)
	);

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

<div class="mx-auto w-full px-4 py-6 sm:px-6">
	{#if rolloutQuery.isLoading}
		<StillTryingNotice failureCount={rolloutQuery.failureCount} />
		<div class="grid gap-4 lg:grid-cols-[3fr_minmax(22rem,2fr)] lg:items-start">
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
							<span class="t-display min-w-0 truncate text-gray-500 dark:text-gray-400"
								>{appTitle}</span
							>
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
						footnoteLabel={banner.facts.length > 0 ? banner.footnoteText : undefined}
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

				<!-- ══ MAIN HOLDS WHAT HAS TO MOVE; THE RAIL HOLDS WHERE THINGS
				     ARE. (2026-09-18 redesign — the human's complaint was *"the
				     page looks too messy … a held banner, a mostly empty graph
				     card with a floating label, and two dense lists."*)

				     `Waiting on other services` and `Services waiting on this`
				     are TASK LISTS whose rows are sentences with a `BlockReason`
				     under them — they need the wide track for the same reason
				     the Overview tab's timeline does. `In the network` and
				     `Where it's running` are both LOCATORS: they answer *where
				     am I*, not *what do I do*, and they are made of chips and a
				     drawing, neither of which wants more than the rail. This is
				     the same rail the rollout detail page fills with External
				     Links / Health Checks / Resources — a stack of small
				     complete answers.

				     The map used to be a standalone full-width band ABOVE this
				     grid (`class="mb-4"`). Deleted: at
				     1920 its body was 1570px against a drawing whose natural
				     width is ~226px (a rollout's local neighbourhood is usually
				     two nodes in one environment, one dagre rank, so
				     `fillWidth`'s stretch branch never fires) — 29% ink, and the
				     *"mostly empty graph card"* the human named. It is not
				     removed, it is RE-PARENTED into the rail below, sized to a track that
				     is 352–660px instead of 1024–1600px. See `DependencyNetwork`
				     and `GraphCanvasInner` for the frame/legend/rollup changes
				     that made a rail-width map read as full rather than
				     starved. -->

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
						? 'lg:grid-cols-[3fr_minmax(22rem,2fr)] lg:items-start'
						: ''}"
				>
					<!-- ⚠️ Svelte will not compile a `<div>` whose opening and closing
					     tags sit in different `{#if}` blocks — each column wrapper
					     below opens and closes inside ONE `{#if}`. -->
					{#if hasContracts || hasDependents}
						<!-- MAIN — the column that holds SENTENCES and TASKS. -->
						<div class="grid min-w-0 content-start gap-4 {twoColumns ? '' : 'max-w-[44rem]'}">
							{#if hasContracts}
								<!-- ── AXIS 2 · CONTRACT GATES ─────────────────────────────
						     FIRST, and the reason is the growth curve: this card is
						     bounded by the number of contracts a service consumes,
						     while the chain grows with the number of environments
						     (thirteen on `edge-mesh`). The bounded, gate-carrying card
						     stays above the fold at 390 at every N. -->
								<!-- ⭐ 2026-09-18 · THE HEADER ROLLUP — WAS `4 builds held` /
						     `adverse`. Two reasons it changed:
						     1. `4 builds held` was the banner's headline verbatim, 40px
						        above it. A rollup that restates the banner costs a slot
						        and adds nothing. `2 of 3 holding` is the reference page's
						        own ratio idiom (`3/3 healthy`, `10/10 ready`) and states a
						        fact the banner does not have: one of the three services
						        this rollout waits on is fine.
						     2. `verdictTone` moves from `adverse` (red) to `held` (orange)
						        — `Card` already exports the tone with the comment *"held —
						        needs a person or another deploy; the product's orange, not
						        red."* Every chip in this card is orange; the rollup was the
						        only red thing in it. Closing a latent inconsistency, not
						        adding a new colour. -->
								<Card
									icon={ShareNodesSolid}
									title="Waiting on other services"
									verdict={heldProviders.length > 0
										? `${heldProviders.length} of ${providerCount} holding`
										: `${providerCount} provider${providerCount === 1 ? '' : 's'}`}
									verdictTone={heldProviders.length > 0 ? 'held' : 'neutral'}
									verdictTitle={heldProviders.length > 0
										? `${heldProviders.join(', ')} will not let a newer build of this app deploy`
										: 'No service this app waits on is holding a build'}
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
														<!-- ⛔ `shortenVersion`, NOT THE RAW STRING. A contract
														     version is whatever the provider deployed, and on a
														     fleet that versions by commit that is a 40-character
														     SHA. `Chip` truncates with an ellipsis rather than
														     overflowing, so the raw value did not break the box —
														     it filled it with `9f3c1ab2e4d5…` and pushed the
														     row's own rollup off the card. The 7-char form is
														     what every other surface prints (`/envs/<name>`, the
														     dependency graph, `RepoLedgerCard`); the full value
														     stays one hover away, which is the same contract
														     `shortenVersion`'s other call sites keep. -->
														<Chip
															role="count"
															label={b.contract}
															value={shortenVersion(b.providedVersion)}
															wide
															title="{b.providerName} has deployed {b.contract} {b.providedVersion}"
															valueTitle="Contract version {b.providerName} is serving — {b.providedVersion}"
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
														<span class="t-code-sm" title={b.providedVersion}
															>{shortenVersion(b.providedVersion)}</span
														>, from
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
													<!-- ⭐ 2026-09-18 · `· not needed in {b.ungatedEnvs.join(', ')}`
											     IS DELETED, NOT LOST. On `search-api` it printed
											     `· not needed in staging, prod-af-south-1,
											     prod-ap-southeast-2, prod-eu-central, prod-us-east-1,
											     prod-us-east-2` — three wrapped 11px gray lines under
											     a row whose own rollup already says `in 1 of 7
											     environments`. The names are not lost: the rollup's
											     `title` attribute a few lines up already carries
											     `No ${b.contract} gate exists in
											     ${b.ungatedEnvs.join(', ')}`, which is the product's
											     own "fold in text, keep the full set in a `title`"
											     idiom (`Card.titleTooltip`, `.svc-line-caption`) — the
											     same argument this file already makes for not drawing
											     six "not here" chips, applied to the comma list that
											     replaced them. -->
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
																<span
																	class="t-code-sm text-gray-500 dark:text-gray-400"
																	title="{b.contract} {e.providedVersion}"
																	>{b.contract} {shortenVersion(e.providedVersion)}</span
																>
															</li>
														{/each}
													</ul>
												{/if}

												<!-- THE ONLY ROW IN THIS CARD THAT SPENDS COLOUR, AND IT IS
										     ORANGE, NOT RED. (2026-09-03) A gate correctly refusing a
										     candidate is `held`, not adverse — `Chip`'s own ruling,
										     see its `held: TRAILING` note — so this left rule takes
										     the same deep desaturated orange every status disc in the
										     product already resolves `held` to, not the red `failing`/
										     `diverged`/`blocked` share. Every other row is neutral or
										     an identity chip, so a quiet card means nothing is
										     held.
										
										     ⭐ 2026-09-18 · ONE GROUP, ONE TABLE — the main change of
										     this redesign. BEFORE, the four lines below (subject, held
										     chip + env chips, `BlockReason`) repeated ONCE PER HELD
										     BUILD — three times under `payments-svc`, differing only
										     in a version and a constraint. AFTER: one orange rule
										     around the WHOLE GROUP, one subject line, one row per
										     build, one `BlockReason`. What is deleted, and why it is
										     safe: the per-build repetition of (a) the `{name} is held`
										     subject line, (b) the `in` word on the env-chip row, (c)
										     the `BlockReason` sentence. Every fact survives — the
										     subject is stated once for the group with its count, the
										     env chips are still per build, the constraint is still per
										     build, and the sentence is still there for the build it
										     names.
										
										     `BlockReason` is rendered ONCE per provider, built from
										     `newest.requiredVersion` — `b.blocked` is newest-first, and
										     the newest held build is the one a person is actually
										     trying to deploy. Each row still carries its own constraint
										     VERBATIM in the `needs` column (a bare version is an exact
										     match in Masterminds semver), so no fact is lost and none
										     is repeated — the prior three copies of `BlockReason`
										     differed only in that one token. The `› 1 rule` disclosure
										     `BlockReason` owns therefore appears once per provider
										     instead of once per build; the `rule:` demotion ruling is
										     untouched, the gate name still rides with the sentence, it
										     is just not printed three times. -->
												{#if b.blocked.length > 0}
													<div
														class="mt-3 border-l-2 border-orange-700/40 pl-3 dark:border-orange-400/40"
													>
														<!-- ⛔ THE SUBJECT IS MARKUP TEXT, NOT A TERNARY OF TEMPLATE
													     LITERALS. The string census reads the markup; a sentence
													     assembled inside a `{...}` expression is invisible to it,
													     and a sentence the census cannot see is one nothing checks
													     for the product's vocabulary rulings. -->
														<p class="text-xs text-gray-500 dark:text-gray-400">
															<span class="font-medium text-gray-700 dark:text-gray-300"
																>{name}</span
															>
															{#if b.blocked.length === 1}
																is held on this build
															{:else}
																is held on {b.blocked.length} builds
															{/if}
														</p>

														<!-- ⛔ ONE SENTENCE PER DISTINCT `reason`, NEVER ONE PER PROVIDER.
													     `reason` is an open string and one dependency can report
													     `ConstraintNotSatisfied` for one release and
													     `ProviderVersionTooOld` for another; quoting the newest
													     build's cause for all of them is a confident falsehood.
													     See `byReason`'s own doc. Rows that differ only in their
													     reason render under their own reason line. -->
														<!-- ⛔ ONE GRID FOR THE WHOLE BRACKET, NOT ONE PER REASON
													     GROUP. `grid-cols-[max-content_max-content_1fr]` sizes
													     its columns from ITS OWN rows, so a grid per group gave
													     each group a different `needs` width and started the
													     environment chips at a different x — two ragged column
													     stacks inside one orange rule, which is the alignment the
													     compaction existed to buy. One grid holds every row; the
													     reason sentences are full-width items inside it
													     (`sm:col-span-3`), so they interleave without breaking
													     the columns above and below them.

													     ⚠️ `sm:contents` + THE 3-COLUMN GRID IS WHAT ALIGNS THE
													     COLUMNS. Each row `<li>` MUST render exactly three
													     children ALWAYS — the `needs` span and the env span render
													     EMPTY rather than being `{#if}`-ed away, or the grid shears
													     (a `<li>` with `display: contents` hands its children
													     straight to the grid, so two children instead of three
													     shifts every column after it). Below `sm` the `<li>` is a
													     plain wrapping flex row instead. DO NOT "tidy" the empty
													     spans away.

													     SPACING: the grid's own `gap-y-1.5` is 6px. A reason
													     sentence adds 2 (8px above a reason); the first row of a
													     LATER group adds 6 (12px above a new row group), which is
													     what makes two groups read as two rather than as one list
													     interrupted. -->
														<ul
															class="mt-1.5 flex flex-col gap-1.5 sm:grid sm:grid-cols-[max-content_max-content_1fr] sm:items-center sm:gap-x-3 sm:gap-y-1.5"
														>
															{#each byReason(b.blocked) as g, gi (g.reason ?? '')}
																{#if gi > 0}
																	<!-- The second cause gets its own one-line lead so the
																     two groups read as two. The bracket's subject line
																     above states the subject and the total once; this
																     says only what is different about these rows. -->
																	<li
																		class="mt-1.5 text-xs text-gray-500 sm:col-span-3 dark:text-gray-400"
																	>
																		{#if g.rows.length === 1}
																			1 more, held for a different reason
																		{:else}
																			{g.rows.length} more, held for a different reason
																		{/if}
																	</li>
																{/if}
																{#each g.rows as w, ri (w.key)}
																	{@const top = gi > 0 && ri === 0 ? 'mt-1.5' : ''}
																	<li
																		class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:contents"
																	>
																		<Chip
																			role="held"
																			label="held"
																			value={w.display}
																			valueTitle={w.tag}
																			wide
																			title="{name} is held on {w.tag} in {w.envs.join(', ')}"
																			class="shrink-0 {top}"
																		/>
																		<span
																			class="text-xs whitespace-nowrap text-gray-500 {top} dark:text-gray-400"
																		>
																			{#if w.requiredVersion}needs <span class="t-code-sm"
																					>{w.requiredVersion}</span
																				>{/if}
																		</span>
																		<!-- ⛔ NO `ml-auto` ON THE ENV CHIPS — tried it: at 1920 it
																     put the chips 460px from the build they belong to, the
																     same proximity inversion `StageChain`'s right-aligned
																     badge caused (DESIGN.md's reason the chain card is
																     capped at 360px). -->
																		<span class="flex min-w-0 flex-wrap items-center gap-1 {top}">
																			{#if hasChain && w.envs.length > 0}
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
																		</span>
																	</li>
																{/each}
																<li class="mt-0.5 sm:col-span-3">
																	<BlockReason
																		reason={contractBlockReason({
																			provider: b.providerName,
																			contract: b.contract,
																			requiredVersion: g.rows[0].requiredVersion,
																			providedVersion: b.providedVersion,
																			gateName: b.entries[0]?.dep?.status?.gateName ?? null,
																			reason: g.reason
																		})}
																	/>
																</li>
															{/each}
														</ul>
													</div>
												{/if}
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
									verdict={providedVerdict}
									verdictTone={heldRolloutCount > 0 ? 'held' : 'neutral'}
									verdictTitle={heldRolloutCount > 0
										? 'Rollouts with a build they cannot deploy until this rollout ships a newer contract'
										: 'Rollouts held on the contract version this rollout has deployed'}
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
														<!-- Same 40-char-SHA truncation as the provider chip
														     above; see its note. -->
														<Chip
															role="count"
															label={c.contract}
															value={shortenVersion(c.providedVersion)}
															wide
															title="This rollout has deployed {c.contract} {c.providedVersion}"
															valueTitle="The contract version every service below is gated on — {c.providedVersion}"
															class="shrink-0"
														/>
													{:else}
														<span class="t-code-sm text-gray-500 dark:text-gray-400"
															>{c.contract}</span
														>
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
														The rules have read different versions from this rollout.
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
																		title="Held on this in {d.places
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
																		>{:else if d.requiresVaries}, and its places ask different
																		things of {c.contract}{:else if unresolved}, and what it needs
																		of {c.contract} could not be read{/if}
																{:else if nowhere}
																	Has deployed nothing here yet
																{/if}
																{#if d.pastTags.length > 0}
																	<!-- Counted once, never drawn. These are held
															     builds the consumer is already PAST — the gate
															     working on candidates nobody will deploy. -->
																	· also holds {d.pastTags.length} older
																	{d.pastTags.length === 1 ? 'version' : 'versions'} nobody is trying
																	to deploy
																{/if}
															</p>

															<!-- THE ONLY ROW HERE THAT SPENDS COLOUR, SAME ORANGE AS
													     THE CONTRACT CARD ABOVE, NOT RED — see that card's own
													     note. Same mark, same sentence and same left rule: one
													     relation stated identically from both ends.
													
													     ⭐ 2026-09-18 · §3c's GROUPING, APPLIED HERE EXACTLY AS
													     WRITTEN THERE — the identical defect, on the identical
													     data, one card down. Measured on `payments-svc`, this card
													     used to render, for `checkout-api` alone, three copies of
													     the held chip + env chips + `BlockReason` block, differing
													     only in a version and a constraint. It becomes one orange
													     rule, one `{d.name} is held on N builds` line, N aligned
													     rows, one `BlockReason` built from `d.holds[0]`'s own
													     constraint — see §3c's comment for the full argument (why
													     newest-first, why `sm:contents` needs three children
													     always, why no `ml-auto` on the place chips). -->
															{#if d.holds.length > 0}
																<div
																	class="mt-2 border-l-2 border-orange-700/40 pl-3 dark:border-orange-400/40"
																>
																	<!-- Markup text, not a ternary of template literals, and one
																     sentence per distinct `reason` — see §3c's two notes for
																     both arguments; this card has the identical shape. -->
																	<p class="text-xs text-gray-500 dark:text-gray-400">
																		<span class="font-medium text-gray-700 dark:text-gray-300"
																			>{d.name}</span
																		>
																		{#if d.holds.length === 1}
																			is held on this build
																		{:else}
																			is held on {d.holds.length} builds
																		{/if}
																	</p>
																	<!-- One grid for the whole bracket, reason sentences as
																     full-width items inside it — see §3c's note for both
																     arguments and the spacing rule; this card has the
																     identical shape. -->
																	<ul
																		class="mt-1.5 flex flex-col gap-1.5 sm:grid sm:grid-cols-[max-content_max-content_1fr] sm:items-center sm:gap-x-3 sm:gap-y-1.5"
																	>
																		{#each byReason(d.holds) as g, gi (g.reason ?? '')}
																			{#if gi > 0}
																				<li
																					class="mt-1.5 text-xs text-gray-500 sm:col-span-3 dark:text-gray-400"
																				>
																					{#if g.rows.length === 1}
																						1 more, held for a different reason
																					{:else}
																						{g.rows.length} more, held for a different reason
																					{/if}
																				</li>
																			{/if}
																			{#each g.rows as h, ri (h.key)}
																				{@const top = gi > 0 && ri === 0 ? 'mt-1.5' : ''}
																				<li
																					class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:contents"
																				>
																					<Chip
																						role="held"
																						label="held"
																						value={h.display}
																						valueTitle={h.tag}
																						wide
																						title="{d.name} is held on {h.tag} until this rollout serves a newer {c.contract}"
																						class="shrink-0 {top}"
																					/>
																					<span
																						class="text-xs whitespace-nowrap text-gray-500 {top} dark:text-gray-400"
																					>
																						{#if h.requiredVersion}needs <span class="t-code-sm"
																								>{h.requiredVersion}</span
																							>{/if}
																					</span>
																					<!-- ⛔ NO `ml-auto` ON THE PLACE CHIPS — same proximity-
																			     inversion argument as §3c's identical note. -->
																					<span
																						class="flex min-w-0 flex-wrap items-center gap-1 {top}"
																					>
																						{#if d.places.length > 1}
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
																									<span
																										class="t-code-sm text-gray-500 dark:text-gray-400"
																										>{ns}</span
																									>
																								{/if}
																							{/each}
																						{/if}
																					</span>
																				</li>
																			{/each}
																			<li class="mt-0.5 sm:col-span-3">
																				<BlockReason
																					reason={contractBlockReason({
																						provider: name,
																						contract: c.contract,
																						requiredVersion: g.rows[0].requiredVersion,
																						providedVersion: c.providedVersion,
																						gateName: gateNameOf(d),
																						reason: g.reason
																					})}
																				/>
																			</li>
																		{/each}
																	</ul>
																</div>
															{/if}
														</li>
													{/each}
												</ul>
											</li>
										{/each}
									</ul>
								</Card>
							{/if}
						</div>
					{/if}

					{#if hasNetwork || hasChain}
						<!-- RAIL — the column that holds LOCATORS: where things are,
						     not what to do. Map first, then chain — the map is the
						     card the human called empty and the one the film needs in
						     the first screenful's top-right, balancing the banner's
						     weight; the chain is the compact, always-present locator
						     and reads naturally as the rail's floor. -->
						<div class="grid min-w-0 content-start gap-4">
							{#if hasNetwork}
								<!-- ── AXIS 4 · THE LOCAL NETWORK ──────────────────────────
						     Re-parented from a full-width band above this grid — see
						     the comment above the grid's opening tag. Renders only
						     when this rollout is actually in the network; a service
						     with no contracts gets no empty graph frame. -->
								<Card icon={ShareNodesSolid} title="In the network" class="min-w-0">
									{#snippet rollup()}
										<!--
									⭐ 2026-09-18 · THE SLOT LOSES ITS VERDICT, AND THE
									TL ASKED FOR THE ARGUMENT IN WRITING (§5e):

									1. `1 of 1 links not read` sat 40px under a banner
									   saying `4 builds held`, and a reader cannot
									   reconcile them — the rollup counts EDGES, everything
									   else on the page counts BUILDS and SERVICES.
									2. It is worse than incomparable, it is SMALLER. The
									   map is scoped to this rollout's own environment; the
									   lists are scoped to the whole app. On `checkout-api`
									   the map draws 1 of the 3 providers the card below
									   lists, because the other two gate the dev and
									   staging rollouts — a count in the map's rollup
									   asserts a total the page contradicts 400px away.
									3. `"not read"` is the ABSENCE of an observation. The
									   page's own standing rule is that an absent record is
									   not an observation; it is certainly not a card's
									   headline answer.
									4. The picture IS the rollup. Every other card rolls up
									   because you would otherwise have to read its rows;
									   you do not read a two-node drawing, you see it.
									5. The rail card is 352–470px wide. The verdict was
									   already `hidden … sm:inline` because it clipped the
									   title — a rollup that disappears at the width it is
									   most needed is not carrying the slot.

									The slot is not empty: `Whole network ›` fills it as a
									`.nav-link`, the reference page's own pattern for an
									action in a card header. `localVerdict` /
									`networkVerdict` stay in the view-model — `/dependencies`
									still uses them.
								-->
										<!-- ⛔ ONE ROLLUP SPEC ON ALL THREE CARDS ON THIS PAGE.
										     `Card`'s own verdict is `.t-card-rollup` — 12px/500 —
										     and this slot was rendering `.nav-link`, which is
										     14px/500. Two sibling cards at 12 and one at 14 is the
										     header reading as two sizes down one rail. Both marks
										     here take `.t-card-rollup`; the count takes the
										     neutral verdict ink `Card` itself uses, so the only
										     thing separating them is the link's blue. -->
										<span
											class="t-card-rollup shrink-0 whitespace-nowrap text-gray-500 dark:text-gray-400"
											title="Other services drawn in this map — this rollout's own environment and one hop of contract neighbours. The lists below span every environment of the app, so this is not a total."
											>{otherServicesDrawn}
											{otherServicesDrawn === 1 ? 'other service' : 'other services'}</span
										>
										<a
											href="/dependencies"
											class="t-card-rollup shrink-0 whitespace-nowrap text-blue-600 hover:underline dark:text-blue-400"
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
										<!-- `rollup`: the card-header spec (12px/500), not the
										     14px `/apps` row spec — see `UpToDate`'s own prop doc. -->
										<UpToDate
											rollup
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
	{/if}
</div>
