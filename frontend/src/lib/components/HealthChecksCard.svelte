<svelte:options runes={true} />

<script lang="ts">
	import Chip from './Chip.svelte';
	import { HeartOutline } from 'flowbite-svelte-icons';
	import { untrack } from 'svelte';
	import type { HealthCheck } from '../../types';
	import StatusSpinner from './StatusSpinner.svelte';
	import Card from './Card.svelte';
	import UnavailableCard from './UnavailableCard.svelte';
	import { CheckCircleSolid, ExclamationCircleSolid, ClockSolid, ClockArrowOutline } from 'flowbite-svelte-icons';
	import FailureSourceRow from './FailureSourceRow.svelte';
	import RecoveredStrip from './RecoveredStrip.svelte';
	import { checkView, clock, type CheckVerdict, type SnapCheck } from '$lib/view-models/health-failures';
	import { formatAgoCompact, formatTimeAgoCompact } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import {
		recoveredLabel,
		readsHealthy,
		recoveredTitle,
		pendingRowText,
		HEALTH_CHECKS_UNAVAILABLE
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
		emptyState = false,
		loadError = false,
		onRetry = null,
		isRetrying = false,
		failedChecks: snapshot = [],
		bakeStart = null
	}: {
		healthChecks: HealthCheck[];
		windowStart?: Date | null;
		/** Draw a one-line "no health checks" card instead of nothing (Overview). */
		emptyState?: boolean;
		/** The load failed: the list is UNKNOWN, never "no checks". Wins over `healthChecks`. */
		loadError?: boolean;
		onRetry?: (() => void) | null;
		isRetrying?: boolean;
		/** history[0].failedHealthChecks: the snapshot whose observations a recovered check draws (the figure that failed, never the live healthy value) */
		failedChecks?: SnapCheck[];
		/** history[0].bakeStartTime: the recovered strip's axis starts here (falls back to `windowStart`) */
		bakeStart?: string | null;
	} = $props();
	const classifyCheck = (hc: HealthCheck, w: Date | null): CheckVerdict => checkView(hc, w, snapshot).verdict;
	type CheckState = CheckVerdict;
	let showAll = $state<Set<string>>(new Set());
	const SOURCE_FOLD = 3;
	const axisStart = $derived(bakeStart ? new Date(bakeStart) : windowStart);

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
	const rollupText = $derived(
		[
			failedChecks.length > 0 ? `${failedChecks.length} failing` : '',
			pendingChecks.length > 0 ? `${pendingChecks.length} pending` : '',
			recovered.length > 0 ? `${recovered.length} recovered` : '',
			healthyChecks.length > 0 ? (failedChecks.length + pendingChecks.length + recovered.length === 0 ? `${healthChecks.length}/${healthChecks.length} healthy` : `${healthyChecks.length} passing`) : ''
		]
			.filter(Boolean)
			.join(' \u00b7 ')
	);
	function errorAgo(hc: HealthCheck): string {
		return hc.status?.lastErrorTime ? formatAgoCompact(hc.status.lastErrorTime, $now) : 'earlier';
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
			: pendingChecks.length > 0
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
		recovered: 'border-success-line text-success',
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
	{#if word === 'pending'}
		<Chip role="checking" label="pending" wide class="shrink-0" {title} />
	{:else}
		<span class="chip t-label chip-wide shrink-0 {CHECK_TONE[word]}" {title}>{word}</span>
	{/if}
{/snippet}

{#if loadError}
	<!-- UNKNOWN is not NONE: the same fact the change-version dialog states when
	     it cannot load the checks. Retry is the same control `PartialDataNotice` draws. -->
	<UnavailableCard
		icon={HeartOutline}
		title="Health checks"
		sentence={HEALTH_CHECKS_UNAVAILABLE.sentence}
		{onRetry}
		{isRetrying}
	/>
{:else if healthChecks.length > 0}
	<Card
		icon={HeaderIcon}
		iconClass={headerIconClass}
		title="Health checks"
		padded={false}
		dataTour="health-checks"
	>
		{#snippet rollup()}
			<!-- never print a zero count; the leading verdict sets the ink (recovered is not a yellow: green) -->
			<span class="t-ui-sm {failedChecks.length > 0 ? 'text-danger' : pendingChecks.length > 0 ? 'text-progress' : 'text-success'}"
				>{rollupText}</span
			>
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
				{@const v = checkView(hc, windowStart, snapshot)}
				{@const state = v.verdict}
				{@const failing = state === 'failing'}
				{@const pending = state === 'pending'}
				{@const recoveredRow = state === 'recovered'}
				{@const passingRow = state === 'passing'}
				{@const hasRows = v.rows.length > 0}
				{@const expanded = expandedMessages.has(key)}
				<div data-testid="hc-row" class="border-line-subtle border-b px-4 py-3 last:border-b-0">
				<div class="flex items-start gap-3">
					{#if failing}
						<ExclamationCircleSolid class="text-danger mt-0.5 h-4 w-4 flex-shrink-0" />
					{:else if pending}
						<StatusSpinner size="4" color="yellow" class="mt-0.5" />
					{:else if recoveredRow}
						<ClockArrowOutline class="text-success mt-0.5 h-4 w-4 flex-shrink-0" />
					{:else}
						<CheckCircleSolid class="text-success mt-0.5 h-4 w-4 flex-shrink-0" />
					{/if}
					<div class="min-w-0 flex-1">
						<span title={displayName(hc)} class="t-body block min-w-0 truncate {failing ? 'text-fg' : 'text-fg-muted'}">
							{displayName(hc)}
						</span>
						<!--
							EVERY STATE DRAWS THE NAME AND ONE FACT LINE (2026-11-12, owner rule: nothing moves as state changes).
							The fact line is a single truncated line in every state; evidence (observation rows, the provider's
							message) hangs under it, spanning the row. A failing row with observations states its time once
							(`failing · 6m`); without observations it keeps `— {message}`.
						-->
						{#if failing}
							{#if hasRows || !v.message}
								<span data-testid="hc-sub" class="t-meta text-fg-muted block truncate"><span class="text-danger">failing</span>{#if v.since}{' · '}<span class="whitespace-nowrap tabular-nums">{formatTimeAgoCompact(v.since, $now)}</span>{/if}</span>
							{:else}
								<button
									type="button"
									data-testid="hc-sub"
									aria-expanded={expanded}
									title={expanded ? undefined : v.message}
									onclick={() => toggleMessage(key)}
									class="t-meta text-fg-muted hover:text-fg block w-full min-w-0 text-left {expanded ? 'whitespace-normal' : 'truncate'}"
									><span class="text-danger">failing</span>{#if v.since}{' · '}<span class="whitespace-nowrap tabular-nums">{formatTimeAgoCompact(v.since, $now)}</span>{/if} — {v.message}</button
								>
							{/if}
						{:else if pending}
							{#if v.since}
								<!-- a pending check says how long it has waited; what it is waiting on is the evidence under it -->
								<p data-testid="hc-sub" class="t-meta text-fg-muted block truncate"><span class="text-progress">waiting</span>{' · '}<span class="whitespace-nowrap tabular-nums">{formatTimeAgoCompact(v.since, $now)}</span></p>
							{:else}
								{@const text = pendingRowText(hc, $now)}
								<p data-testid="hc-sub" class="t-meta text-fg-muted block truncate" title={text}>{text}</p>
							{/if}
						{:else if recoveredRow}
							{#if v.recovery?.okSince}
								<!-- the strip under it owns the OK moment; the fact says only that it recovered -->
								<p data-testid="hc-sub" class="t-meta text-fg-muted block truncate">recovered</p>
							{:else}
								{@const text = `${recoveredLabel(errorAgo(hc))}${hc.status?.message ? ` — ${hc.status.message}` : ''}`}
								<p data-testid="hc-sub" class="t-meta text-fg-muted block truncate" title={text}>{text}</p>
							{/if}
						{:else}
							<p data-testid="hc-sub" class="t-meta text-fg-muted block truncate">
								<span class="text-fg-subtle">passing</span>{#if hc.status?.lastChangeTime}{' · '}<span class="tabular-nums">{formatTimeAgoCompact(hc.status.lastChangeTime, $now)}</span>{/if}
							</p>
						{/if}
					</div>
					<!-- the chip budget: a failing row's red glyph + red fact is its one mark; passing draws none -->
					<div class="flex shrink-0 items-center gap-2">
						{#if failing}
							<!-- stated under the name -->
						{:else if passingRow}
							<!-- the age lives in the fact line -->
						{:else if pending}
							{@render stateChip(state, hc.status?.status || undefined)}
						{/if}
					</div>
				</div>
				<!-- the evidence spans the whole row (under the glyph + name, not squeezed beside the state chip) -->
				<div class="flex flex-col pl-7">
					{#if hasRows}
						{@const folded = !showAll.has(key) && v.rows.length > SOURCE_FOLD}
						<ul class="mt-2 flex flex-col gap-3">
							{#each folded ? v.rows.slice(0, SOURCE_FOLD) : v.rows as r (r.key)}<FailureSourceRow row={r} />{/each}
						</ul>
						{#if folded}
							<button type="button" class="btn btn-secondary btn-xs mt-2 self-start" onclick={() => (showAll = new Set(showAll).add(key))}>Show {v.rows.length - SOURCE_FOLD} more</button>
						{/if}
					{:else if pending && v.since && v.message && !readsHealthy(v.message)}
						<!-- a pending check with no observations: the provider's own error, in full on demand -->
						<button
							type="button"
							title={v.message}
							aria-expanded={expanded}
							onclick={() => toggleMessage(key)}
							class="t-meta text-fg-muted hover:text-fg mt-1 w-full break-words whitespace-normal text-left {expanded ? '' : 'line-clamp-3'}">{v.message}</button
						>
					{/if}
					{#if recoveredRow && v.recovery}
						<RecoveredStrip recovery={v.recovery} {axisStart} />
						{#if v.recovery.rows.length > 0}
							<ul class="mt-2 flex flex-col gap-3">
								{#each v.recovery.rows as r (r.key)}<FailureSourceRow row={r} />{/each}
							</ul>
						{/if}
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
		<p class="t-meta text-fg-subtle px-4 py-3">
			No health checks select this rollout, so a deploy counts as done when its steps finish.
		</p>
	</Card>
{/if}
