<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ONE `cluster/env` ROW inside `PipelineCard`. Split out from the card so
	 * the "why?" disclosure's `$state` (whether THIS row is open, which
	 * gates its lazy fetch) belongs to the row that owns it — Svelte 5 runes
	 * only run at a component's own top level, so a per-row toggle inside a
	 * `{#each}` needs a per-row component, not a snippet with local state.
	 *
	 * See `PipelineCard.svelte`'s own doc comment for the row grammar and
	 * the disclosure's fetch-once contract.
	 */
	import { createQuery } from '@tanstack/svelte-query';
	import { ChevronDownOutline, ClockOutline, ClockSolid, MinusOutline } from 'flowbite-svelte-icons';
	import Chip from './Chip.svelte';
	import BakeStatusIcon from './BakeStatusIcon.svelte';
	import { getStatusCircleClass } from '$lib/bake-status';
	import FactList, { type Fact } from './FactList.svelte';
	import SkeletonBar from './skeleton/SkeletonBar.svelte';
	import { rolloutQueryOptions } from '$lib/api/rollouts';
	import { fetchScheduleObjects, type ScheduleObject, formatAbsoluteReopen, formatTimeUntil } from '$lib/api/schedules';
	import { rolloutPath } from '$lib/source-dashboard';
	import { buildGateContext, classifyGate, withSchedules, prettyNameOf } from '$lib/view-models/blocking-story';
	import type { PrCell, PrState } from '$lib/view-models/pr-pipeline';
	import {
		cellStateSentence,
		cellReasonText,
		usuallyLabel,
		sinceLabel,
		frontierUsuallyLabelForCell
	} from '$lib/pr-cell-copy';
	import type { Environment, RolloutDependency } from '../../types';

	let {
		cell,
		appName,
		localClusterName,
		multiCluster,
		environments,
		rolloutDependencies,
		now = new Date(),
		isFrontier = false,
		connectorAbove = false,
		connectorBelow = false
	}: {
		cell: PrCell;
		appName: string;
		localClusterName: string;
		multiCluster: boolean;
		environments: Environment[];
		rolloutDependencies: { items?: RolloutDependency[] } | null;
		now?: Date;
		/** ⭐ CHANGES-2026-09-10 §7 — the next environment this change has not
		 *  reached yet (`PipelineCard`'s own `frontierKey`). Gates the ONE
		 *  eager gate/schedule fetch item 2 asks for, and the frontier-only
		 *  "usually N min once it starts" estimate item 1 asks for. Every
		 *  other row stays exactly as lazy as it already was. */
		isFrontier?: boolean;
		/**
		 * ⭐ ROUND 2, R2.3 — `PipelineCard`'s own stage/production split.
		 * `true` when a SIBLING stage row sits immediately above/below this
		 * one in the promotion LINE (dev → staging); always `false` for a
		 * production-set row and for the first/last stage row, so the
		 * connector never implies an order between rows that do not have
		 * one. Mirrors `DeploymentPipelineCard`'s own `navRow(node,
		 * showLineAbove, showLineBelow)` — reused pattern, re-implemented
		 * here because this is a per-cell list row, not that component's
		 * two-pane rollout object.
		 */
		connectorAbove?: boolean;
		connectorBelow?: boolean;
	} = $props();

	/**
	 * ⭐ ROUND 2, R2.3 — THE 28px DISC. `getStatusCircleClass` + `BakeStatusIcon`
	 * are the product's own list-row status atom (`Home`'s "In motion" card,
	 * the rollout detail page, `ControlCenter` everywhere) — this table is
	 * the one place a `PrState` (a change's OWN state relative to a cell,
	 * `pr-pipeline.ts`'s own vocabulary) resolves to that atom's `bakeStatus`
	 * input, so the disc never invents a THIRD status vocabulary next to
	 * `PrState` and `BakeStatus`.
	 *
	 * `discState` reuses `getStatusCircleClass`/`BakeStatusIcon`'s own
	 * `'rolled-back' | 'pinned' | 'held'` override — `pinned` keeps ITS glyph
	 * (green `LockSolid`, unchanged hue: "pinned is UNCHANGED (green)",
	 * `bake-status.ts`) while `gated`/`waiting-upstream` share the orange
	 * `held` field + `PauseSolid`, matching every other held disc in the
	 * product.
	 *
	 * ⛔ `queued`/`promoting` DO NOT ROUTE THROUGH `BakeStatusIcon` AT ALL —
	 * caught live (`0afab6f35627`'s `hello-api-app`, STAGING/PROD rows).
	 * `BakeStatusIcon`'s `'None'` case draws `PauseSolid` (its "never
	 * deployed" glyph), which put the SAME pause mark this table already
	 * reserves for `held` on a cell that is merely waiting its normal turn —
	 * exactly the ambiguity R2.5(b) already fixed once for the landing
	 * grid's own marks ("a normal promotion-order wait is not stuck; amber
	 * is reserved for stuck"). `not-built` gets its own neutral kind too, for
	 * the identical reason and reusing `LandingMark`'s own choice of glyph
	 * (`MinusOutline`) rather than `BakeStatusIcon`'s pause.
	 */
	type DiscSpec =
		| { kind: 'bake'; bakeStatus: string; discState: 'rolled-back' | 'pinned' | 'held' | null }
		| { kind: 'waiting' }
		| { kind: 'not-built' };
	const CELL_DISC: Record<PrState, DiscSpec> = {
		live: { kind: 'bake', bakeStatus: 'Succeeded', discState: null },
		deploying: { kind: 'bake', bakeStatus: 'Deploying', discState: null },
		baking: { kind: 'bake', bakeStatus: 'InProgress', discState: null },
		retrying: { kind: 'bake', bakeStatus: 'InProgress', discState: null },
		failed: { kind: 'bake', bakeStatus: 'Failed', discState: null },
		cancelled: { kind: 'bake', bakeStatus: 'Cancelled', discState: null },
		'rolled-back': { kind: 'bake', bakeStatus: 'Succeeded', discState: 'rolled-back' },
		pinned: { kind: 'bake', bakeStatus: 'Succeeded', discState: 'pinned' },
		gated: { kind: 'bake', bakeStatus: 'Succeeded', discState: 'held' },
		'waiting-upstream': { kind: 'bake', bakeStatus: 'Succeeded', discState: 'held' },
		queued: { kind: 'waiting' },
		promoting: { kind: 'waiting' },
		'not-built': { kind: 'not-built' }
	};
	const disc = $derived(CELL_DISC[cell.state]);

	/**
	 * ⭐ ROUND 2, R2.3 — THE STATE CHIP. `chip t-chip chip-wide shrink-0` +
	 * a `pillClasses`-shaped lookup — the SAME geometry/pattern
	 * `DeploymentPipelineCard`'s own `navRow` spends on its status pill,
	 * reimplemented here rather than imported (`PipelineRow` is a per-cell
	 * list row over a `PrState`, not that component's five-value
	 * `NodeStatus` over a two-pane rollout object — see `PipelineCard`'s own
	 * header comment). Source text stays LOWERCASE — `.t-chip` uppercases it
	 * in CSS (`app.css`), the same convention every `Chip` label already
	 * follows — so this table's words read as sentence fragments in tests
	 * and as `LIVE`/`HELD`/`BAKING`/… on screen.
	 *
	 * `gated`/`waiting-upstream`/`pinned` all print `held` — R2.3's own
	 * "the HELD chip is required, standing rule" — even though `pinned`'s
	 * DISC (above) keeps its own distinct green lock: the CHIP names the
	 * outcome ("this cell cannot take the build yet"), the disc names the
	 * MECHANISM, and the two are allowed to disagree because they answer
	 * different questions, same split `LandingMark`'s own `state`/`FIELD`
	 * pair already draws for the identical three states.
	 */
	const STATE_CHIP: Record<PrState, { label: string; class: string }> = {
		live: { label: 'live', class: 'border-gray-200 text-green-700 dark:border-gray-700 dark:text-green-400' },
		deploying: { label: 'deploying', class: 'border-gray-200 text-blue-700 dark:border-gray-700 dark:text-blue-400' },
		baking: { label: 'baking', class: 'border-gray-200 text-yellow-700 dark:border-gray-700 dark:text-yellow-400' },
		retrying: { label: 'retrying', class: 'border-gray-200 text-yellow-700 dark:border-gray-700 dark:text-yellow-400' },
		failed: { label: 'failed', class: 'border-gray-200 text-red-700 dark:border-gray-700 dark:text-red-400' },
		cancelled: { label: 'cancelled', class: 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400' },
		'rolled-back': { label: 'rolled back', class: 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400' },
		// HELD — orange, the same ink `Chip role="held"`/`LandingMark`'s own
		// `held` word already spend; the border stays the product's neutral
		// hairline (`pillClasses`' own rule: "the border stays neutral and
		// nothing fills — the alarm chip is the only fill in the product").
		gated: { label: 'held', class: 'border-orange-200 text-orange-950 dark:border-orange-900 dark:text-orange-300' },
		'waiting-upstream': { label: 'held', class: 'border-orange-200 text-orange-950 dark:border-orange-900 dark:text-orange-300' },
		pinned: { label: 'held', class: 'border-orange-200 text-orange-950 dark:border-orange-900 dark:text-orange-300' },
		queued: { label: 'queued', class: 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400' },
		promoting: { label: 'promoting', class: 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400' },
		'not-built': { label: 'not built', class: 'border-gray-200 text-gray-400 dark:border-gray-700 dark:text-gray-500' }
	};
	const stateChip = $derived(STATE_CHIP[cell.state]);

	const sentence = $derived(cellStateSentence(cell, now));
	const reason = $derived(cellReasonText(cell, now));
	/**
	 * ⛔ SUPPRESSED FOR `live` — caught live on `/pr/…/kuberik-testing/1`:
	 * `cellStateSentence` already prints "live since 43m ago" for this
	 * state, so the row's own trailing "time since" column was the SAME
	 * clock twice in one row ("live since 43m ago … 43m ago"). Every other
	 * state's sentence names no instant, so the column is the only place
	 * that fact appears — this is the one case it would restate the
	 * sentence, and CLAUDE.md's "one fact, drawn, is the end of its
	 * sentence" rule is the same one `cellReasonText` already applies.
	 */
	const since = $derived(cell.state === 'live' ? null : sinceLabel(cell, now));
	const href = $derived(rolloutPath(cell.cluster || localClusterName, cell.namespace, cell.rolloutName));

	/**
	 * ⭐ ITEM 7 (2026-09-10 fix pass). The release that carries the PR in
	 * THIS cell — label + short sha, mono — was computed by `pr-pipeline.ts`
	 * (`releaseLabel`/`revision`) but never rendered anywhere on the row.
	 * `''` exactly when nothing is built here (`cell.releaseLabel`), so
	 * "when not built, no release" falls out of the same field, no extra
	 * branch. It links to the SAME rollout `href` the row's own `.tap-zone`
	 * already opens — a second `.tap-link` to the identical destination
	 * would be the redundant tab stop `lib/CLAUDE.md` bans, so this is
	 * plain text inside the zone, not a second anchor.
	 */
	const shortRevision = $derived(cell.revision ? cell.revision.slice(0, 7) : null);

	let whyOpen = $state(false);

	/**
	 * ⭐ ITEM 3 (2026-09-10 fix pass). This row's own SkeletonBar-vs-"held by
	 * a rule" state (`cell.gatePending`) is resolved by exactly the two
	 * requests the design doc names: the single-rollout endpoint (owner
	 * evidence — `rolloutGates` — so `approval`/`unknown` stop being a
	 * guess) AND this rollout's own schedules (so a closed deploy window
	 * gets its pretty name, description and `nextTransition` instead of
	 * falling through to the honest-but-vague `check` classification). Both
	 * are gated on `whyOpen`, never fetched up front, and each settles once
	 * (`staleTime: Infinity`) — reopening the disclosure never re-fires them.
	 */
	const whyQuery = createQuery(() => ({
		...rolloutQueryOptions({
			namespace: cell.gateHint?.namespace ?? '',
			name: cell.gateHint?.rolloutName ?? '',
			cluster: cell.gateHint?.cluster || undefined
		}),
		enabled: !!cell.gateHint && (whyOpen || isFrontier),
		staleTime: Infinity,
		refetchInterval: false as const,
		refetchOnWindowFocus: false as const,
		refetchOnReconnect: false as const
	}));

	const schedulesQuery = createQuery(() => ({
		queryKey: [
			'pr-pipeline-schedules',
			cell.gateHint?.namespace ?? '',
			cell.gateHint?.rolloutName ?? '',
			cell.gateHint?.cluster ?? ''
		],
		queryFn: (): Promise<ScheduleObject[]> =>
			fetchScheduleObjects(
				cell.gateHint?.namespace ?? '',
				cell.gateHint?.rolloutName ?? '',
				cell.gateHint?.cluster || undefined
			),
		enabled: !!cell.gateHint && (whyOpen || isFrontier),
		staleTime: Infinity,
		refetchInterval: false as const,
		refetchOnWindowFocus: false as const,
		refetchOnReconnect: false as const
	}));

	const KIND_LABEL: Record<string, string> = {
		schedule: 'a deploy-window schedule',
		check: 'a check',
		promotion: 'a promotion order',
		dependency: 'a service dependency',
		approval: 'a manual approval',
		unknown: 'an unclassified rule'
	};

	const whyLoading = $derived(whyQuery.isLoading || schedulesQuery.isLoading);
	const whyErrored = $derived(whyQuery.isError || schedulesQuery.isError);
	const whyReady = $derived(whyQuery.data != null && schedulesQuery.data != null);

	/**
	 * ⭐ CHANGES-2026-09-10 §7, ITEM 2 — SHARED BY `gateFacts` (the
	 * disclosure's own record) AND `frontierOpensLabel` (the row-promoted
	 * countdown) so the classification runs once, not twice, per settle.
	 * Both requests must have SETTLED before this runs — `withSchedules` is
	 * only safe to call once (see its own doc comment on `schedulesLoaded`).
	 */
	const classifiedGate = $derived.by(() => {
		const hint = cell.gateHint;
		const data = whyQuery.data;
		const schedules = schedulesQuery.data;
		if (!hint || !data || !schedules) return null;
		const gate = data.rollout?.status?.gates?.find((g) => g.name === hint.gateName);
		if (!gate) return null;
		let ctx = buildGateContext({
			environments: { items: environments },
			rolloutDependencies,
			rolloutGates: data.rolloutGates ?? null
		});
		ctx = withSchedules(ctx, hint.namespace, schedules);
		return classifyGate(gate, hint.namespace, ctx);
	});

	/**
	 * The rule record the disclosure prints: its pretty name (never the raw
	 * Kubernetes gate id), its description when the object publishes one,
	 * and `status.nextTransition` as "opens <time>" — the literal "when can
	 * I expect it" the design doc asks for.
	 */
	const gateFacts = $derived.by<Fact[] | null>(() => {
		const hint = cell.gateHint;
		const data = whyQuery.data;
		const schedules = schedulesQuery.data;
		const classified = classifiedGate;
		if (!hint || !data || !schedules || !classified) return null;

		const gateObj = data.rolloutGates?.items?.find((g) => g.metadata?.name === hint.gateName) ?? null;
		const scheduleObj =
			schedules.find((s) => (s.status?.managedGates ?? []).includes(hint.gateName)) ?? null;
		const prettyName =
			prettyNameOf(scheduleObj?.metadata) || prettyNameOf(gateObj?.metadata) || classified.label;
		const description =
			scheduleObj?.metadata?.annotations?.['gate.kuberik.com/description'] ||
			gateObj?.metadata?.annotations?.['gate.kuberik.com/description'] ||
			null;

		const facts: Fact[] = [
			{ label: 'Kind', value: KIND_LABEL[classified.kind] ?? classified.kind },
			{ label: 'Rule', value: prettyName }
		];
		if (description) facts.push({ label: 'Description', value: description });
		if (classified.clearsAt) {
			facts.push({ label: 'When', value: `opens ${formatAbsoluteReopen(classified.clearsAt, classified.timezone)}` });
		}
		return facts;
	});

	/**
	 * ⭐ ITEM 2 (CHANGES-2026-09-10 §7). "when can I expect it" — a held
	 * FRONTIER cell promotes the rule's own next opening to the row itself,
	 * `opens in 1d 4h`, rather than requiring a click into "Why is it held?"
	 * first. Sourced from the SAME classification the disclosure computes
	 * (fetched eagerly for this one cell, per `isFrontier` above) — `null`
	 * off any non-frontier cell, a cell with no clock-kind gate, or once the
	 * window has already opened (`formatTimeUntil` itself returns `null`
	 * past the deadline — a countdown does not count backwards).
	 */
	const frontierOpensLabel = $derived.by<string | null>(() => {
		if (!isFrontier) return null;
		const clearsAt = classifiedGate?.clearsAt;
		if (!clearsAt) return null;
		const until = formatTimeUntil(clearsAt, now);
		return until ? `opens in ${until}` : null;
	});

	/**
	 * ⭐ CHANGES-2026-09-10 §7, ITEM 1 — THE GUARDED VARIANT, NOT THE RAW ONE.
	 * `frontierUsuallyLabelForCell` (not `frontierUsuallyLabel`) so a frontier
	 * cell with no existing build anywhere (`not-built`) or one already past
	 * "starting" (`retrying`/`failed`/`cancelled`/`rolled-back`/`deploying`/
	 * `baking`) never gets an "once it starts" estimate that makes no sense
	 * for it — only `gated`/`pinned`/`waiting-upstream`/`promoting` (a build
	 * exists, merely not deployed here yet) ever return a string. `null` off
	 * any non-frontier cell by construction.
	 */
	const frontierUsually = $derived(isFrontier ? frontierUsuallyLabelForCell(cell) : null);
</script>

<!--
	⭐ ROUND 2, R2.3 — THE STAGE-ROW GRAMMAR. `DeploymentPipelineCard`'s own
	`navRow`: a 28px status disc, a connector to the sibling stage row (never
	drawn into/within the production SET — `PipelineCard`'s own
	`connectorAbove`/`connectorBelow`), an env `Chip` (identity, untouched by
	state), the state SENTENCE, a state CHIP (word, incl. HELD), and a time.
	Everything the row already knew how to say (the muted reason, the
	frontier's own "usually …"/"opens in …" clock, the "Why is it held?"
	disclosure) survives as an indented SECOND line, `pl-10` — past the
	disc(28px) + gap — so it reads as elaboration under the sentence, never
	competing with the five-slot first line for width.
-->
<li class="relative">
	{#if connectorAbove}
		<div
			aria-hidden="true"
			class="absolute left-[29px] top-0 h-2 w-0.5 bg-gray-300 dark:bg-gray-600"
		></div>
	{/if}
	{#if connectorBelow}
		<div
			aria-hidden="true"
			class="absolute left-[29px] top-9 bottom-0 w-0.5 bg-gray-300 dark:bg-gray-600"
		></div>
	{/if}

	<div class="pc-row tap-zone flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2">
		<!-- THE DISC — 28px, `getStatusCircleClass` + `BakeStatusIcon`, the
		     product's own list-row status atom. `decorative`: the row's own
		     SENTENCE already carries this cell's state in words, more
		     precisely than `BakeStatusIcon`'s generic `bakeWord` sr-only
		     label could ("held" vs. this row's own "held by Business Hours
		     Only") — a second, vaguer announcement of the same fact is not
		     an accessibility improvement. `queued`/`promoting`/`not-built`
		     bypass that atom entirely — see `CELL_DISC`'s own doc comment. -->
		{#if disc.kind === 'bake'}
			<span
				class="relative isolate flex h-7 w-7 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
					disc.bakeStatus,
					disc.discState
				)}"
			>
				<BakeStatusIcon bakeStatus={disc.bakeStatus} state={disc.discState} size="small" decorative />
			</span>
		{:else if disc.kind === 'waiting'}
			<span
				class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700/60"
			>
				<ClockSolid class="h-4 w-4 text-gray-500 dark:text-gray-400" aria-hidden="true" />
			</span>
		{:else}
			<span
				class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700/60"
			>
				<MinusOutline class="h-4 w-4 text-gray-400 dark:text-gray-500" aria-hidden="true" />
			</span>
		{/if}

		<a
			{href}
			class="tap-link hit-32 flex shrink-0 items-center gap-1.5"
			aria-label={`Open the ${cell.envName.toUpperCase()} rollout for ${appName}`}
		>
			{#if multiCluster}
				<span class="t-micro text-gray-400 dark:text-gray-500"
					>{cell.cluster || localClusterName}/</span
				>
			{/if}
			<Chip
				role="env"
				theme={cell.theme}
				label={cell.envName}
				wide
				title={`${appName} in ${cell.envName.toUpperCase()}`}
			/>
		</a>

		<span class="t-body min-w-32 flex-1 truncate text-gray-900 dark:text-white">{sentence}</span>

		<span class="chip t-chip chip-wide shrink-0 {stateChip.class}">{stateChip.label}</span>

		{#if since}
			<time class="t-micro shrink-0 text-gray-400 dark:text-gray-500">{since}</time>
		{/if}
	</div>

	{#if cell.releaseLabel}
		<p class="pl-10 pr-4 pb-1.5 t-micro font-mono text-gray-500 dark:text-gray-400">
			{cell.releaseLabel}{#if shortRevision}
				<span class="text-gray-400 dark:text-gray-500">{shortRevision}</span>
			{/if}
		</p>
	{/if}

	{#if cell.gatePending}
		<!-- ⭐ ITEM 3 (2026-09-10 fix pass): the schedule/owner join has not
		     landed, so `pr-pipeline.ts` printed no reason at all rather than
		     a possibly-wrong finished sentence ("A check is not passing" for
		     what may really be a closed schedule) — a SkeletonBar stands in
		     for it, sized to roughly the eventual clause's width, until the
		     "why" disclosure below resolves it. -->
		<div class="pl-10 pr-4 pb-1.5">
			<SkeletonBar width="w-40" />
		</div>
	{:else if reason}
		<p class="pl-10 pr-4 pb-1.5 t-micro text-gray-500 dark:text-gray-400">{reason}</p>
	{/if}

	{#if (cell.state === 'deploying' || cell.state === 'baking') && cell.usuallyMs != null}
		<!-- ⭐ ITEM 5 (2026-09-10 fix pass): "usually" only where a clock
		     answers something — a live row, a pinned row, an indefinitely
		     held row all used to print a bare "—" here, which is not an
		     estimate of anything. `deploying`/`baking` are the two states
		     with an actual timer running (`bakeLeftMs`); everywhere else
		     this slot renders nothing rather than a dash. -->
		<p
			class="pl-10 pr-4 pb-1.5 t-micro text-gray-400 dark:text-gray-500"
			title={`Median of ${appName}'s own recorded bake times in ${cell.envName.toUpperCase()}`}
		>
			{usuallyLabel(cell.usuallyMs)}
		</p>
	{:else if frontierUsually}
		<!-- ⭐ CHANGES-2026-09-10 §7, ITEM 1 — the FRONTIER cell's own estimate
		     for a cell that has not started yet (held, not-built, promoting…):
		     "with a time estimation", answered where the question is actually
		     asked. Every other non-active, non-frontier cell stays silent —
		     this branch is mutually exclusive with the one above by
		     construction (that one already claims every `deploying`/`baking`
		     cell), so a cell never shows two estimates. `frontierUsually` is
		     already guarded to the states where a build exists but has not
		     landed here yet (`frontierUsuallyLabelForCell` — ruling 2,
		     "NOT-BUILT HAS NO ETA"), so a `not-built`/`failed`/`retrying`
		     frontier prints nothing here.
		     ⭐ ROUND 2, R2.3 — "the frontier row and only the frontier row
		     carries the 'usually …' / 'opens in …' second line", now with the
		     spec's own `ClockOutline` glyph. -->
		<p
			class="pl-10 pr-4 pb-1.5 t-micro flex items-center gap-1 text-gray-400 dark:text-gray-500"
			title={`Median of ${appName}'s own recorded bake times in ${cell.envName.toUpperCase()}, once a deploy starts`}
		>
			<ClockOutline class="h-3 w-3 shrink-0" aria-hidden="true" />{frontierUsually}
		</p>
	{/if}

	{#if frontierOpensLabel}
		<!-- ⭐ CHANGES-2026-09-10 §7, ITEM 2 — "when can I expect it", promoted
		     to the row for the held frontier cell. The "Why is it held?"
		     disclosure below still prints the SAME fact in its absolute form
		     (`When: opens 09:00 …`); this is the relative countdown a reader
		     can act on without opening anything. -->
		<p class="pl-10 pr-4 pb-1.5 t-micro flex items-center gap-1 text-gray-500 dark:text-gray-400">
			<ClockOutline class="h-3 w-3 shrink-0" aria-hidden="true" />{frontierOpensLabel}
		</p>
	{/if}

	{#if cell.gateHint}
		<!-- ⭐ ITEM 3 (2026-09-10 fix pass): "why?" was a bare, unlabelled
		     ~16px hit target — a real disclosure control now, ≥44px tall
		     (`min-h-11`), a chevron that flips on open, and a label that
		     names what it is a control FOR ("Why is it held?"), not an
		     interrogative fragment. -->
		<details class="group pl-10 pr-4 pb-1.5" bind:open={whyOpen}>
			<summary
				class="t-micro flex min-h-11 w-full cursor-pointer list-none items-center gap-1.5 rounded text-gray-500 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-current/40 focus-visible:outline-none dark:text-gray-400 dark:hover:text-white [&::-webkit-details-marker]:hidden"
			>
				Why is it held?
				<ChevronDownOutline
					class="h-3 w-3 shrink-0 transition-transform duration-150 group-open:rotate-180"
					aria-hidden="true"
				/>
			</summary>
			{#if whyLoading}
				<p class="t-micro mt-1 text-gray-400 dark:text-gray-500">Loading…</p>
			{:else if whyReady}
				{#if gateFacts}
					<FactList facts={gateFacts} class="mt-1" />
				{:else}
					<p class="t-micro mt-1 text-gray-400 dark:text-gray-500">This rule no longer applies.</p>
				{/if}
			{:else if whyErrored}
				<p class="t-micro mt-1 text-gray-400 dark:text-gray-500">Could not load this rule.</p>
			{/if}
		</details>
	{/if}
</li>
