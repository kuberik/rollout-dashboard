<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ THE PRODUCT'S ONE FAILED-REQUEST STATE. Do not build a second one.
	 *
	 * The charge from a live UX critique: *"a failed request renders as
	 * 'loading' forever, and the server's own explanation is thrown away."*
	 * `/rollouts/prod/hello-world-prod/does-not-exist` showed five skeleton
	 * blocks indefinitely — no 404, no message, no way back — while the API
	 * answered 500 with a sentence naming the missing object.
	 *
	 * Four things every failure has to carry, and this is the object that
	 * guarantees all four:
	 *
	 * 1. **A headline a novice understands** — `Your session has expired`,
	 *    `This rollout does not exist`. Never a status code as the title.
	 * 2. **What happens next**, so the state is not a dead end.
	 * 3. **The server's own sentence**, verbatim, demoted to evidence behind
	 *    the disclosure — the same shape `BlockReason` uses for a generated
	 *    gate name: the consequence leads, the handle follows.
	 *
	 *    ⭐ AND IT IS A RECORD NOW, NOT A SENTENCE. (2026-09-02) `errorDetail`
	 *    returned `/api/rollouts — the server sent no explanation with its HTTP
	 *    503.`, which is an ADDRESS, a STATUS CODE and WHAT THE SERVER SAID
	 *    joined with an em dash — three machine facts wearing one sentence's
	 *    grammar, with the address (the part an engineer pastes into a
	 *    terminal) carrying punctuation that is not part of it. `errorFacts`
	 *    returns them as fields and `FactList` aligns them. Nothing was cut:
	 *    a failure with no explanation still states that it had none.
	 * 4. **A way back**, always. `Try again` for something transient, `Sign in
	 *    again` (a FULL page navigation — see `reauthenticate`) for an expired
	 *    session, and a link out of the dead page for everything else.
	 *
	 * It is an `AlertPanel`, which is the product's existing filled banner and
	 * `COMPOSITION-GRAMMAR.md` §4's answer for a blocking fact. Zero new colour
	 * values, `.btn` at 14px for the verbs.
	 */
	import AlertPanel from './AlertPanel.svelte';
	import FactList from './FactList.svelte';
	import {
		ApiError,
		errorHeadline,
		errorConsequence,
		errorFacts,
		isRetryable,
		RECOVERY_POLL_MS,
		reauthenticate
	} from '$lib/api/errors';
	import {
		RefreshOutline,
		ArrowRightToBracketOutline,
		ChevronRightOutline
	} from 'flowbite-svelte-icons';

	let {
		error,
		/** Names the thing that failed to load, e.g. `this rollout`. */
		subject = 'this page',
		/** Where "back" goes when there is nothing to retry. */
		backHref = '/',
		backLabel = 'Back to all rollouts',
		onRetry = null,
		/**
		 * ⭐ THE ONE QUESTION THE CRITIC COULD NOT REACH: *"if the API comes back
		 * while the tab is open, does the page heal itself, or does the operator
		 * have to know to reload?"* It heals — `pollWhenHealthy` keeps a 30s
		 * recovery poll running on a retryable failure — but a promise the
		 * reader cannot see is a promise they will not believe. Pass the query's
		 * `isFetching` and the banner SHOWS the attempt happening.
		 */
		isRetrying = false,
		class: className = 'px-4 py-8 sm:px-5'
	}: {
		error: unknown;
		subject?: string;
		backHref?: string;
		backLabel?: string;
		onRetry?: (() => void) | null;
		isRetrying?: boolean;
		class?: string;
	} = $props();

	const apiError = $derived(error instanceof ApiError ? error : null);
	const isAuth = $derived(apiError?.isAuth ?? false);
	// A missing object is not an alarm — nothing is broken, the address is just
	// wrong. `error` red is reserved for something that IS broken.
	const severity = $derived<'error' | 'warning'>(apiError?.isMissing ? 'warning' : 'error');
	/** Only a failure the policy will retry has a self-healing story to tell. */
	const selfHealing = $derived(!isAuth && !apiError?.isMissing && isRetryable(error));
	const facts = $derived(errorFacts(error));
</script>

<!-- ⭐ THE EVIDENCE, AS FIELDS. `Details` — not a count: there is exactly one
     request here and `1 request` would be a count of a thing there can only
     ever be one of, which teaches a reader nothing. `lib/disclosure.ts` states
     the rule; this is the ONE-RECORD case. -->
{#snippet detail()}
	<FactList {facts} tone="banner" />
{/snippet}

<div class={className}>
	<AlertPanel
		{severity}
		title={errorHeadline(error, subject)}
		message={errorConsequence(error)}
		footnoteBody={facts.length > 0 ? detail : undefined}
		class=""
	>
		{#snippet extra()}
			{#if selfHealing}
				<!--
					THE LIVE PROOF OF THE SENTENCE UNDERNEATH. `errorConsequence`
					promises the page checks every 30s; this chip is that promise
					observable. `aria-live="polite"` because a screen-reader user
					otherwise learns nothing between "it failed" and the page
					silently repainting with data.
				-->
				<span
					aria-live="polite"
					class="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums
						{severity === 'error'
						? 'bg-red-200/70 text-red-900 dark:bg-red-500/20 dark:text-red-200'
						: 'bg-amber-200/70 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200'}"
				>
					<RefreshOutline
						class="h-3 w-3 shrink-0 {isRetrying ? 'animate-spin' : ''}"
						aria-hidden="true"
					/>
					{isRetrying ? 'Checking now…' : `Rechecking every ${RECOVERY_POLL_MS / 1000}s`}
				</span>
			{/if}
		{/snippet}
		{#snippet actions()}
			<!-- ⛔ `Sign in again` IS NOT `.btn-primary`. (2026-09-02) It calls
			     `window.location.reload()` — it changes what you are LOOKING at,
			     not what is RUNNING, and the filled blue mark is reserved for the
			     latter. It is still a `.btn` because it is not navigation either:
			     it is the same class of control as `Try again` beside it, and the
			     two now read as siblings, which they are. -->
			{#if isAuth && apiError?.status === 401}
				<button type="button" class="btn btn-secondary" onclick={reauthenticate}>
					<ArrowRightToBracketOutline class="h-4 w-4 shrink-0" aria-hidden="true" />
					Sign in again
				</button>
			{:else if onRetry}
				<button
					type="button"
					class="btn btn-secondary"
					onclick={() => onRetry?.()}
					disabled={isRetrying}
				>
					<RefreshOutline
						class="h-4 w-4 shrink-0 {isRetrying ? 'animate-spin' : ''}"
						aria-hidden="true"
					/>
					{isRetrying ? 'Checking…' : 'Try again'}
				</button>
			{/if}
			<!-- ⭐ THE WAY OUT IS A LINK, AND THAT IS THE HIERARCHY, NOT A
			     DEMOTION. (2026-09-02) `Try again` re-issues the request; this
			     one only goes somewhere. When both are on screen the reader can
			     now tell them apart without reading either — the thing that DOES
			     something is boxed, the thing that goes somewhere is not.
			     `.nav-link` inherits the severity's ink from `AlertPanel`. -->
			<a href={backHref} class="nav-link">
				{backLabel}
				<ChevronRightOutline aria-hidden="true" />
			</a>
		{/snippet}
	</AlertPanel>
</div>
