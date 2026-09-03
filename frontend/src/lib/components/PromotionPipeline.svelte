<svelte:options runes={true} />

<script module lang="ts">
	import type { EnvironmentTheme } from '$lib/environment-theme';
	import type { BlockingStory } from '$lib/view-models/blocking-story';
	import type { CardStateMark } from '$lib/rollout-cards';

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
		 * ⭐ IN-FLIGHT PROGRESS, IN WORDS. (Operator walk, finding 11) A station
		 * mid-deploy used to read exactly like a settled one — `2/2 running ·
		 * 1m ago` — with the fact that it was moving carried only by the
		 * disc's `sr-only` text, while `/` states the same rollout as
		 * `deploying · 37s`. `null` on a settled station: `age` alone answers
		 * "how long has it been here" and this field would be restating it.
		 * On a `Deploying`/`InProgress` station it is the elapsed span
		 * (`37s`, or `14s of 15s` for a bake window with a known total) —
		 * built by the CALLER from the same `compactSpan` / `computeBakeProgress`
		 * helpers `/`'s `ControlCenter.motionMessages` already uses, so the
		 * two pages cannot spell "how long has this been going" two ways.
		 */
		statusDetail?: string | null;
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
		/**
		 * TOTAL REPLICAS THE WORKLOAD WANTS, alongside `pods` (ready). Together
		 * they are the health fact — `2/2 running` — the reference page's own
		 * `Resources` row idiom (`ready/total pods`) read down the chain instead
		 * of down a resource list.
		 *
		 * ⭐ BOTH OR NEITHER. (2026-09-02, follow-up: *"the void moved, it did not
		 * go"* — capping the row's track just relocated the empty space to the
		 * card's right margin. The real fix is content: give each station a
		 * fact worth its own column.) `null`/`undefined` prints NOTHING, never a
		 * bare ready count and never a dash — a half-known ratio (`2/?`) is not
		 * a fact, it is a rounding of one. Same fence as `pods` itself: a
		 * kustomization that substitutes more than one rollout cannot be
		 * attributed to either app, so both halves stay unattributed together.
		 */
		podsTotal?: number | null;
		href?: string;
		/**
		 * A production region on the build the fleet agreed on: it keeps the
		 * full number and the full sha and gives up only the colour, so the
		 * regions that DIFFER are the ones that stand out. `StageChain`'s own
		 * rule, unchanged.
		 */
		quiet?: boolean;
		/**
		 * ⭐ A GATE IS REFUSING EVERY CANDIDATE HERE — the station's OWN
		 * `promotionBlock(...).blocked`, not the hop's. (2026-09-02)
		 *
		 * > *"a gate correctly refusing a candidate is not a stoppage"* —
		 * `COMPOSITION-GRAMMAR.md`'s own ruling, applied one level down. Without
		 * it the `N behind` chip's tooltip said *"hello-frontend-app in DEV can
		 * still take 1 newer version"* on the exact station a dependency contract
		 * was refusing that build to — a claim of ABILITY on a row that has none.
		 * `false`/`undefined` is silent: most `N behind` stations are simply
		 * mid-promotion and the plain sentence is still true there.
		 */
		blocked?: boolean;
		/**
		 * ⭐ ROLLED BACK / PINNED / HELD — the SAME precedence `/`, `/rollouts`,
		 * `/apps` and `/environments` already read (`rollout-cards.ts`'s
		 * `cardStateMark`), so a settled station's disc matches the identical
		 * rollout everywhere else it is drawn. `null`/`undefined` draws the
		 * plain bake glyph, unchanged. (coordinator follow-up, disc-parity
		 * pass — this chain used to draw every settled station as a plain
		 * green tick regardless of any of the three.)
		 */
		mark?: CardStateMark | null;
	};

	export type Hop = {
		/** Builds waiting to cross this edge. Drives dashed vs solid. */
		waiting: number;
		label: string;
		/**
		 * ⭐ WHAT HOLDS THIS EDGE, DRAWN ON THE EDGE. (2026-09-02)
		 *
		 * > *"the hop between stations, which is where the gate actually lives,
		 * > carries nothing."*
		 *
		 * A station answers *what is running here*; the HOP is the promotion
		 * itself, so the gate refusing that promotion belongs on it and nowhere
		 * else. Until now it was a 1px rail with an occasional mono caption, and
		 * the reason a build could not cross it was printed in a card in the
		 * other half of the page.
		 *
		 * The gates are ALREADY NARROWED by the caller to the edge's own cause —
		 * `promotion`-kind gates are stripped, because *"waiting for dev to
		 * deploy it first"* IS this object and drawing it here would be the
		 * chain restating itself. `null` on an open edge: a plain rail is the
		 * mark for "nothing is holding this", and a caption saying so is the
		 * page marking the norm once per promotion edge.
		 */
		story?: BlockingStory | null;
		/**
		 * Where a reader goes to unblock it — the PROVIDER app when a
		 * dependency contract is the cause. The row is a `.tap-zone` when this
		 * is set, so the region that names the blocking service is the region
		 * that opens it.
		 */
		href?: string | null;
		/** The destination's name, for the anchor's label. */
		hrefLabel?: string | null;
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
		/**
		 * ⭐ SET ONLY WHEN EVERY STATION ON THE FRONTIER AGREES. The frontier
		 * is an app-wide IDENTITY, not one rollout, so `mark` is `null` unless
		 * the caller resolved every station currently running this exact
		 * build to the SAME `cardStateMark` — see the caller's own note. Never
		 * recompute this here: the resolution needs the per-station facts the
		 * frontier object does not carry.
		 */
		mark?: CardStateMark | null;
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
	import BlockingStoryLines from './BlockingStoryLines.svelte';
	import { getStatusCircleClass } from '$lib/bake-status';
	import { CodeBranchSolid, TagSolid, CubeSolid } from 'flowbite-svelte-icons';

	let {
		stages,
		hops = [],
		entryHop = null,
		fleet = [],
		fleetHop = null,
		fleetVerdict = null,
		frontier = null,
		emptyLabel = 'No environments bound'
	}: {
		stages: Station[];
		/** `hops[i]` sits between `stages[i]` and `stages[i + 1]`. */
		hops?: (Hop | null)[];
		/**
		 * ⭐ THE EDGE FROM THE FRONTIER INTO THE FIRST STAGE — the one hop this
		 * object never had, and the one the app's own gate usually sits on.
		 *
		 * `hello-frontend-app` runs the same build in all three environments, so
		 * every edge BETWEEN stations is in sync and every rail was solid; what
		 * is actually held is the newest build's entry into DEV, an edge that
		 * had no object at all. It renders only when it is HELD — an open entry
		 * hop is the norm and drawing it on every healthy app is exactly the
		 * repetition this file cuts everywhere else.
		 */
		entryHop?: Hop | null;
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
			title={s.blocked
				? `${s.title} is ${s.rank} newer version${s.rank === 1 ? '' : 's'} behind, held by a gate`
				: `${s.title} can still take ${s.rank} newer version${s.rank === 1 ? '' : 's'}`}
			wide
		/>
	{:else}
		<Chip role="unranked" label="unknown" value={s.version} title="This build is not on the ladder" />
	{/if}
{/snippet}

{#snippet hopRow(h: Hop)}
	<!-- ⭐ THE EDGE, AND WHAT IS ON IT.
	     · OPEN — a plain rail. Nothing else: `in sync` was cut from this object
	       once already for marking the norm once per promotion edge.
	     · HELD — the rail goes dashed and the edge DRAWS its cause, in
	       `BlockingStoryLines`' vocabulary (`⇄ hello-api-app [API|1.66.0] →
	       [^1.67.0]`, a per-kind mark, and the rule record behind one control).
	       That component is IMPORTED, not restated: the same object renders this
	       clause on `/environments`, on `/envs/<name>` and in this page's own
	       waiting card, so a gate cannot be drawn two ways one scroll apart.

	     ⛔ ONCE, NOT ONCE PER STATION. One dependency gate holds DEV, STAGING and
	     PROD on `hello-frontend-app`; the caller attaches it to the most upstream
	     edge it bites and to no other, so the drawing appears where the wave
	     actually stopped. WHO it holds is the page BANNER's job — that headline
	     names every environment — and repeating the set here would be the same
	     fact in two objects, which is the defect this pass exists to remove. -->
	<li class="pp-hop {h.story ? 'pp-hop--held' : ''}">
		<span class="pp-rail {h.waiting > 0 || h.story ? 'pp-rail--gap' : ''}"></span>
		{#if h.story}
			<!-- A REGION THAT NAMES THE BLOCKING SERVICE IS THE REGION THAT OPENS
			     IT. `.tap-zone` / `.tap-link` is the product's pattern for that;
			     wrapping the row in an `<a>` would nest it around the rule
			     disclosure and the chips it already contains.

			     ⛔ THE PROVIDER'S NAME NO LONGER SPELLS `Open hello-api-app ›` A
			     SECOND TIME. (2026-09-02, follow-up) The banner action carries that
			     exact CTA now, 40px above this edge — two controls naming one
			     destination is the redundant-tab-stop rule (`CLAUDE.md`, applied on
			     `/apps` this week) one level down. `BlockingStoryLines` takes the
			     href instead: the provider's own name, already drawn at full ink
			     inside the clause, IS the zone's one `.tap-link` when it matches
			     `h.hrefLabel`. The edge still navigates; it just stops re-spelling
			     the CTA to do it. -->
			<div
				class="pp-hop-body {h.href
					? 'tap-zone rounded hover:bg-gray-50 dark:hover:bg-gray-700/30'
					: ''}"
			>
				<BlockingStoryLines
					story={h.story}
					class="min-w-0"
					subjectHref={h.href}
					subjectLabel={h.hrefLabel}
				/>
			</div>
		{:else if h.label}
			<span class="t-code-sm truncate text-gray-500 dark:text-gray-400">{h.label}</span>
		{/if}
	</li>
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

<div class="pp {entryHop ? 'pp--entry' : ''}">
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
				<!-- ⭐ MARKED ONLY WHEN EVERY STATION ON IT AGREES — see `Frontier.mark`'s
				     own note. Unmarked (the common case) this is byte-identical to the
				     plain neutral tag it always was. -->
				<span
					class="pp-front-disc {frontier.mark
						? `pp-front-disc--marked ${getStatusCircleClass('Succeeded', frontier.mark.kind)}`
						: ''}"
					aria-hidden={frontier.mark ? undefined : 'true'}
					title={frontier.mark ? frontier.mark.title : undefined}
				>
					{#if frontier.mark}
						<BakeStatusIcon
							bakeStatus="Succeeded"
							size="small"
							state={frontier.mark.kind}
							stateWord={frontier.mark.word}
							decorative
						/>
						<span class="sr-only">{frontier.mark.word}</span>
					{:else}
						<TagSolid class="h-4 w-4" />
					{/if}
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
			{#if entryHop}
				{@render hopRow(entryHop)}
			{/if}
			{#each stages as s, i (s.key)}
				{@const inFlight = s.status === 'Deploying' || s.status === 'InProgress'}
				<li class="pp-station {inFlight ? 'pp-station--inflight' : ''}">
					<span
						class="pp-disc {getStatusCircleClass(s.status, s.mark?.kind ?? null)}"
						title="{s.title} — {s.mark ? s.mark.title : s.statusWord}"
					>
						<BakeStatusIcon
							bakeStatus={s.status}
							size="medium"
							state={s.mark?.kind ?? null}
							stateWord={s.mark?.word ?? ''}
						/>
						<span class="sr-only">{s.mark ? s.mark.word : s.statusWord}</span>
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
					<!-- ⭐ THE MIDDLE IS FACTS NOW, NOT A GAP. (2026-09-02, follow-up:
					     *"the void moved, it did not go"* — a `max-width` cap just
					     relocated the empty span from between the chips and the
					     timestamp to the card's own right margin. `pp-health` and
					     `pp-meta` are FIXED-width grid tracks — same two columns on
					     every station — so `2/2 running` and `4d ago` land on one
					     right edge down the whole chain, whether or not any one row
					     has a health fact to print. `pp-facts` is the phone-width
					     wrapper: `display:contents` unwraps it once the container is
					     wide enough for the two to become their own tracks, so the
					     narrow layout is untouched. -->
					<span class="pp-facts">
						<span class="pp-health">
							{#if s.pods !== null && s.pods !== undefined && s.podsTotal !== null && s.podsTotal !== undefined && s.podsTotal > 0}
								<span
									class="pp-pods t-code-sm text-gray-500 dark:text-gray-400"
									title="{s.pods} of {s.podsTotal} pods ready and serving {s.title}"
								>
									<!-- THE UNIT IS PRINTED, AND SO IS THE DENOMINATOR. An
									     unlabelled `5` beside `1d ago` is a puzzle; `2/2 running`
									     is the reference page's own `ready/total pods` idiom on
									     its `Resources` rows, read down the chain instead of down
									     a resource list. Ready with no known total does NOT fall
									     back to a bare count — see `Station.podsTotal`. -->
									<CubeSolid class="h-3 w-3 shrink-0" aria-hidden="true" />{s.pods}/{s.podsTotal}
									running
								</span>
							{/if}
						</span>
						<!-- THE ROW'S ROLLUP, HARD RIGHT: is it serving, and since when.
						     `COMPOSITION-GRAMMAR.md` §1 makes the right-aligned answer
						     the most transferable thing on the reference page, and the
						     reference applies it to ROWS too. -->
						<span class="pp-meta">
							<!-- ⛔ AN IN-FLIGHT STATION USED TO READ "AT REST". (Operator
							     walk, finding 11) `age` (`f.timestamp` ago) is the same
							     field whether the deploy that started it has finished or
							     not, so a rollback 37 seconds in and one from three days
							     ago both printed `… ago` with only the disc's `sr-only`
							     text — never read aloud on screen — saying which. `/`
							     states this in words with elapsed time
							     (`deploying · 37s`, `checking · 14s of 15s`); this is the
							     same idiom, one column over. The VERB is coloured, same
							     as `ControlCenter.motionMessages` (blue deploying, yellow
							     checking); the elapsed span stays neutral. -->
							{#if inFlight}
								<span
									class="t-micro whitespace-nowrap"
									title="{s.title} — {s.statusWord}{s.statusDetail
										? `, ${s.statusDetail}`
										: ''}"
								>
									<span
										class={s.status === 'Deploying'
											? 'text-blue-700 dark:text-blue-400'
											: 'text-yellow-700 dark:text-yellow-400'}>{s.statusWord}</span
									>
									{#if s.statusDetail}
										<span class="text-gray-500 dark:text-gray-400"> · {s.statusDetail}</span>
									{/if}
								</span>
							{:else if s.age}
								<span
									class="t-micro whitespace-nowrap text-gray-500 dark:text-gray-400"
									title={s.ageTitle ?? undefined}>{s.age} ago</span
								>
							{/if}
						</span>
					</span>
				</li>

				{#if hops[i]}
					{@render hopRow(hops[i] as Hop)}
				{/if}
			{/each}

			{#if fleet.length > 0 && fleetHop}
				{@render hopRow(fleetHop)}
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
								class="pp-disc pp-disc--sm {getStatusCircleClass(s.status, s.mark?.kind ?? null)}"
								title="{s.title} — {s.mark ? s.mark.title : s.statusWord}"
							>
								<BakeStatusIcon
									bakeStatus={s.status}
									size="small"
									state={s.mark?.kind ?? null}
									stateWord={s.mark?.word ?? ''}
								/>
								<span class="sr-only">{s.mark ? s.mark.word : s.statusWord}</span>
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

	/* ⭐ NO CAP. THE ROW SIZES TO ITS OWN FACTS. (2026-09-02, follow-up)
	   > *"the void moved, it did not go"* — a `max-width: 480px` cap on this
	      element made the row a fixed BOX rather than fixed CONTENT: it moved
	   the empty span from between the chips and the timestamp to a 340px
	   margin on the card's right edge, which is the same emptiness under a
	   different name. Removed. Every column that used to be `minmax(0, 1fr)`
	   — `.pp-front-id`/`.pp-id` below — is `max-content` now instead, so a
	   station sizes to what it actually has to say (disc + chips + health +
	   age) and stops there. What is left of the card's own width becomes
	   genuine margin, the same argument `RolloutGrid`'s 460px card cap makes
	   on `/rollouts`, just reached by content instead of by a number. */
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
	/* WHEN THE FIRST EDGE IS DRAWN, THE RULE COMES OFF AND THE RAIL TAKES OVER.
	   A hairline and a rail 4px apart are two separators for one join, and the
	   rail is the one that carries meaning: it says the newest build is trying
	   to get INTO the chain, which is exactly what the entry hop is about. */
	.pp--entry .pp-front {
		border-bottom: none;
		padding-bottom: 4px;
		margin-bottom: 0;
	}
	/* NEUTRAL BY DEFAULT, AND DELIBERATELY NOT A STATUS CIRCLE. The six bake
	   hues belong to the stations; the frontier is an IDENTITY, not a state,
	   and a green disc here would read as "the newest build is healthy",
	   which is a claim about no environment in particular — see `Frontier.mark`'s
	   own note for the one case that earns an exception. `:not()` rather than a
	   plain `.pp-front-disc` rule: it has to lose outright to the
	   `getStatusCircleClass` utility classes on a marked disc, not merely tie
	   with them, and a same-specificity plain-class override is decided by
	   SOURCE ORDER against Tailwind's own layer — the one thing this file does
	   not control. */
	.pp-front-disc:not(.pp-front-disc--marked) {
		background: var(--color-gray-100);
		color: var(--color-gray-500);
	}
	:global(.dark) .pp-front-disc:not(.pp-front-disc--marked) {
		background: var(--color-gray-700);
		color: var(--color-gray-300);
	}
	.pp-front-disc {
		grid-area: disc;
		display: inline-flex;
		height: 32px;
		width: 32px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border-radius: calc(infinity * 1px);
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
			/* `max-content`, not `1fr` — see the note above `.pp-line`. The
			   frontier's own id (a 24px sha + `newest build`) hugs the disc
			   instead of stretching the row out to the card's own width, so
			   its `meta` (age + copy button) lands close beside it rather than
			   at a far edge nothing below it reaches. */
			grid-template-columns: 32px minmax(0, max-content) auto;
			grid-template-areas: 'disc id meta';
		}
		.pp-front-meta {
			justify-self: start;
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
			'. facts';
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
		border-radius: calc(infinity * 1px);
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

	/* ⭐ PHONE FORM: ONE WRAPPING ROW, LIKE `.pp-meta` USED TO BE ALONE.
	   `.pp-health` and `.pp-meta` are its flex children here and carry no grid
	   area of their own — `display: contents` below hands them straight to
	   the grid once the container is wide enough to give each its own
	   track, and this wrapper's only job past that point is to not exist. */
	.pp-facts {
		grid-area: facts;
		align-self: center;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
	}
	.pp-health {
		display: inline-flex;
		align-items: center;
	}
	.pp-meta {
		display: inline-flex;
		align-items: center;
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
			/* ⭐ ALL FOUR TRACKS ARE FIXED, AND THAT IS WHAT MAKES THEM ALIGN.
			   (2026-09-02, follow-up — measured, not assumed) Each `<li>` is its
			   own independent grid; `id` sized `max-content` first landed
			   `health`/`meta` at three DIFFERENT x positions (370 / 398 / 377 on
			   the live fleet) because `max-content` resolves PER ROW against
			   that row's own chips — `DEV` is not `STAGING`. There is no shared
			   parent grid here for `subgrid` to key off, so alignment has to
			   come from every row reserving the SAME width for `id`, not from
			   each row's own content. `240px` fits the fleet's widest member
			   measured (`STAGING` + `1 BEHIND 2.66.0-66`, 228px) with headroom; `health` and
			   `age` are sized for their own vocabulary's widest members —
			   `10/10 running` and `46m ago`. */
			grid-template-columns: 32px 240px 108px 64px;
			grid-template-areas: 'disc id health meta';
		}
		/* ⭐ THE ONE ROW THAT IS ACTUALLY MOVING GETS A WIDER TRACK, NOT EVERY
		   ROW. (Operator walk, finding 11) `deploying · 37s` and
		   `checking · 14s of 15s` both run past `64px` — the width `46m ago`
		   was measured for — and every `<li>` is its own independent grid (see
		   the note above), so widening ONLY this station's `meta` track costs
		   nothing to its settled siblings, which keep the exact 64px they were
		   sized against. */
		.pp-station--inflight {
			grid-template-columns: 32px 240px 108px max-content;
		}
		/* THE WRAPPER STOPS WRAPPING. Its children become direct grid items —
		   `display: contents` removes `.pp-facts` from the box tree entirely
		   while leaving `.pp-health`/`.pp-meta` exactly where they were in the
		   DOM, which is what lets them take `grid-area` at this width and flow
		   as ordinary flex children below it. */
		.pp-facts {
			display: contents;
		}
		.pp-health {
			grid-area: health;
			justify-self: start;
		}
		.pp-meta {
			grid-area: meta;
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
	/* A HELD HOP IS AS TALL AS WHAT IS ON IT. The 22px above is the height of
	   a bare rail; an edge carrying a drawn clause (and a rule control under
	   it) sets its own. `height` → `min-height` only here, so an open hop is
	   byte-identical to what shipped. */
	.pp-hop--held {
		height: auto;
		min-height: 22px;
		padding-block: 2px;
	}
	.pp-hop-body {
		display: flex;
		min-width: 0;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 4px 8px;
		/* `BlockingStoryLines` carries its own 6px top margin — it is written to
		   hang under a row on `/environments`. Pulled back here so the clause
		   centres on the rail rather than sitting low in its own box. */
		margin-block: -2px;
		padding: 2px 4px;
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
