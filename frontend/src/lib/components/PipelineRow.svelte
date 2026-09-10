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
	import { ChevronDownOutline } from 'flowbite-svelte-icons';
	import Chip from './Chip.svelte';
	import FactList, { type Fact } from './FactList.svelte';
	import SkeletonBar from './skeleton/SkeletonBar.svelte';
	import { rolloutQueryOptions } from '$lib/api/rollouts';
	import { fetchScheduleObjects, type ScheduleObject, formatAbsoluteReopen, formatTimeUntil } from '$lib/api/schedules';
	import { rolloutPath } from '$lib/source-dashboard';
	import { buildGateContext, classifyGate, withSchedules, prettyNameOf } from '$lib/view-models/blocking-story';
	import type { PrCell, PrState } from '$lib/view-models/pr-pipeline';
	import { cellStateSentence, cellReasonText, usuallyLabel, sinceLabel, frontierUsuallyLabel } from '$lib/pr-cell-copy';
	import type { Environment, RolloutDependency } from '../../types';

	let {
		cell,
		appName,
		localClusterName,
		multiCluster,
		environments,
		rolloutDependencies,
		now = new Date(),
		isFrontier = false
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
	} = $props();

	/** HELD names a build that exists somewhere but cannot land in THIS cell
	 *  yet — the same three precedence-3/4 states `pr-pipeline.ts` groups
	 *  together (a candidate revision resolved, something is keeping it out).
	 *  ⛔ `promoting` is deliberately EXCLUDED (item 6, 2026-09-10 fix pass):
	 *  nothing is holding that cell, so a HELD chip beside "promoting
	 *  shortly" would be the exact contradiction the design doc's finding
	 *  named. */
	const HELD_STATES: ReadonlySet<PrState> = new Set(['gated', 'waiting-upstream', 'pinned']);

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
</script>

<li class="pc-row tap-zone flex min-h-11 flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2">
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

	<span class="t-body flex flex-wrap items-center gap-1.5 text-gray-900 dark:text-white">
		{sentence}
		{#if HELD_STATES.has(cell.state)}
			<Chip
				role="held"
				label="held"
				title={`${cell.envName.toUpperCase()} cannot take ${cell.releaseLabel || 'this build'} yet`}
			/>
		{:else if cell.state === 'rolled-back'}
			<Chip role="unranked" label="rolled back" />
		{/if}
	</span>

	{#if cell.releaseLabel}
		<span class="t-micro shrink-0 font-mono text-gray-500 dark:text-gray-400"
			>{cell.releaseLabel}{#if shortRevision}
				<span class="text-gray-400 dark:text-gray-500">{shortRevision}</span>
			{/if}</span
		>
	{/if}

	{#if cell.gatePending}
		<!-- ⭐ ITEM 3 (2026-09-10 fix pass): the schedule/owner join has not
		     landed, so `pr-pipeline.ts` printed no reason at all rather than
		     a possibly-wrong finished sentence ("A check is not passing" for
		     what may really be a closed schedule) — a SkeletonBar stands in
		     for it, sized to roughly the eventual clause's width, until the
		     "why" disclosure below resolves it. -->
		<SkeletonBar width="w-40" class="basis-full sm:basis-auto" />
	{:else if reason}
		<span class="t-micro basis-full text-gray-500 sm:basis-auto dark:text-gray-400">{reason}</span>
	{/if}

	{#if (cell.state === 'deploying' || cell.state === 'baking') && cell.usuallyMs != null}
		<!-- ⭐ ITEM 5 (2026-09-10 fix pass): "usually" only where a clock
		     answers something — a live row, a pinned row, an indefinitely
		     held row all used to print a bare "—" here, which is not an
		     estimate of anything. `deploying`/`baking` are the two states
		     with an actual timer running (`bakeLeftMs`); everywhere else
		     this slot renders nothing rather than a dash. -->
		<span
			class="t-micro ml-auto shrink-0 text-gray-400 dark:text-gray-500"
			title={`Median of ${appName}'s own recorded bake times in ${cell.envName.toUpperCase()}`}
			>{usuallyLabel(cell.usuallyMs)}</span
		>
	{:else if isFrontier && cell.usuallyMs != null}
		<!-- ⭐ CHANGES-2026-09-10 §7, ITEM 1 — the FRONTIER cell's own estimate
		     for a cell that has not started yet (held, not-built, promoting…):
		     "with a time estimation", answered where the question is actually
		     asked. Every other non-active, non-frontier cell stays silent —
		     this branch is mutually exclusive with the one above by
		     construction (that one already claims every `deploying`/`baking`
		     cell), so a cell never shows two estimates. -->
		<span
			class="t-micro ml-auto shrink-0 text-gray-400 dark:text-gray-500"
			title={`Median of ${appName}'s own recorded bake times in ${cell.envName.toUpperCase()}, once a deploy starts`}
			>{frontierUsuallyLabel(cell.usuallyMs)}</span
		>
	{/if}

	{#if frontierOpensLabel}
		<!-- ⭐ CHANGES-2026-09-10 §7, ITEM 2 — "when can I expect it", promoted
		     to the row for the held frontier cell. The "Why is it held?"
		     disclosure below still prints the SAME fact in its absolute form
		     (`When: opens 09:00 …`); this is the relative countdown a reader
		     can act on without opening anything. -->
		<span class="t-micro shrink-0 text-gray-500 dark:text-gray-400">{frontierOpensLabel}</span>
	{/if}

	{#if since}
		<time class="t-micro shrink-0 text-gray-400 dark:text-gray-500">{since}</time>
	{/if}

	{#if cell.gateHint}
		<!-- ⭐ ITEM 3 (2026-09-10 fix pass): "why?" was a bare, unlabelled
		     ~16px hit target — a real disclosure control now, ≥44px tall
		     (`min-h-11`), a chevron that flips on open, and a label that
		     names what it is a control FOR ("Why is it held?"), not an
		     interrogative fragment. -->
		<details class="group basis-full sm:basis-auto" bind:open={whyOpen}>
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
