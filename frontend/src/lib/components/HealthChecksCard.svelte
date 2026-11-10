<svelte:options runes={true} />

<script lang="ts">
	import { HeartOutline } from 'flowbite-svelte-icons';
	import { untrack } from 'svelte';
	import type { HealthCheck } from '../../types';
	import StatusSpinner from './StatusSpinner.svelte';
	import Card from './Card.svelte';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		ClockArrowOutline
	} from 'flowbite-svelte-icons';
	import { formatTimeAgo } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import {
		classifyCheck,
		recoveredLabel,
		recoveredTitle,
		pendingProbeClause,
		type CheckState
	} from '$lib/view-models/health-witness';

	/**
	 * ⭐ `windowStart` IS THE FIX FOR "4/4 healthy AND NOTHING ELSE".
	 *
	 * A critic recovered a failing check to `Healthy` leaving `lastErrorTime` in
	 * place — the witness semantics this system deliberately relies on, which
	 * rollout and stepgate read to catch transient failures they would otherwise
	 * miss. The API returned `{"status":"Healthy","lastErrorTime":"…01:39:09Z",
	 * "message":"p99 latency back within SLO"}` while the other three checks had
	 * no `lastErrorTime` at all. This card rendered **`Health Checks — 4/4
	 * healthy`** and stopped, because with no failing and no pending rows the
	 * body below never rendered: **no list, and no expander to open.** There was
	 * no affordance anywhere in the product to learn a check had been erroring
	 * ninety seconds earlier, so the operator concluded the alert that paged
	 * them was noise.
	 *
	 * `null` (the default) means the caller has no deploy to anchor the window
	 * to, and every check then reads as plain `passing` — the pre-2026-08-31
	 * behaviour, and the honest one: an error with no attempt to be evidence
	 * about is not a witness. See `view-models/health-witness.ts` for why the
	 * window is `max(deployedAt, lastRetryAt)` and not a fixed age.
	 */
	let {
		healthChecks,
		windowStart = null,
		emptyState = false
	}: {
		healthChecks: HealthCheck[];
		windowStart?: Date | null;
		/** Draw a one-line "no health checks" card instead of nothing (Overview). */
		emptyState?: boolean;
	} = $props();

	let expandedMessages = $state<Set<string>>(new Set());

	function toggleMessage(key: string) {
		const next = new Set(expandedMessages);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		expandedMessages = next;
	}

	// ⛔ FOUR STATES NOW, AND THE FOUR SETS ARE DISJOINT. `recovered` used to sit
	// inside `healthyChecks`, which is exactly why it was invisible: counted as
	// part of `4/4 healthy`, then drawn as one more green chip in a row that
	// only renders when something else is already wrong.
	const failedChecks = $derived(
		healthChecks.filter((hc) => classifyCheck(hc, windowStart) === 'failing')
	);
	const pendingChecks = $derived(
		healthChecks.filter((hc) => classifyCheck(hc, windowStart) === 'pending')
	);
	const recovered = $derived(
		healthChecks.filter((hc) => classifyCheck(hc, windowStart) === 'recovered')
	);
	const healthyChecks = $derived(
		healthChecks.filter((hc) => classifyCheck(hc, windowStart) === 'passing')
	);
	function errorAgo(hc: HealthCheck): string {
		return hc.status?.lastErrorTime ? formatTimeAgo(hc.status.lastErrorTime, $now) : 'earlier';
	}

	/**
	 * ⭐ ROW POSITION IS DECIDED ONCE, NEVER RE-DERIVED FROM CURRENT STATE.
	 * (2026-09-21, film critic finding: a pending check's row lived in the
	 * `pendingChecks` `{#each}` block, near the top; the instant it passed it
	 * reclassified into `healthyChecks`, a SEPARATE `{#each}` block at the
	 * bottom — Svelte has no idea those are "the same row", so it unmounted
	 * one element and mounted another, and on screen the row jumped to the
	 * bottom and swapped places with whatever had been below it, in the same
	 * frame the badge turned green.)
	 *
	 * `order` is the render sequence — a list of stable keys, computed once
	 * per NEW key (see the `$effect` below), never re-sorted after. A key's
	 * classification (`classifyCheck`, computed fresh per render from live
	 * data) still decides everything about how the row LOOKS — icon, tint,
	 * badge, message — just not WHERE it sits. "Pending sorts first" survives
	 * only as the rule for a key's INITIAL position, exactly as asked: once
	 * placed, a row holds its slot through every future status change.
	 */
	function checkKey(hc: HealthCheck): string {
		return `${hc.metadata?.name ?? ''}/${hc.metadata?.namespace ?? ''}`;
	}

	function priorityOf(state: CheckState): number {
		return state === 'failing' ? 0 : state === 'pending' ? 1 : state === 'recovered' ? 2 : 3;
	}

	function initialOrder(list: HealthCheck[], window: Date | null): string[] {
		return list
			.map((hc, i) => ({ key: checkKey(hc), i, p: priorityOf(classifyCheck(hc, window)) }))
			.sort((a, b) => a.p - b.p || a.i - b.i)
			.map((x) => x.key);
	}

	// Computed once, at component creation, from whatever `healthChecks` the
	// card first mounted with — NOT inside `$effect`/`$derived`, which would
	// re-run (and, without care, re-sort) on every later prop update. A plain
	// top-level statement in a Svelte component's `<script>` runs exactly
	// once per instance, which is exactly "decided when the card mounts".
	// `untrack` says so explicitly — without it, Svelte's compiler (correctly
	// suspicious of a `$state` initializer that reads a `$props()` value)
	// warns `state_referenced_locally`, assuming the more common bug of
	// meaning `$derived` here. This one really does mean "read once".
	let order = $state<string[]>(untrack(() => initialOrder(healthChecks, windowStart)));

	// The only thing allowed to grow `order` after mount: a check the card has
	// never seen before (a new HealthCheck object appearing on a later poll).
	// It is appended, sorted only among ITSELF and any other newcomers in the
	// same batch — every key already in `order` keeps its slot untouched.
	$effect(() => {
		const seen = new Set(order);
		const newcomers = healthChecks
			.filter((hc) => !seen.has(checkKey(hc)))
			.map((hc) => ({ key: checkKey(hc), p: priorityOf(classifyCheck(hc, windowStart)) }))
			.sort((a, b) => a.p - b.p)
			.map((x) => x.key);
		if (newcomers.length > 0) {
			order = [...order, ...newcomers];
		}
	});

	const byKey = $derived(new Map(healthChecks.map((hc) => [checkKey(hc), hc])));

	/**
	 * ⭐ THIS CARD NOW USES `Card`, NOT A HAND-ROLLED HEADER. (defect #4,
	 * design re-check) `COMPOSITION-GRAMMAR.md`'s own numbers: every header
	 * on the reference page measures 47px because `Card` floors it there;
	 * this component's own `px-4 py-3` bar with no `min-h` measured 45px —
	 * two numbers for what is meant to be one idiom. `Card`'s `icon` prop
	 * takes the same conditional glyph this header always chose; the rollup
	 * is a snippet because the four states here (failing/pending/recovered/
	 * healthy) need four different inks that `Card`'s four `VerdictTone`
	 * values don't all cover (no `warning` tone exists — amber is reserved
	 * for `stuck`, see `Card.svelte`'s own note on why) — this rollup is the
	 * one legitimate case for `warning` yellow at header scale, unchanged
	 * from before the migration.
	 */
	const HeaderIcon = $derived(
		failedChecks.length > 0
			? ExclamationCircleSolid
			: pendingChecks.length > 0
				? ClockSolid
				: recovered.length > 0
					? ClockArrowOutline
					: CheckCircleSolid
	);
	const headerIconClass = $derived(
		failedChecks.length > 0
			? 'text-danger'
			: pendingChecks.length > 0 || recovered.length > 0
				? 'text-progress'
				: 'text-success'
	);

	/**
	 * ⛔ TWO STATUS GRAMMARS IN ONE CARD. (2026-09-13, demo capture, lane 4.)
	 * Measured on `/rollouts/dev/default/hello-world` at 1920: the pending row
	 * carried a FILLED `rounded-full bg-yellow-100` pill reading `Pending`
	 * while the two rows directly under it carried BARE GREEN TEXT reading
	 * `passing` — a filled capsule and an unboxed word, 40px apart, in one
	 * rail card, for the same axis. A reader cannot tell whether the shape
	 * difference means something (it did not) and the failing row had a THIRD
	 * spelling again (a filled red capsule printing the raw CRD enum,
	 * `Failed`/`Unknown`, not the card's own word).
	 *
	 * REFERENCE REGION, 600px to the LEFT IN THE SAME VIEWPORT:
	 * `DeploymentPipelineCard`'s step rows. Every one of them is the chip atom
	 * — `.chip t-chip chip-wide`, a neutral `gray-200`/`gray-700` hairline,
	 * nothing filled, and ONLY the ink changing per state (that component's
	 * own `pillClasses`, whose note records why: *"a state word in a box is
	 * what `.chip` is for … only ink changes per state; the border stays
	 * neutral and nothing fills — the alarm chip is the only fill in the
	 * product"*). These four values are that map's `failed` / `paused` /
	 * `done` rows, unchanged.
	 *
	 * ⚠️ NOT `<Chip role="failing">`. `Chip`'s status roles all carry a WASH
	 * (`ADVERSE` is `bg-red-50`, `CHECKING` is `bg-yellow-50`) and these rows
	 * already sit on a full-width `bg-red-50` / `bg-yellow-50` band — a wash
	 * chip on its own wash disappears. The pipeline card hit the same wall and
	 * answered it the same way, with the atom rather than the role.
	 *
	 * ⚠️ AND THE WORD IS THE CARD'S OWN, NOT THE CRD's. The rollup above says
	 * `1 pending · 2 passing`; the rows now say `PENDING` and `PASSING`. The
	 * raw `status.status` moves to the row's `title`, where a reader who wants
	 * the controller's own enum can still get it.
	 */
	const CHECK_TONE = {
		failing: 'border-danger-line text-danger',
		pending: 'border-progress-line text-progress',
		recovered: 'border-progress-line text-progress',
		passing: 'border-success-line text-success'
	} as const;

	function displayName(hc: HealthCheck): string {
		return (
			hc.metadata?.annotations?.['kuberik.com/display-name'] || hc.metadata?.name || 'health check'
		);
	}
</script>

<!--
	THE ONE STATUS MARK, rendered identically on all four kinds of row. It is a
	snippet and not four hand-spelled spans so the geometry cannot drift back
	apart the way the capsule and the bare word already did once.
-->
{#snippet stateChip(word: keyof typeof CHECK_TONE, title: string | undefined)}
	<span
		class="chip t-label chip-wide shrink-0 {CHECK_TONE[word]}"
		{title}>{word}</span
	>
{/snippet}

{#if healthChecks.length > 0}
	<Card
		icon={HeaderIcon}
		iconClass={headerIconClass}
		title="Health checks"
		padded={false}
		dataTour="health-checks"
	>
		{#snippet rollup()}
			{#if failedChecks.length > 0}
				<span class="t-ui-sm text-danger"
					>{failedChecks.length} failing{pendingChecks.length > 0
						? ` · ${pendingChecks.length} pending`
						: ''}{recovered.length > 0 ? ` · ${recovered.length} recovered` : ''} · {healthyChecks.length}
					passing</span
				>
			{:else if pendingChecks.length > 0}
				<span class="t-ui-sm text-progress"
					>{pendingChecks.length} pending{recovered.length > 0
						? ` · ${recovered.length} recovered`
						: ''} · {healthyChecks.length} passing</span
				>
			{:else if recovered.length > 0}
				<!-- ⛔ THE ROLLUP THAT READ `4/4 healthy` DURING AN INCIDENT.
				     COMPOSITION-GRAMMAR §1: this line is the card's whole answer for a
				     reader who does not open it, and it answered wrong. The counts are
				     DISJOINT and sum to the total, so `3 passing · 1 recovered` over
				     four checks still adds up; `4/4 · 1 recovered` would have been the
				     same all-clear with a footnote. -->
				<span class="t-ui-sm text-progress"
					>{healthyChecks.length} passing · {recovered.length} recovered</span
				>
			{:else}
				<span class="t-ui-sm text-success"
					>{healthChecks.length}/{healthChecks.length} healthy</span
				>
			{/if}
		{/snippet}
		<!--
			⭐ ONE ROW, ONE POSITION, FOUR LOOKS. (2026-09-21, film critic finding
			2.) This used to be four separate `{#each}` blocks, one per
			classification, so a check changing classification (pending →
			passing) moved from one block to another and visibly swapped places
			with its neighbour in the same frame its badge turned green. Now
			there is exactly one `{#each}`, over `order` (decided once at mount —
			see that `$state`'s own note above), and the classification
			(`classifyCheck`, current data, every render) only ever changes how
			THIS row looks, never where it sits. The row's own element persists
			across a status change (same key, same position in `order`).

			⛔ S-10 — NO COLOUR TWEEN ON A STATE CHANGE. (2026-10-08.) This used
			to carry `transition-colors duration-300` on the row background and
			on `stateChip`'s ink, so the WORD (instant, text content has no
			tween) and the TONE (gliding over 300ms) disagreed for the length
			of the glide — frame 3 of the retry showcase reads `PASSING` in
			amber ink on an amber row. A state change is a FACT, not a
			gradient: the word, the chip's tone and the row's tint now flip in
			the same frame, every time. (Hover/focus affordances elsewhere in
			the product keep their own transitions — this rule is specifically
			about a STATE value, not about interaction feedback.)
		-->
		{#each order as key (key)}
			{@const hc = byKey.get(key)}
			{#if hc}
				{@const state = classifyCheck(hc, windowStart)}
				{@const failing = state === 'failing'}
				{@const pending = state === 'pending'}
				{@const recoveredRow = state === 'recovered'}
				{@const passingRow = state === 'passing'}
				<div
					data-testid="hc-row"
					class="flex items-start gap-3 border-b border-line-subtle px-4 py-3 last:border-b-0 {failing
						? ''
						: pending || recoveredRow
							? ''
							: ''}"
				>
					{#if failing}
						<ExclamationCircleSolid
							class="mt-0.5 h-4 w-4 flex-shrink-0 text-danger"
						/>
					{:else if pending}
						<StatusSpinner size="4" color="yellow" class="mt-0.5" />
					{:else if recoveredRow}
						<ClockArrowOutline
							class="mt-0.5 h-4 w-4 flex-shrink-0 text-progress"
						/>
					{:else}
						<CheckCircleSolid class="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
					{/if}
					<div class="min-w-0 flex-1">
						<span
							class="block min-w-0"
							class:t-card-title={failing}
							class:text-fg={failing}
							class:t-body={!failing}
							class:text-fg-muted={!failing}
							class:truncate={passingRow}
						>
							{displayName(hc)}
						</span>
						{#if failing}
							<!-- The state and its age sit under the name (AD round 3 nit):
							     a right-hand column squeezed the description to 4 lines. -->
							<span class="t-meta block text-danger"
								>failing{#if hc.status?.lastChangeTime}{' · '}{formatTimeAgo(hc.status.lastChangeTime, $now)}{/if}</span
							>
						{/if}
						{#if failing && hc.status?.message}
							{@const expanded = expandedMessages.has(key)}
							<p
								class="t-body mt-0.5 leading-relaxed text-fg-muted"
								class:line-clamp-3={!expanded}
							>
								{hc.status.message}
							</p>
							{#if hc.status.message.length > 200}
								<button
									onclick={() => toggleMessage(key)}
									class="t-ui-sm mt-1 text-fg-subtle hover:text-fg"
								>
									{expanded ? 'Show less' : 'Show more'}
								</button>
							{/if}
						{:else if pending}
							<!--
								⭐ A REAL COUNTDOWN, NOT A BAKED STRING. (2026-09-21, film critic
								finding 1.) `pendingProbeClause` derives the remaining seconds
								from the check's own `nextProbeAt` against `$now` — a store that
								ticks every 100ms — so this line recomputes, and the number
								actually falls, every render. A check with no `nextProbeAt` (a
								real backend, or a mock check nobody wired up) falls back to
								whatever `status.message` already says, unchanged from before.
							-->
							{@const clause = pendingProbeClause(hc, $now)}
							{@const text = hc.status?.message
								? clause
									? `${hc.status.message} · ${clause}`
									: hc.status.message
								: clause}
							{#if text}
								<p class="t-body mt-0.5 leading-relaxed text-fg-muted">
									{text}
								</p>
							{/if}
						{:else if recoveredRow}
							<!--
								⭐ THE ROW THAT DID NOT EXIST. A check that is passing NOW but
								errored inside this deploy's window reads as RECOVERED, not
								clean.

								⚠️ THE STATE COMES FIRST — *"passing, last errored 2m ago"*. The
								check really is passing and a reader who takes only the first
								word must not be misled into paging someone; a reader who stops
								at the second clause has still learned the thing their alert was
								about.
							-->
							<p class="t-body mt-0.5 leading-relaxed text-fg-muted">
								<!-- ⚠️ THE SEPARATOR IS INSIDE THE EXPRESSION. Written as literal
									     text around the `{#if}`, Svelte trims the leading space and it
									     rendered `3 minutes ago— p99 latency…`, which reads as a
									     hyphenated word rather than a clause break. -->
								{recoveredLabel(errorAgo(hc))}{#if hc.status?.message}{` — ${hc.status.message}`}{/if}
							</p>
						{/if}
					</div>
					<!-- THE RIGHT GROUP, IN THE SAME PLACE ON EVERY KIND OF ROW.
					     ⭐ THE CHIP BUDGET, ROUND 2 (2026-10-08, coordinator
					     review): "one fact, once" — a row spends at most two
					     emphases, the NAME and ONE status mark. The glyph on
					     the left already IS that mark for passing (green) AND
					     now for failing (red) rows, so both draw no chip: a
					     passing row shows only the quiet time, a failing row
					     shows the word plus the time in the SAME red ink as
					     the glyph and the banner above it (red glyph + red
					     "failing · 2m" IS the one mark, not two). Pending and
					     recovered keep their chip — their glyph alone does not
					     carry PENDING vs RECOVERED (no single glyph does). -->
					<div class="flex shrink-0 items-center gap-2">
						{#if failing}
							<!-- stated under the name -->
						{:else if passingRow}
							{#if hc.status?.lastChangeTime}
								<span class="t-meta text-fg-subtle tabular-nums"
									>{formatTimeAgo(hc.status.lastChangeTime, $now)}</span
								>
							{/if}
						{:else}
							{@render stateChip(
								state,
								recoveredRow ? recoveredTitle(hc, errorAgo(hc)) : hc.status?.status || undefined
							)}
						{/if}
					</div>
				</div>
			{/if}
		{/each}
	</Card>
{:else if emptyState}
	<!-- An honest empty state instead of nothing (AD round 4: the deploying
	     Overview's rail was a lone card over empty space). -->
	<Card icon={HeartOutline} title="Health checks" verdict="none" padded={false}>
		<p class="t-meta px-4 py-3 text-fg-subtle">
			No health checks select this rollout, so a deploy counts as done when its steps finish.
		</p>
	</Card>
{/if}
