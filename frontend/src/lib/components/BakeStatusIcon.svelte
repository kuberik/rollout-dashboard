<svelte:options runes={true} />

<script lang="ts">
	import StatusSpinner from './StatusSpinner.svelte';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		PauseSolid,
		CircleMinusSolid,
		RefreshOutline,
		UndoOutline,
		LockSolid
	} from 'flowbite-svelte-icons';
	import { getBakeStatusColor, bakeWord } from '$lib/bake-status';

	/**
	 * ⭐ THE DISC DIAMETER TOKEN. (2026-09-02) This component sizes the GLYPH
	 * only (`size` below) — the disc's own diameter is set by the wrapper
	 * `<span class="… rounded-full …">` at each call site, because the
	 * tinted fill (`getStatusCircleClass`) and the glyph are drawn by two
	 * different pieces of markup that have to agree on a box. That split
	 * had drifted to FOUR diameters for one state (`held`) across `/`
	 * (20px), `/rollouts` (32px), `/apps` (36px) and `/envs/<name>` (24px) —
	 * measured on the same three `hello-frontend-app` rollouts, same fill,
	 * same glyph, four different-sized coins.
	 *
	 * **The LIST ROW token is `h-7 w-7` (28px).** Every page that draws one
	 * rollout (or one app's rollup) per row in a scannable list uses it:
	 * `/rollouts` cards, `/apps` rows, `/envs/<name>` rows, `/environments`
	 * rows, and `CommandPalette` (which had it right already — this is its
	 * size, copied everywhere else). `size="small"` or `"medium"` on the
	 * icon itself, the wrapper decides the coin.
	 *
	 * ⛔ **`/`'s three severity sections are NOT all the list-row token, and
	 * that is a deliberate second context, not a leftover.** "Needs you now"
	 * (`h-10 w-10`, 40px) is a full action card — name, chip, an explanatory
	 * line, a button — one of at most a few on the page, and the disc is the
	 * card's lead glyph the way an `AlertPanel`'s 40px icon is. "In motion"
	 * and "Trailing"/"Steady" both carry `bakeStatus: 'Succeeded'` rows that
	 * CAN show a `state` mark, so those two are on the list-row token now
	 * (28px) like everything else. Do not shrink "Needs you now" to match —
	 * it was never part of this defect and doing so would quiet the one
	 * section that is supposed to be the loudest on the page.
	 */
	interface Props {
		bakeStatus?: string;
		size?: 'small' | 'medium' | 'large';
		class?: string;
		/**
		 * ⭐ COLOUR AND SHAPE ARE THE ONLY TWO CHANNELS THIS ATOM HAD, AND ONE
		 *    OF THEM IS INVISIBLE TO A SCREEN READER.
		 *
		 * A red-green colour-blind reader was already served — every status
		 * gets its OWN GLYPH (check / exclamation / clock / refresh / minus /
		 * pause), so the shape channel is intact. A non-visual reader was not:
		 * dumping the accessibility tree of `/rollouts` on 2026-08-30, the
		 * fifteen row links read `hello-api-app Hello Dep api DEV NEWEST
		 * 1.66.0-66 1d ago updated` — the rank, the build and the age, and NOT
		 * ONE WORD about whether the deploy succeeded, failed or is still
		 * baking. `bakeWord` already exists; the disc simply never spent it.
		 *
		 * The word is `sr-only` — absolutely positioned, zero layout, no
		 * tooltip — so `/`, `/rollouts` and rollout detail do not move a pixel.
		 * Pass `decorative` where the same word is already printed beside the
		 * disc, so the row is not read twice.
		 */
		decorative?: boolean;
		/**
		 * ⭐ THE DISC CARRIES THE STATE WHEN THE DEPLOY HAS NOTHING TO SAY.
		 *    (2026-08-31 — see `rollout-cards.ts`'s `cardStateMark`.)
		 *
		 * On `/` and `/rollouts` the precedence `rolled back` > `pinned` >
		 * rank was DELETING the rank: prod printed `ROLLED BACK 51b976a` with
		 * no number while it was the most-behind rollout in the fleet. The row
		 * cannot afford a third mark or a longer chip label — measured, a
		 * second word takes the app name's width to zero — but it is already
		 * spending this disc on a green tick repeated down a list of rollouts
		 * that are all `Succeeded` by construction. That is marking the norm.
		 *
		 * So a SETTLED deploy hands the disc to the state, and the chip keeps
		 * the number. The hue does not move: it is still the deploy's, from
		 * `getStatusCircleClass` at the call site and `TONE` here, because the
		 * deploy really did succeed.
		 *
		 * ⚠️ IGNORED unless `bakeStatus === 'Succeeded'`. A failed or in-flight
		 * deploy owns this disc; hiding a red `!` behind a lock is the same
		 * defect in the mirror.
		 *
		 * ⛔ `'held'` ADDED 2026-09-02 — a THIRD, LOWER-PRECEDENCE STATE, same
		 * reasoning as the two above. `rollout-cards.ts`'s `cardStateMark` only
		 * returns it when neither `rolled-back` nor `pinned` already claimed
		 * the slot: a newer build exists and no gate lets it through. Reuses
		 * `PauseSolid` (already imported for `bakeStatus === 'None'`, a
		 * disjoint branch of this same switch) rather than a new icon import —
		 * "promotion paused" is the honest read and it costs nothing new.
		 */
		state?: 'rolled-back' | 'pinned' | 'held' | null;
		/** The word for `sr-only`, when `state` is set. */
		stateWord?: string;
	}

	let {
		bakeStatus,
		size = 'medium',
		class: className = '',
		decorative = false,
		state = null,
		stateWord = ''
	}: Props = $props();

	const stateApplies = $derived(!!state && bakeStatus === 'Succeeded');

	// All icons (static and spinning) share the same h-_ w-_ footprint
	// at each size, so running rows on the activity rail don't read
	// bigger than settled ones. `small` is `h-4 w-4` (16px) which is
	// the smallest Flowbite `Spinner` accepts.
	const sizeClasses = {
		small: 'h-4 w-4',
		medium: 'h-6 w-6',
		large: 'h-8 w-8'
	};

	const spinnerSizes: Record<'small' | 'medium' | 'large', '4' | '6' | '8'> = {
		small: '4',
		medium: '6',
		large: '8'
	};

	// Literal class map, not a `text-${family}-600` template. Two reasons:
	// Tailwind cannot see an interpolated class name (these only ever got
	// generated because the same strings happened to appear elsewhere in
	// the source), and the status ink is a design token that should be
	// greppable. -700 rather than -600: it is the shade that clears 4.5:1
	// on white, and there is exactly ONE green in the product — this one —
	// which the `newest` rank chip also uses. Pending/None recedes to gray.
	// `yellow` is spent TWICE: by the static glyph below and — since the
	// contrast fix — by the InProgress bake mark's `currentColor`, so the
	// running bake and the settled bake print the same yellow.
	const TONE: Record<string, string> = {
		green: 'text-green-700 dark:text-green-400',
		red: 'text-red-700 dark:text-red-400',
		yellow: 'text-yellow-700 dark:text-yellow-400',
		blue: 'text-blue-700 dark:text-blue-400',
		gray: 'text-gray-500 dark:text-gray-400',
		// ⭐ THE GLYPH'S INK MOVES WITH THE FILL NOW. (2026-09-02, disc
		// histogram pass) `held` sits on `getStatusCircleClass`'s new
		// `orange-100`/`orange-950/70` field, so a green-700 pause glyph
		// would sit on an orange ground — the SAME ink `Chip`'s `rank` role
		// (`N behind`) already prints on its own `orange-100` block, reused
		// verbatim rather than picked again.
		orange: 'text-orange-950 dark:text-orange-300'
	};

	function getStatusConfig(status?: string) {
		const baseColor = getBakeStatusColor(status);
		const color = TONE[baseColor] ?? TONE.gray;

		switch (status) {
			case 'Succeeded':
				// ⛔ `rolled back` AND `held` NO LONGER INHERIT THE SUCCEEDED
				// GREEN INK. (2026-09-02) `color` above is `TONE.green` for every
				// `Succeeded` deploy, held or not — that was fine while every
				// settled disc shared one fill, and became a mismatch the moment
				// `getStatusCircleClass` gave `held` an orange field and
				// `rolled-back` a gray one: a green glyph on either ground reads
				// as a colour clash, not a state. Each state's ink now matches
				// its OWN fill's ground, from the same two call sites
				// (`bake-status.ts` and here) this component's own header
				// comment already names as the two places that spend these
				// hues — `pinned` is deliberately UNCHANGED (still green; see
				// `getStatusCircleClass`'s note on why it does not get a fourth
				// tint here).
				if (state === 'rolled-back') return { icon: UndoOutline, color: TONE.gray };
				if (state === 'pinned') return { icon: LockSolid, color };
				if (state === 'held') return { icon: PauseSolid, color: TONE.orange };
				return { icon: CheckCircleSolid, color };
			case 'Failed':
				return { icon: ExclamationCircleSolid, color };
			case 'InProgress':
				return { icon: ClockSolid, color };
			case 'Deploying':
				return { icon: RefreshOutline, color };
			case 'Cancelled':
				return { icon: CircleMinusSolid, color };
			case 'None':
				return { icon: PauseSolid, color };
			default:
				return { icon: ClockSolid, color };
		}
	}

	const statusInfo = $derived(getStatusConfig(bakeStatus));
	const Icon = $derived(statusInfo.icon);
</script>

<!-- In-flight states: Deploying is an actively-running deploy → rotating
     border spinner. InProgress is the bake window — the rollout is just
     watching health checks — → concentric dots radiating out, which reads
     as "passive watch" rather than "actively transferring".

     ⛔ THIS IS NOT `<Spinner type="pulse" color="yellow">` ANY MORE, AND IT
     MUST NOT GO BACK. Flowbite's pulse spinner is three circles that ALL
     animate `opacity: 0.9 → 0` while expanding, painted `fill-yellow-400`,
     with `animate-pulse` (a second 1 → 0.5 opacity fade) stacked on the
     `<svg>` on top of that. It therefore has NO mark that is present at
     rest, and its brightest instant measured **1.05–1.41:1 in light** on
     the `bg-yellow-100` status disc — the icon a reader looks at to know
     something is baking right now was effectively invisible on `/`,
     `/rollouts`, rollout detail, `/apps` and `/envs`. The 2026-08-30
     contrast sweep never caught it because no rollout was mid-bake on the
     live cluster while it ran.

     Two things fix it and both are free:
     · a SOLID CORE at full opacity, so the mark can never fall below its
       floor mid-cycle — this is exactly why the blue `Deploying` spinner
       passed (its `border-t` arc is opaque) and this one did not;
     · the LIGHT ink steps `yellow-400` → `yellow-700`, which is `TONE.yellow`,
       the ink this component's own static yellow glyph already prints. Zero
       new colour values, and baking stays YELLOW — it does not drift toward
       amber or toward the blue that `Deploying` owns.
     The radiating waves keep Flowbite's original geometry and rhythm
     (r 18→46, 1.5s, three waves 0.5s apart) so the motion is unchanged. -->
{#if !decorative}
	<span class="sr-only">{bakeWord(bakeStatus)}{stateApplies && stateWord ? `, ${stateWord}` : ''}</span>
{/if}
{#if bakeStatus === 'InProgress'}
	<svg
		class="{sizeClasses[size]} shrink-0 {TONE.yellow} {className}"
		viewBox="0 0 100 100"
		aria-hidden="true"
	>
		{#each [0, 0.5, 1] as begin (begin)}
			<circle cx="50" cy="50" r="18" fill="currentColor" opacity="0">
				<animate
					attributeName="r"
					values="18;46"
					begin="{begin}s"
					dur="1.5s"
					repeatCount="indefinite"
				/>
				<animate
					attributeName="opacity"
					values="0.5;0"
					begin="{begin}s"
					dur="1.5s"
					repeatCount="indefinite"
				/>
			</circle>
		{/each}
		<circle cx="50" cy="50" r="18" fill="currentColor" />
	</svg>
{:else if bakeStatus === 'Deploying'}
	<StatusSpinner color="blue" size={spinnerSizes[size]} class={className} />
{:else}
	<Icon class="{sizeClasses[size]} {statusInfo.color} {className}" />
{/if}
