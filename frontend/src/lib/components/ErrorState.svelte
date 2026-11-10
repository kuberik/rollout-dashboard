<svelte:options runes={true} />

<script lang="ts">
	import { isApplePlatform } from '$lib/shortcut-hint';
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
	import FactList, { type Fact } from './FactList.svelte';
	import NotFound from './NotFound.svelte';
	import Card from './Card.svelte';
	import RolloutTabHeader from './RolloutTabHeader.svelte';
	import { page } from '$app/state';
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
		ArrowLeftOutline,
		SearchOutline,
		MapPinOutline,
		HomeOutline
	} from 'flowbite-svelte-icons';
	import { href } from '$lib/paths';

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
	/**
	 * ⭐ A MISSING OBJECT IS A `NotFound`, NOT A BANNER AT ALL. (2026-10-08,
	 * round 2, design review 4) `warning`/amber was the FIRST fix (the token
	 * is STUCK-only) but the coordinator's second pass went further: a
	 * missing object is not a blocking fact that needs a person — it needs
	 * nobody, same as `+error.svelte`'s 404. `AlertPanel` — even at `info` —
	 * is still the wrong OBJECT for it. `NotFound.svelte` is the shared calm
	 * composition; see its own doc comment. The `AlertPanel` branch below now
	 * only ever renders for a REAL failure, so its severity is always
	 * `'error'`/danger — which is correct, that one IS broken.
	 */
	const isMissing = $derived(apiError?.isMissing ?? false);
	/** Only a failure the policy will retry has a self-healing story to tell. */
	const selfHealing = $derived(!isAuth && !isMissing && isRetryable(error));
	const facts = $derived(errorFacts(error));

	/**
	 * Opens the SAME palette instance the navbar mounts — byte-identical to
	 * `NotFound.svelte`'s own `openSearch`, which this lane also owns (§5).
	 */
	let isMac = $state(false);
	$effect(() => {
		isMac = isApplePlatform(navigator.platform);
	});

	function openSearch() {
		document.querySelector<HTMLElement>('[aria-label^="Search ("]')?.click();
	}

	/**
	 * ⭐ LANE P, §5 ROUND 2 (squad-rollout coordinator, 2026-10-09): "a polled
	 * error on a rollout must still open with the rollout's name." `ErrorState`
	 * is a generic, ~20-caller component with no `rollout`/`name` prop of its
	 * own — threading one through every caller (Overview is the only rollout
	 * page this lane may touch; History/Gates/Logs belong to other lanes) would
	 * either miss callers or force an edit this lane cannot make. Reading
	 * `page.params` instead (same object `Navbar.svelte` already reads for its
	 * own breadcrumb) makes this work on EVERY rollout tab with zero call-site
	 * changes, and is naturally `undefined` on the ~15 non-rollout callers
	 * (`/rollouts`, `/activity`, `/changes`, …), where nothing below renders.
	 */
	const rolloutName = $derived(page.params.name as string | undefined);
	const rolloutNamespace = $derived(page.params.namespace as string | undefined);
	const rolloutCluster = $derived(page.params.cluster as string | undefined);
	const onRolloutPage = $derived(!!rolloutName && !!rolloutNamespace);

	/**
	 * ⭐ ROUND 3, ITEM 10 (AD, 2026-10-09), CORRECTED (squad-rollout
	 * coordinator, 2026-10-10): "Title 'could not answer', chip 'Rechecking
	 * every 30s' and body 'didn't answer; retrying every 30s.' are one fact
	 * three times." The FIRST fix overrode the title to a local "Server
	 * didn't answer" — which broke `outage-states.svelte.test.ts` and
	 * `errors.test.ts` on `/`, `/rollouts`, `/apps`, `/activity`,
	 * `/environments`, `/changes`: `errorHeadline()` is the one shared
	 * headline per failure class (outage vs rejected vs auth …) and every
	 * one of those surfaces asserts its exact wording. The title stays
	 * `errorHeadline(error, subject)`, UNCHANGED, on every branch now — the
	 * de-duplication happens entirely in the BODY: the self-healing case's
	 * body is empty (`AlertPanel` renders nothing for a falsy `message`),
	 * since the chip already carries the cadence and the title already
	 * carries what broke; title + chip + `Try again` say everything that
	 * case has to say without the body repeating any of it a second time.
	 */
	const bannerMessage = $derived.by(() => {
		if (isAuth) return errorConsequence(error);
		if (selfHealing) return '';
		return 'The dashboard server rejected this request; trying again will not change the answer.';
	});

	/**
	 * ⭐ ROUND 2, ITEM 8: THE "Requested" FACTS CARD, SAME AS `NotFound`'s.
	 * Only the facts this component can actually know without a new prop:
	 * the rollout address from the URL and the server's own evidence
	 * (`errorFacts`, the same record the `Details` disclosure already prints —
	 * printing it twice, once visible and once disclosed, would be the
	 * "two different not-the-same-object" defect the `isMissing` branch above
	 * already fixed once). No "last success" field exists on this component
	 * (no caller passes one) — omitted rather than invented.
	 */
	const requestedFacts = $derived<Fact[]>([
		...(onRolloutPage
			? [{ label: 'Rollout', value: `${rolloutNamespace}/${rolloutName}`, handle: true }]
			: []),
		...(rolloutCluster ? [{ label: 'Cluster', value: rolloutCluster, handle: true }] : []),
		...facts
	]);
</script>

{#if isMissing}
	<div class={className}>
		<NotFound
			title="Not found"
			headline={errorHeadline(error, subject)}
			nextStep={errorConsequence(error)}
			{facts}
			backHref={backHref}
			{backLabel}
		/>
	</div>
{:else}
	<!-- ⭐ ROUND 2, ITEM 7 + ROUND 3 FIX (squad-rollout coordinator,
	     2026-10-10): `errorConsequence(error)` is still printed verbatim.
	     The record (`errorFacts`) is back in THIS disclosure, unconditionally
	     — `outage-states.svelte.test.ts` asserts a collapsed `<details>`
	     holding the address/status on EVERY page (`/`, `/rollouts`, `/apps`,
	     `/activity`, `/environments`, `/changes`), which round 2's "move it
	     to the visible card instead" broke on all of them (that visible card
	     render is gated to `onRolloutPage` now — see below — so it never
	     existed for these callers in the first place). On a rollout page the
	     SAME facts are also visible, unboxed, in "Requested" — the small
	     overlap this file's own round-2 comment already named as acceptable,
	     same shape `NotFound`'s `isMissing` branch keeps. -->
	{#snippet detail()}
		<p class="t-meta text-fg-muted">{errorConsequence(error)}</p>
		<FactList {facts} tone="banner" />
	{/snippet}

	<!--
		⭐ LANE P, §5 (2026-10-09, ROUND 2): THE SAME FAMILY AS `NotFound`, NOT A
		LONE BANNER ON AN EMPTY PAGE. "a failed request renders as an empty page
		with one red banner floating in it" was the live complaint — every
		OTHER state this product draws for "the content is not here"
		(`NotFound`, the rollout tabs' own skeletons) is main + rail; this
		was the one exception. `lg:grid-cols-[3fr_minmax(22rem,2fr)]
		lg:items-start` is `NotFound`'s own split, byte-identical, so a
		reader who sees one and then the other reads the same product.
		MAIN is the `AlertPanel` (now a ONE-SENTENCE banner, item 7) plus a
		"Requested" facts card (item 8) — the fix is additive, built only from
		props every call site already passes plus `$app/state`'s `page.params`
		(no new prop, so no caller across the ~20 pages that render this needs
		to change). RAIL mirrors `NotFound`'s own "Where to look" Card verbatim
		(Search + the way out), because a dead request and a dead address are
		the same kind of nothing to a reader standing on this page right now.
	-->
	<!-- ⭐ ROUND 3, ITEM 10 (AD): "the title sits at x252/y129, against the
	     Overview's x256/y137 — the page shifts 4px on a tab switch." The
	     default `className` (`px-4 py-8 sm:px-5`, this component's own
	     prop) is for the ~19 OTHER callers, each inside their own page
	     container; on a rollout tab this file now KNOWS its container
	     (`onRolloutPage`, round 2) and uses the Overview's own
	     `mx-auto w-full px-4 pt-6 pb-10 sm:px-6` byte-for-byte instead of
	     whatever `class` that call site passed, so the grid starts at the
	     exact x/y every other rollout-tab state does. -->
	<div class={onRolloutPage ? 'mx-auto w-full px-4 pt-6 pb-10 sm:px-6' : className}>
		{#if onRolloutPage}
			<!-- ⭐ ROUND 2, ITEM 6: THE TITLE SITS WHERE IT ALWAYS DOES. No
			     `rollout` prop — there is no data, by definition, on this
			     branch — so `RolloutTabHeader` prints the bare name with no
			     build and no state pill, same as its own "loading" moment on
			     every OTHER tab (see its doc comment: "the name comes from
			     the URL and renders at once; the build and pill fill in place"). -->
			<RolloutTabHeader name={rolloutName ?? ''} class="mb-4" />
		{/if}
		<div class="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_minmax(22rem,2fr)] lg:items-start">
		<div class="flex flex-col gap-4">
		<AlertPanel
			severity="error"
			title={errorHeadline(error, subject)}
			message={bannerMessage}
			footnoteBody={detail}
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
				<!-- `selfHealing` requires `!apiError?.isMissing`, so `severity` is
				     always `'error'` whenever this chip can render — the `info`
				     (missing-object) case never reaches here (not retryable: see
				     `selfHealing`'s own derivation). -->
				<span
					aria-live="polite"
					class="t-meta inline-flex items-center gap-1.5 rounded-xs bg-danger-tint px-1.5 py-0.5 text-danger tabular-nums"
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
			     latter.

			     ⭐ `Try again` IS, NOW. (round 2, 2026-10-08, design review 4)
			     This is a REAL failure (`isMissing` has its own, calm
			     `NotFound` branch above and never reaches here) and `Try
			     again` is the one and only action a dead page can offer — the
			     page's one primary, same as any other screen whose one
			     action changes what the reader is looking at from "broken"
			     to "working". -->
			{#if isAuth && apiError?.status === 401}
				<button type="button" class="btn btn-secondary" onclick={reauthenticate}>
					<ArrowRightToBracketOutline class="h-4 w-4 shrink-0" aria-hidden="true" />
					Sign in again
				</button>
			{:else if onRetry}
				<button
					type="button"
					class="btn btn-primary"
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
			<!-- ⭐ ROUND 3, ITEM 10 (AD): "'Back to all rollouts' appears in the
			     alert AND the rail." The rail (below) always renders — it is
			     not conditional on anything this snippet can see — so the
			     way out lived twice for no reason. One copy now, in the
			     rail, matching `NotFound`'s own layout exactly: the banner's
			     only action is the one that DOES something. -->
		{/snippet}
		</AlertPanel>
		<!-- ⭐ ROUND 2, ITEM 8, SCOPED TO ROLLOUT PAGES (fixed round 3,
		     2026-10-10): "Requested" IN MAIN, SAME CARD `NotFound` USES —
		     the facts VISIBLE, not collapsed behind `Details` (that
		     disclosure still holds the server's own evidence unconditionally
		     — see `detail` above — so this card's `...facts` spread is a
		     deliberate small overlap, same shape `NotFound`'s own `isMissing`
		     branch accepts). `onRolloutPage`-gated: the ~19 generic callers
		     (`/`, `/activity`, `/changes`, …) never had this card before
		     round 2 and `outage-states.svelte.test.ts` pins their shape —
		     only a rollout tab, where `requestedFacts` actually names
		     something the banner does not (the rollout address), gets it. -->
		{#if onRolloutPage}
			<!-- PALROW r7 (AD r6): the same header icon NotFound's "Requested"
			     uses (SearchOutline), so the two outage pages read as one family. -->
			<Card icon={SearchOutline} title="Requested">
				<FactList facts={requestedFacts} tone="card" />
			</Card>
		{/if}
		</div>
		<Card icon={MapPinOutline} title="Where to look">
			<!-- ⭐ ROUND 3, ITEM 10 (AD): "its rail has 2 rows where NotFound's
			     has 3 (no Home)." Third row added, same icon and position
			     `NotFound.svelte`'s own rail uses — suppressed only when
			     `backHref` already IS Home, same guard that component's own
			     `showHome` follows.
			     ⭐ ROUND 6 (AD review 4, 2026-10-10): "the back link gets the
			     leading arrow icon and loses the trailing chevron — NotFound
			     did this in 7f3a92d, mirror it." Every other row leads with
			     its icon (Search, Home below); a trailing chevron here was
			     the one row 24px out of that column, same defect NotFound's
			     own rail had and already fixed. -->
			<div class="flex flex-col items-start gap-3">
				<button type="button" class="nav-link" onclick={openSearch}>
					<SearchOutline aria-hidden="true" />
					Search
					<!-- PALROW r7 (AD r6): NotFound's own shortcut hint, same markup
					     and the same `sm` gate (no keyboard to name on a phone). -->
					<kbd
						class="t-code-sm hidden shrink-0 rounded-xs border border-line-strong bg-subtle px-1 py-0.5 sm:inline-flex"
						>{isMac ? '⌘K' : 'Ctrl K'}</kbd
					>
				</button>
				<a href={backHref} class="nav-link">
					<ArrowLeftOutline aria-hidden="true" />
					{backLabel}
				</a>
				{#if backHref !== href('/')}
					<a href={href('/')} class="nav-link">
						<HomeOutline aria-hidden="true" />
						Home
					</a>
				{/if}
			</div>
		</Card>
		</div>
	</div>
{/if}
