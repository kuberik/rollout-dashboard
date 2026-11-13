<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ACTIVITY SENTENCE — the one activity/event row every page uses.
	 *
	 * ROLE: an identity-first sentence for "who did what, where, when" —
	 * a deploy, a promotion, a gate action. Built for `/activity`'s feed
	 * (craft study P5: "identity before reading" — our rows carried the same
	 * green dot for every healthy app and no actor at all) and SHARED with
	 * Home's rail once home-v2 lands, so the two surfaces can never drift
	 * into two different row grammars for the same fact.
	 *
	 * ANATOMY, one line at >= 720px of CONTAINER width (not viewport — this
	 * component is its own `container-type: inline-size` context, so it
	 * reads the width of whatever card/rail it sits in): 20px `Avatar` (with
	 * an 8px status dot just outside its corner, drawn HERE, not by `Avatar` itself —
	 * identity never wears a status hue) · actor name · verb (state ink,
	 * omitted for a plain success) · app name · the env as plain text ·
	 * `from` -> `to` · time flush right. Only a PERSON is a subject: an
	 * automatic row (controller, CI) draws its StatusMark (or the 6px resting
	 * dot) in the avatar slot and reads app · verb ("checkout-edge is
	 * deploying"). Below 720px, or when `compact`, it is two lines: line 1
	 * the sentence + time; line 2, indented under the text, env + from -> to.
	 */
	import { TONE, toneBg, toneInk } from '$lib/view-models/state-tone';
	import Avatar from './Avatar.svelte';
	import StatusMark from './StatusMark.svelte';
	import type { Actor } from '$lib/actor';
	import type { NodeState } from '$lib/view-models/promotion-lanes';
	import type { EnvironmentTheme } from '$lib/environment-theme';
	import { activityVerb, type ActivityKind } from '$lib/view-models/activity-verb';

	let {
		actor,
		kind = null,
		verb: verbOverride = null,
		tone: toneOverride = null,
		app = null,
		appHref = null,
		env,
		theme = null,
		from = null,
		to,
		toHref = null,
		time,
		href = undefined,
		compact = false,
		repeatActor = false,
		live = true
	}: {
		actor: Actor;
		/** What happened. The verb and its ink come from `activityVerb` — the one vocabulary. */
		kind?: ActivityKind | null;
		/** Escape hatch only: a verb `activityVerb` has no kind for. */
		verb?: string | null;
		/** Escape hatch only, with `verb`. */
		tone?: NodeState | null;
		/** Null where the page already names the app (`/apps/<name>`). */
		app?: string | null;
		appHref?: string | null;
		env: string | null;
		theme?: EnvironmentTheme | null;
		from?: string | null;
		to: string | null;
		/** The build page for `to` (the version is the door to the change). */
		toHref?: string | null;
		time: string;
		href?: string;
		compact?: boolean;
		/** No longer collapses anything (2026-10-10): a person's name is always
		 *  visible, and an automatic row has none. Kept so callers don't break. */
		repeatActor?: boolean;
		/** Is `kind`'s state the rollout's CURRENT state (its newest history
		 *  entry)? Only matters for `kind: 'failed'` — a resolved past failure
		 *  (an older failure, superseded by a newer entry — even a newer
		 *  failure) reads in neutral ink, never red (coordinator ruling
		 *  2026-10-10, the same predicate `ActivityRail`'s own day-header
		 *  `open` tally and `DeployBars`' `resolved` use). Default `true`: most
		 *  rows ARE the rollout's current state, and a caller that genuinely
		 *  cannot tell must derive it from its own data rather than silently
		 *  downgrading a live failure to neutral — never flip this to `false`
		 *  as a guess. */
		live?: boolean;
	} = $props();

	const fromKind = $derived(kind ? activityVerb(kind) : null);
	// Only a PERSON is a subject. An automatic actor (the controller, CI) is
	// never the sentence's subject: the app leads and the verb takes its
	// app-subject form (coordinator 2026-10-10, /activity AD r1: "kuberik" led a
	// third of the rows).
	const personRow = $derived(actor.kind === 'person');
	const verb = $derived(verbOverride ?? (personRow ? fromKind?.verb : fromKind?.appVerb) ?? '');
	const tone = $derived(toneOverride ?? fromKind?.tone ?? null);
	// A resolved failure is history, not alarm — see `live`'s own doc comment.
	// Only `failed` ever resolves: every other tone (deploying, checking,
	// held, stuck) is read live or not shown at all.
	const resolvedFailure = $derived(tone === 'failed' && !live);
	// the corner dot is the state's solid from the one state-tone table (drawn OVER Avatar, which never carries a status hue itself)
	const cornerClass = $derived(resolvedFailure ? TONE.notreached.bg : toneBg(tone));

	const verbInk = $derived(
		resolvedFailure ? 'text-fg-subtle' : tone ? toneInk(tone, 'text-fg-subtle') : 'text-fg-subtle'
	);

	const destination = $derived(href ?? appHref ?? undefined);
	/**
	 * A plain success spends no hue and no state word on screen ("kuberik
	 * deployed checkout-api"), but its OUTCOME must still reach a screen reader:
	 * the rows this replaced carried "deploy succeeded" on their status mark.
	 * Visually hidden, never a `title` tooltip.
	 */
	const SUCCEEDED: ActivityKind[] = ['deployed', 'promoted', 'rolledBack'];
	const srOutcome = $derived(
		!toneOverride && kind && SUCCEEDED.includes(kind) ? 'deploy succeeded' : null
	);
</script>

<div class="act-sentence {compact ? 'act-sentence-compact' : ''} min-w-0">
	<div class="act-sentence-row">
		<span class="act-sentence-avatar relative inline-flex items-center justify-center">
			{#if !personRow && tone && cornerClass}
				<!-- An automatic row in a state: the state IS the mark (a dot on
				     the kuberik logo read as a broken avatar, Home r1). -->
				<StatusMark state={tone} label="{app ?? actor.name}: {verb}" resolved={resolvedFailure} />
			{:else if !personRow}
				<!-- An automatic row at rest: the list-row resting mark (§3.11), a
				     6px success dot, never a mascot on every success (/activity AD r1). -->
				<StatusMark state="newest" />
			{:else}
				<Avatar name={actor.name} src={actor.src} kind={actor.kind} size={20} />
			{/if}
			{#if cornerClass && personRow}
				<span
					class="act-corner absolute -right-0.5 -bottom-0.5 size-2 rounded-full {cornerClass}"
					aria-hidden="true"
				></span>
			{/if}
		</span>
		<!-- The OBJECT never truncates: a reader scans a feed for the app.
		     Shrink order when the line is tight: the actor's name first, then
		     the verb phrase; the app keeps its natural width and truncates only
		     if it alone cannot fit. Below 360px the actor is its avatar alone
		     and the verb moves to line 2 (coordinator, 2026-10-09). -->
		<span class="act-sentence-who" data-actor-kind={actor.kind} data-repeat={repeatActor ? '' : undefined}>
			{#snippet appName()}
				{#if app}
					{#if appHref}
						<a href={appHref} class="act-app t-card-title text-fg hover:underline">{app}</a>
					{:else}
						<span class="act-app t-card-title text-fg">{app}</span>
					{/if}
				{/if}
			{/snippet}
			{#if personRow}
				<span class="act-actor t-card-title text-fg">{actor.name}</span>
				{#if verb}
					<span class="act-verb t-meta {verbInk}">{verb}</span>
				{/if}
				{@render appName()}
			{:else}
				<!-- App first; the actor is named only in the mark's label. With
				     no app (a page scoped to one app), the verb stands alone. -->
				{@render appName()}
				{#if verb}
					<span class="act-verb t-meta {verbInk}">{verb}</span>
				{/if}
			{/if}
		</span>
		<span class="act-sentence-time t-meta tabular-nums text-fg-subtle">{time}</span>
		<span class="act-sentence-rest flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
			{#if verb}
				<!-- The narrow-rail copy of the verb (shown only below 360px, when
				     line 1 is avatar · app · time): the state word leads line 2 in its
				     ink, FleetRow's own two-line form. It is a visual copy only
				     (aria-hidden); the line-1 verb stays in the accessibility tree at
				     every width (visually hidden, not display:none, below 360px). -->
				<span class="act-verb-narrow t-meta {verbInk}" aria-hidden="true">{verb}</span>
			{/if}
			{#if env}
				<!-- Plain name, no chip: the row's identity is its app; an outlined
				     chip in every feed row was noise (/activity AD r1). -->
				<span class="act-env t-meta shrink-0 text-fg-muted">{env}</span>
			{/if}
			{#if from || to}
				<span class="flex min-w-0 flex-wrap items-center gap-1">
					{#if from}
						<!-- Plain, not struck through: an old version is not a deletion
						     (home-v2 AD round 1). The arrow carries the change. -->
						<span class="t-code-sm text-fg-subtle">{from}</span>
						<span class="t-meta text-fg-subtle">→</span>
					{/if}
					{#if to && toHref}
						<a href={toHref} class="t-code-sm text-fg-muted hover:underline">{to}</a>
					{:else if to}
						<span class="t-code-sm text-fg-muted">{to}</span>
					{/if}
				</span>
			{/if}
			{#if srOutcome}
				<span class="sr-only">{srOutcome}</span>
			{/if}
		</span>
	</div>
	{#if destination}
		<a href={destination} class="act-sentence-link" aria-label="Open {app ?? actor.name}"></a>
	{/if}
</div>

<style>
	/* Its own container context — this component is used inside different
	   cards/rails, so it has to read ITS OWN box's width, not assume an
	   ancestor already set `container-type`. */
	.act-sentence {
		container-type: inline-size;
		position: relative;
	}
	/* The dot's ring is the surface the row sits on: a caller on another ground
	   (a `.surface-raised` panel) sets `--avatar-ring`. */
	.act-corner {
		box-shadow: 0 0 0 2px var(--avatar-ring, var(--k-surface));
	}
	/* A grid, not a wrapping flex row: line 1 is [avatar][who, truncated]
	   [time] and never wraps, so the time stays on line 1 and the avatar never
	   sits alone (home-v2, the 288px rail). Line 2 is indented under the text. */
	.act-sentence-row {
		display: grid;
		grid-template-columns: 20px minmax(0, 1fr) auto;
		grid-template-areas:
			'avatar who time'
			'. rest rest';
		column-gap: 8px;
		row-gap: 4px;
		align-items: center;
	}
	.act-sentence-avatar {
		grid-area: avatar;
	}
	.act-sentence-who {
		grid-area: who;
		min-width: 0;
		display: flex;
		align-items: baseline;
		column-gap: 0.3em;
		overflow: hidden;
		white-space: nowrap;
	}
	.act-actor,
	.act-verb,
	.act-app {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Weighted shrink: the actor gives up width first, then the verb. The app
	   shrinks only once both are gone (its own min-content is the floor). */
	.act-actor {
		flex: 0 100 auto;
		min-width: 2.5em; /* a person's name truncates to "da…", never to nothing */
	}
	.act-verb {
		flex: 0 10 auto;
	}
	.act-app {
		flex: 0 0 auto;
		max-width: 100%;
	}
	.act-verb-narrow {
		display: none;
	}

	/* Narrow rails (< 360px of the row's own width): line 1 is avatar · app ·
	   time, the avatar standing for the actor (picture, monogram, the kuberik
	   mark, the CI glyph; its name stays in the avatar's label). The verb leads
	   line 2 in its state ink, so it is never cut to "f…". This is FleetRow's
	   reference form: name on line 1, the state sentence on line 2. */
	/* A PERSON's name is always visible text (coordinator ruling: avatar ·
	   person · verb · app); in a tight row it truncates first (its min-width
	   keeps "da…"), it is never hidden. Automatic rows have no name to hide. */
	@container (max-width: 359.98px) {
		/* Off screen, still read: the narrow copy below is aria-hidden. */
		.act-sentence-who .act-verb {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.act-verb-narrow {
			display: inline;
		}
	}
	.act-sentence-time {
		grid-area: time;
		white-space: nowrap;
	}
	.act-sentence-rest {
		grid-area: rest;
	}
	/* One line from 720px of the row's own width: the sentence keeps its
	   natural width (truncating first if it must), the change takes the slack. */
	@container (min-width: 720px) {
		.act-sentence:not(.act-sentence-compact) .act-sentence-row {
			grid-template-columns: 20px minmax(0, max-content) minmax(0, 1fr) auto;
			grid-template-areas: 'avatar who rest time';
			column-gap: 12px;
		}
	}
	/* The whole row's one destination — a stretched invisible link, same
	   mechanism as `.tap-zone`/`.tap-link` elsewhere, kept local here since
	   this component owns its own click target rather than relying on a
	   caller-supplied `.tap-zone` wrapper. */
	/* Real links inside the row (the app name) sit above the stretched one. */
	.act-sentence-row :global(a) {
		position: relative;
		z-index: 1;
	}
	.act-sentence-link {
		position: absolute;
		inset: 0;
		border-radius: 6px;
	}
</style>
