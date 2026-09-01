<svelte:options runes={true} />

<script module lang="ts">
	import type { EnvironmentTheme } from '$lib/environment-theme';

	export type Station = {
		key: string;
		/** Chip label — the region token in a fan-out, the env name otherwise. */
		label: string;
		title: string;
		theme: EnvironmentTheme | null;
		/** Display sha, or null when this environment has never deployed. */
		version: string | null;
		/** Own-list rank. 0 = newest, -1 = not placeable on the ladder. */
		rank: number;
		diverged: boolean;
		/** Raw bake status — drives the circle's tint and its glyph. */
		status: string;
		/** The word for the circle, for screen readers and the tooltip. */
		statusWord: string;
		/** `23m` — how long the running build has been here. */
		age: string | null;
		ageTitle: string | null;
		/**
		 * READY PODS IN THIS ENVIRONMENT, or `null` when they could not be
		 * attributed to this app.
		 *
		 * ⭐ NOT DECORATION — `DESIGN-INTENT.md`: *"A version string alone never
		 * proves something is serving. Gate on status + ready pods."* A station
		 * printing an environment and a build says WHAT WAS SET; the pod count
		 * is the only thing on the row that says it is actually RUNNING. It is
		 * the reference page's own `2/2 pods` idiom on its `Resources` rows.
		 *
		 * `null` prints nothing at all. A kustomization that substitutes more
		 * than one rollout cannot be attributed and must never borrow its
		 * neighbour's pods — same fence the exposure bar keeps.
		 */
		pods?: number | null;
		href?: string;
		/**
		 * A production region on the build the fleet agreed on: it keeps the
		 * full number and the full sha and gives up only the colour, so the
		 * regions that DIFFER are the ones that stand out. `StageChain`'s own
		 * rule, unchanged.
		 */
		quiet?: boolean;
	};

	export type Hop = {
		/** Builds waiting to cross this edge. Drives dashed vs solid. */
		waiting: number;
		label: string;
	};

	/**
	 * THE FRONTIER — the newest build this app has, named ONCE, at the top of
	 * the card.
	 *
	 * ⭐ THIS IS WHAT LICENSES EVERY RELATIVE BADGE BELOW IT. (2026-09-01)
	 *
	 * > *"on app page, we're only showing absolute versions, not relative."*
	 *
	 * `DESIGN-INTENT.md`: *"Relative version beats absolute. `−2 vs newest`,
	 * `matches STG` are the signal; the sha is usually noise. Show relative
	 * prominently, absolute only where identity is needed."* A page that says
	 * `1 behind` with no visible statement of what it is behind has spent the
	 * relative form and kept none of its meaning; a page that prints the sha at
	 * every station has spent the absolute form and gained no signal. The
	 * frontier is the one place on this card where the build IS the subject, so
	 * it takes the absolute — at 24px, with the copy control an operator needs
	 * for `kubectl` — and every station under it is then free to lead with its
	 * DISTANCE from it.
	 */
	export type Frontier = {
		/** Display sha of the newest build the app has. */
		version: string;
		/** The full tag, for the clipboard. Falls back to `version`. */
		tag: string | null;
		/** `1d` — how long ago the build was created. */
		age: string | null;
		ageTitle: string | null;
	};
</script>

<script lang="ts">
	/**
	 * THE PROMOTION PIPELINE — the app-detail page's SUBJECT.
	 *
	 * ══ WHY THIS EXISTS ═════════════════════════════════════════════════
	 *
	 * > *"App with no issues looks weird, like something is missing."*
	 *
	 * It was missing. `/apps/<name>` split into an ACT column and a 340px
	 * STATE rail; when nothing needs a person the act column does not render,
	 * and what was left was a reverse-chronological activity log beside a
	 * narrow rail — a page whose main object had been deleted. The rail held
	 * the answers to two of the page's three criteria (*which env runs what*,
	 * *is the prod fleet consistent*) at 340px and 11px, and the main column
	 * spent its whole width on the third.
	 *
	 * ⛔ THE FIX IS NOT AN ALL-CLEAR CARD. A card that says "nothing is wrong"
	 * is still a card spent on absence, and the human has rejected descriptive
	 * text on this page by name. The fix is that the page's SUBJECT — the
	 * promotion chain — stops being a sidebar and becomes the main column's
	 * lead object, in EVERY state. The healthy page is then the same
	 * composition with the alarm absent, not a different page.
	 *
	 * ══ THE FORM IS THE REFERENCE PAGE'S OWN ════════════════════════════
	 *
	 * Measured on `/rollouts/<cluster>/<ns>/<name>` — the page the human calls
	 * beautiful — `Deployment Pipeline` is a titled card whose body is a
	 * vertical run of STEPS: a filled status circle, the step's name at 14px,
	 * a right-aligned state, and a 1px connector joining one circle to the
	 * next. Its header carries the rollup `5/5 done`.
	 *
	 * This is that object with ENVIRONMENTS as the steps. Same circle (the
	 * product's `getStatusCircleClass` + `BakeStatusIcon` atom, at the 32px
	 * every task row on this page already uses), same connector, same
	 * right-aligned answer, same rollup slot — `3 of 3 up to date`.
	 *
	 * ⚠️ THE GREEN CIRCLE ON A SUCCEEDED ENVIRONMENT IS DELIBERATE, and it is
	 * the one place this object departs from `StageChain`, which draws NO dot
	 * for a settled node ("mark the deviation, never the norm"). That rule was
	 * derived for a MARK REPEATED DOWN A LIST — thirteen 5px dots in a 340px
	 * rail, every one saying "fine". Here the circle is not a health badge, it
	 * is the FRONTIER: a filled circle means the build reached this station,
	 * exactly as `Stage 1 · Done` means the deploy cleared that step on the
	 * reference page, which draws five of them and is the page the human
	 * points at. An unbroken run of circles down to the last environment is
	 * what "nothing is wrong" looks like when it is drawn instead of written.
	 *
	 * ══ A LINE AND A SET, AND NEVER ONE SHAPE FOR BOTH ══════════════════
	 *
	 * `DESIGN-INTENT.md`: *"Stages (dev → staging → canary) are a LINE.
	 * Production regions are a SET."* The state rail rendered both as the same
	 * vertical list, which is precisely forcing one shape onto both.
	 *
	 *   · STAGES get the line: one station per environment, joined by HOPS.
	 *     A hop is the promotion edge — SOLID when the edge is in sync,
	 *     DASHED with a printed count when builds are waiting to cross it.
	 *     Shape and a number, never a hue: amber is `stuck` and a promoting
	 *     pipeline is not a stuck one.
	 *   · REGIONS get the set: a wrapping grid, no rails, under a sub-header
	 *     that states the verdict in words (`all agree` / `3 versions`). A set
	 *     has no order, so it may not be drawn as a column with edges. N
	 *     regions cost rows, not width.
	 *
	 * ══ WHAT IT DOES NOT SAY ════════════════════════════════════════════
	 *
	 * No `stuck`, `pinned` or `failed` chips. Those belong to the `Needs you`
	 * card, which is where the DECISION is, and Direction B's one rule is that
	 * nothing appears twice. What this object owns is the state itself: the
	 * status circle, the build each environment runs, its distance from the
	 * newest, and when it last moved.
	 */
	import Chip from './Chip.svelte';
	import BakeStatusIcon from './BakeStatusIcon.svelte';
	import CopyButton from './CopyButton.svelte';
	import { getStatusCircleClass } from '$lib/bake-status';
	import { CodeBranchSolid, TagSolid, CubeSolid } from 'flowbite-svelte-icons';

	let {
		stages,
		hops = [],
		fleet = [],
		fleetHop = null,
		fleetVerdict = null,
		frontier = null,
		emptyLabel = 'No environments bound'
	}: {
		stages: Station[];
		/** `hops[i]` sits between `stages[i]` and `stages[i + 1]`. */
		hops?: (Hop | null)[];
		/** Production regions. Non-empty only when the app fans out. */
		fleet?: Station[];
		/** The edge from the last stage into the fleet. */
		fleetHop?: Hop | null;
		fleetVerdict?: { label: string; agree: boolean } | null;
		/**
		 * The newest build, stated once at 24px. `null` when the caller cannot
		 * prove which build that is — see `Frontier`, and see the caller's own
		 * guard: it withholds the frontier rather than print a headline that
		 * some station's `newest` chip would contradict.
		 */
		frontier?: Frontier | null;
		emptyLabel?: string;
	} = $props();
</script>

<!-- The build each station runs, in the product's joined `[verdict][sha]` box.
     Identical words, roles and colours to `StageChain` — one build badge, one
     spelling, across every page that draws a chain. -->
{#snippet buildBadge(s: Station)}
	{#if s.version === null}
		<Chip role="unranked" label="not deployed" title="{s.title} has never deployed" />
	{:else if s.diverged}
		<Chip
			role="diverged"
			wide
			label="unreleased"
			value={s.version}
			title="{s.title} runs a version that is on no environment's release list"
		/>
	{:else if s.rank === 0}
		<!-- ⛔ THE BARE SHA IS GONE. (2026-09-01)
		     > *"on app page, we're only showing absolute versions, not relative."*

		     It read: *"ON HEAD: THE BUILD ALONE, NO RANK WORD. One half means
		     'on head'; two halves carry a verdict."* That rule is coherent and it
		     is the reason the human's sentence is true: on a HEALTHY app every
		     station is rank 0, so the encoding collapsed and the card printed
		     `064b655` three times and nothing relative anywhere. A convention
		     whose entire signal is the ABSENCE of a word cannot lead a page;
		     it can only be decoded by someone who already knows the rule.

		     THE FIX IS NOT NEW, IT IS THE PRODUCT'S EXISTING MAJORITY SPELLING.
		     `/environments` and `/envs/[name]` both render this exact fact as
		     `role="head" label="newest"` joined to the sha. Two pages said the
		     word and two chain components withheld it; this makes it four. Zero
		     new roles, zero new colour values, and the sha is still printed in
		     full for the operator who is going to paste it into `kubectl`. -->
		{#if frontier && s.version === frontier.version}
			<!-- ⭐ AND WHEN THE FRONTIER IS PRINTED 40px ABOVE, THE STATION DROPS
			     THE SHA. Restoring the word without dropping the string gave the
			     healthy card FOUR copies of `064b655` in one 300px column — the
			     same defect the human named, one level down. `DESIGN-INTENT.md`
			     is explicit: *"Show relative prominently, absolute only where
			     IDENTITY IS NEEDED."* On a station that runs the build the card
			     has already named, the sha identifies nothing the reader does not
			     already have; the DEVIATIONS below still print theirs, which is
			     what makes them scannable. Nothing is lost: the frontier line
			     carries the full string and the copy control, the station links
			     to a rollout page that prints it at 24px, and the tooltip names
			     it. -->
			<Chip
				role="head"
				label="newest"
				title="{s.title} is on {s.version}, the newest version available to it"
			/>
		{:else}
			<Chip
				role="head"
				label="newest"
				value={s.version}
				title="{s.title} is on the newest version available to it"
				valueTitle="{s.title} runs {s.version}"
			/>
		{/if}
	{:else if s.rank > 0}
		<Chip
			role={s.quiet ? 'count' : 'rank'}
			label="{s.rank} behind"
			value={s.version}
			title="{s.title} can still take {s.rank} newer version{s.rank === 1 ? '' : 's'}"
			wide
		/>
	{:else}
		<Chip role="unranked" label="unknown" value={s.version} title="This build is not on the ladder" />
	{/if}
{/snippet}

{#snippet identity(s: Station)}
	{#if s.href}
		<a href={s.href} class="flex min-w-0" title="Open the {s.title} rollout">
			<Chip role="env" theme={s.theme} label={s.label} title={s.title} wide class="min-w-0" />
		</a>
	{:else}
		<Chip role="env" theme={s.theme} label={s.label} title={s.title} wide class="min-w-0" />
	{/if}
{/snippet}

<div class="pp">
	{#if stages.length === 0 && fleet.length === 0}
		<p class="t-micro text-gray-500 dark:text-gray-400">{emptyLabel}</p>
	{:else}
		{#if frontier}
			<!-- ── THE FRONTIER ────────────────────────────────────────────
			     The card's LEAD, and the only 24px type in its body. Three things
			     the card did not have before and that `COMPOSITION-GRAMMAR.md`
			     names as the difference between the reference page and the
			     rejected ones: a real type range (24 → 10 inside one object),
			     a mark that is not a repeated status dot, and a control that
			     looks pressable.

			     IT IS ALSO THE PAGE'S ANSWER TO "ABSOLUTE EVERYWHERE, RELATIVE
			     NOWHERE". The sha belongs HERE, once, because here it is the
			     subject — this is the build every `N behind` below is counted
			     against, and it is the string that goes into `kubectl`. Every
			     station below leads with its DISTANCE from it. -->
			<div class="pp-front">
				<span class="pp-front-disc" aria-hidden="true">
					<TagSolid class="h-4 w-4" />
				</span>
				<span class="pp-front-id">
					<span class="t-display-id text-gray-900 dark:text-white">{frontier.version}</span>
					<span class="t-label text-gray-500 dark:text-gray-400">newest build</span>
				</span>
				<span class="pp-front-meta">
					{#if frontier.age}
						<span
							class="t-micro whitespace-nowrap text-gray-500 dark:text-gray-400"
							title={frontier.ageTitle ?? undefined}>built {frontier.age} ago</span
						>
					{/if}
					<CopyButton
						value={frontier.tag ?? frontier.version}
						label="version {frontier.version}"
						size="xs"
					/>
				</span>
			</div>
		{/if}
		<ol class="pp-line">
			{#each stages as s, i (s.key)}
				<li class="pp-station">
					<span
						class="pp-disc {getStatusCircleClass(s.status)}"
						title="{s.title} — {s.statusWord}"
					>
						<BakeStatusIcon bakeStatus={s.status} size="medium" />
						<span class="sr-only">{s.statusWord}</span>
					</span>
					<!-- WHO, THEN WHAT IT RUNS — one cluster, left. The build badge
					     sits BESIDE the environment because they are one fact
					     (`STAGING runs 064b655`); parked on the card's right edge with
					     600px of nothing between them the row read as two unrelated
					     columns. What goes hard right is the TIME, which is exactly
					     what the activity list directly below this card does with its
					     own timestamps — one page, one idiom. -->
					<span class="pp-id">
						{@render identity(s)}
						{@render buildBadge(s)}
					</span>
					<!-- THE ROW'S ROLLUP, HARD RIGHT: is it serving, and since when.
					     `COMPOSITION-GRAMMAR.md` §1 makes the right-aligned answer
					     the most transferable thing on the reference page, and the
					     reference applies it to ROWS too — every `Resources` row
					     ends in `2/2 pods`. Until now this slot held a timestamp
					     alone, which is the half of the answer that cannot be acted
					     on. -->
					{#if (s.pods !== null && s.pods !== undefined) || s.age}
						<span class="pp-meta">
							{#if s.pods !== null && s.pods !== undefined}
								<span
									class="pp-pods t-code-sm text-gray-500 dark:text-gray-400"
									title="{s.pods} ready pod{s.pods === 1 ? '' : 's'} serving {s.title}"
								>
									<!-- THE UNIT IS PRINTED. An unlabelled `5` beside `1d ago`
									     is a puzzle; `5 pods` is the reference page's own
									     `2/2 pods`, four characters, and it is the difference
									     between a number and a fact. -->
									<CubeSolid class="h-3 w-3 shrink-0" aria-hidden="true" />{s.pods} pods
								</span>
							{/if}
							{#if s.age}
								<span
									class="t-micro whitespace-nowrap text-gray-500 dark:text-gray-400"
									title={s.ageTitle ?? undefined}>{s.age} ago</span
								>
							{/if}
						</span>
					{/if}
				</li>

				{#if hops[i]}
					{@const h = hops[i] as Hop}
					<!-- The rail is always drawn; the LABEL only when it is a count.
					     A solid rail already says "in sync" and saying it twice is
					     the page marking the norm once per promotion edge. -->
					<li class="pp-hop">
						<span class="pp-rail {h.waiting > 0 ? 'pp-rail--gap' : ''}"></span>
						{#if h.label}
							<span class="t-code-sm truncate text-gray-500 dark:text-gray-400">{h.label}</span>
						{/if}
					</li>
				{/if}
			{/each}

			{#if fleet.length > 0 && fleetHop}
				<li class="pp-hop">
					<span class="pp-rail {fleetHop.waiting > 0 ? 'pp-rail--gap' : ''}"></span>
					{#if fleetHop.label}
						<span class="t-code-sm truncate text-gray-500 dark:text-gray-400">{fleetHop.label}</span>
					{/if}
				</li>
			{/if}
		</ol>

		{#if fleet.length > 0}
			<!-- THE SET. A sub-header inside a card still gets an icon — the
			     reference page carries 115 of them and every titled region has
			     one — and the verdict is stated in WORDS beside the rows that
			     draw it, so criterion 3 is answered without counting. -->
			<div class="pp-fleet">
				<div class="mb-3 flex items-center gap-2">
					<CodeBranchSolid class="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />
					<h3 class="t-label text-gray-500 dark:text-gray-400">
						Production · {fleet.length} regions
					</h3>
					{#if fleetVerdict}
						<span class="ms-auto">
							<!-- ALWAYS `count`, NEVER `rank`. A COUNT of builds is not an
							     adverse state: regions on different builds mid-promotion is
							     the normal state of a pipeline. What IS adverse about a
							     region is on that region's own station. -->
							<Chip
								role="count"
								label={fleetVerdict.label}
								wide
								title={fleetVerdict.agree
									? 'Every production region runs the same version'
									: 'Production regions are running different versions'}
							/>
						</span>
					{/if}
				</div>
				<ul class="pp-set">
					{#each fleet as s (s.key)}
						<li class="pp-region">
							<span
								class="pp-disc pp-disc--sm {getStatusCircleClass(s.status)}"
								title="{s.title} — {s.statusWord}"
							>
								<BakeStatusIcon bakeStatus={s.status} size="small" />
								<span class="sr-only">{s.statusWord}</span>
							</span>
							<span class="pp-id">
								{@render identity(s)}
								{@render buildBadge(s)}
							</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}
</div>

<style>
	/* The station's own container, because what it must respond to is the
	   CARD's width — this page's main column is 1fr beside a 340px rail on
	   desktop and the full page on a phone, and neither is a viewport
	   breakpoint. */
	.pp {
		container-type: inline-size;
	}

	.pp-line {
		display: flex;
		flex-direction: column;
	}

	/* ── THE FRONTIER ────────────────────────────────────────────────────
	   Same 32px + 12px measure as a station, so the 24px build id sits on the
	   stations' own text axis and the object reads as the head of the column
	   rather than as a banner dropped on top of it. It is separated by the
	   card's own 1px rule, not by a fill: `COMPOSITION-GRAMMAR.md` §2,
	   *"separation comes from the border and the ground, not from a shadow"* —
	   and a tinted headline would be a status field at header scale, which is
	   the measurement that deleted this page's last two coloured grounds. */
	.pp-front {
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr);
		grid-template-areas:
			'disc id'
			'.    meta';
		align-items: center;
		column-gap: 12px;
		row-gap: 8px;
		padding-bottom: 16px;
		margin-bottom: 12px;
		border-bottom: 1px solid var(--color-gray-200);
	}
	:global(.dark) .pp-front {
		border-bottom-color: var(--color-gray-700);
	}
	/* NEUTRAL, AND DELIBERATELY NOT A STATUS CIRCLE. The six status hues belong
	   to the stations; the frontier is an IDENTITY, not a state, and a green
	   disc here would read as "the newest build is healthy", which is a claim
	   about no environment in particular. */
	.pp-front-disc {
		grid-area: disc;
		display: inline-flex;
		height: 32px;
		width: 32px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		background: var(--color-gray-100);
		color: var(--color-gray-500);
	}
	:global(.dark) .pp-front-disc {
		background: var(--color-gray-700);
		color: var(--color-gray-300);
	}
	.pp-front-id {
		grid-area: id;
		display: flex;
		min-width: 0;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 10px;
	}
	.pp-front-meta {
		grid-area: meta;
		display: flex;
		align-items: center;
		gap: 12px;
	}
	@container (min-width: 460px) {
		.pp-front {
			grid-template-columns: 32px minmax(0, 1fr) auto;
			grid-template-areas: 'disc id meta';
		}
		.pp-front-meta {
			justify-self: end;
		}
	}

	/* ── A STATION ───────────────────────────────────────────────────────
	   Phone form: the circle, the environment and its build on one line; the
	   age under them, indented to the identity's own x. Desktop form: one
	   line, the age hard right. Deliberately in that order — WHO the row is
	   about and WHAT it runs together, WHEN it got there last. */
	.pp-station {
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr);
		grid-template-areas:
			'disc id'
			'. meta';
		align-items: center;
		column-gap: 12px;
		row-gap: 6px;
		padding-block: 8px;
	}

	/* THE DISC IS THE PRODUCT'S STATUS CIRCLE, at the 32px this page's task
	   rows already use. Not a new atom, not a new colour: the ground comes
	   from `getStatusCircleClass` and the glyph from `BakeStatusIcon`, which
	   are the two functions that own the six status hues. */
	.pp-disc {
		grid-area: disc;
		position: relative;
		display: inline-flex;
		height: 32px;
		width: 32px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
	}
	.pp-disc--sm {
		height: 24px;
		width: 24px;
	}

	.pp-id {
		grid-area: id;
		display: flex;
		min-width: 0;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.pp-meta {
		grid-area: meta;
		align-self: center;
		display: flex;
		align-items: center;
		gap: 12px;
	}
	/* The glyph and its number are ONE token — 4px, not the row's 12px, so the
	   cube reads as the unit on the count rather than as a third item in the
	   right-hand group. */
	.pp-pods {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		white-space: nowrap;
	}

	@container (min-width: 460px) {
		.pp-station {
			grid-template-columns: 32px minmax(0, 1fr) auto;
			grid-template-areas: 'disc id meta';
		}
		.pp-meta {
			justify-self: end;
		}
	}

	/* ── THE HOP ─────────────────────────────────────────────────────────
	   The promotion edge, drawn through the disc column's centre so the line
	   runs from one circle to the next. Same encoding as `StageChain`: solid
	   is in sync, dashed is a gap, and the count is printed in mono. */
	.pp-hop {
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr);
		align-items: center;
		column-gap: 12px;
		height: 22px;
	}
	/* THE LINE IS CONTINUOUS, CIRCLE TO CIRCLE. Drawn only inside the hop's
	   own 22px box it left an 8px break at each end — the station's padding —
	   so three stations read as three floating ticks rather than as one chain.
	   It bleeds back through that padding instead. `15.5px` is 32/2 − 0.5:
	   a 1px border starting there occupies 15.5–16.5, whose centre is the
	   disc's own. */
	.pp-rail {
		display: block;
		width: 0;
		height: calc(100% + 16px);
		margin-block: -8px;
		margin-left: 15.5px;
		border-left: 1px solid var(--color-gray-300);
	}
	:global(.dark) .pp-rail {
		border-left-color: var(--color-gray-600);
	}
	.pp-rail--gap {
		border-left-style: dashed;
		border-left-color: var(--color-gray-400);
	}
	:global(.dark) .pp-rail--gap {
		border-left-color: var(--color-gray-500);
	}

	/* ── THE SET ─────────────────────────────────────────────────────────
	   A GRID, and that is the whole point: a set has no order, so it may not
	   be drawn as a column with edges between its members. Twelve regions
	   cost rows here, never width, and the wrap is `auto-fill` so three
	   regions do not stretch to a third of the card each. */
	.pp-fleet {
		margin-top: 16px;
		border-top: 1px solid var(--color-gray-200);
		padding-top: 16px;
	}
	:global(.dark) .pp-fleet {
		border-top-color: var(--color-gray-700);
	}
	.pp-set {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 4px 24px;
	}
	.pp-region {
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr);
		grid-template-areas: 'disc id';
		align-items: center;
		column-gap: 10px;
		padding-block: 6px;
	}
</style>
