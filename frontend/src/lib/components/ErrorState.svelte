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
	 * 3. **The server's own sentence**, verbatim, demoted to evidence in the
	 *    `footnote` slot — the same shape `BlockReason` uses for a generated
	 *    gate name: the consequence leads, the handle follows.
	 * 4. **A way back**, always. `Try again` for something transient, `Sign in
	 *    again` (a FULL page navigation — see `reauthenticate`) for an expired
	 *    session, and a link out of the dead page for everything else.
	 *
	 * It is an `AlertPanel`, which is the product's existing filled banner and
	 * `COMPOSITION-GRAMMAR.md` §4's answer for a blocking fact. Zero new colour
	 * values, `.btn` at 14px for the verbs.
	 */
	import AlertPanel from './AlertPanel.svelte';
	import {
		ApiError,
		errorHeadline,
		errorConsequence,
		errorDetail,
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
		class: className = 'px-4 py-8 sm:px-5'
	}: {
		error: unknown;
		subject?: string;
		backHref?: string;
		backLabel?: string;
		onRetry?: (() => void) | null;
		class?: string;
	} = $props();

	const apiError = $derived(error instanceof ApiError ? error : null);
	const isAuth = $derived(apiError?.isAuth ?? false);
	// A missing object is not an alarm — nothing is broken, the address is just
	// wrong. `error` red is reserved for something that IS broken.
	const severity = $derived<'error' | 'warning'>(apiError?.isMissing ? 'warning' : 'error');
</script>

<div class={className}>
	<AlertPanel
		{severity}
		title={errorHeadline(error, subject)}
		message={errorConsequence(error)}
		footnote={errorDetail(error)}
		class=""
	>
		{#snippet actions()}
			{#if isAuth && apiError?.status === 401}
				<button type="button" class="btn btn-primary" onclick={reauthenticate}>
					<ArrowRightToBracketOutline class="h-4 w-4 shrink-0" aria-hidden="true" />
					Sign in again
				</button>
			{:else if onRetry}
				<button type="button" class="btn btn-secondary" onclick={() => onRetry?.()}>
					<RefreshOutline class="h-4 w-4 shrink-0" aria-hidden="true" />
					Try again
				</button>
			{/if}
			<a href={backHref} class="btn btn-secondary">
				{backLabel}
				<ChevronRightOutline class="h-4 w-4 shrink-0" aria-hidden="true" />
			</a>
		{/snippet}
	</AlertPanel>
</div>
