<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE COMPACT FORM'S ONLY ATOM. CHANGES-2026-09-10.md §2a.
	 *
	 * ⛔ IT IS NOT AN ENV CHIP. `Chip role="env"`'s colour is a function of
	 * the environment's NAME and nothing else — that invariant is not bent
	 * here. A `LandingMark` is a STATE mark that NAMES its environment: state
	 * lives in the two channels the product already spends on state
	 * everywhere else (the glyph, from `BakeStatusIcon`'s own vocabulary, and
	 * the tinted field, from `getStatusCircleClass`'s own values), while
	 * identity — the ring and the word's ink — never moves.
	 *
	 * The word is the environment's FAMILY (`DEV`/`STG`/`PRD`/`TEST`, or a
	 * 3-letter fallback — `envFamilyWord` in `version-utils.ts`), never the
	 * raw name: `.chip`'s real budget is 8.5 characters and
	 * `hello-world-staging` (19 chars) would otherwise destroy three prod
	 * regions into one indistinguishable truncated string. The full name
	 * always survives in `title` (via `sentence`, which `landing-grid.ts`
	 * already threads the real env name through) — never silently dropped.
	 *
	 * ⚠️ Deliberately NOT a run of dots (`fleet-fixture.ts`'s header records
	 * the human rejecting exactly that — "still not clear what it shows").
	 * Every mark names its own environment in words.
	 *
	 * ── WHY AN `<a>`, WHEN THE DESIGN DOC SAYS "THE MARK IS NOT A CONTROL" ──
	 *
	 * That line is about HIT-TARGET SIZE, not about whether the mark links
	 * anywhere — the design doc's own mark shape carries an `href` (the
	 * rollout page for the mark's worst region), and the ROW around this
	 * component is what must satisfy the 44px tap target, via padding, not
	 * by this atom growing an invisible hit-area of its own. This lets a
	 * reader who wants the ONE region a mark represents jump straight to its
	 * rollout, while the row's own `.tap-link` still goes to the change page.
	 */
	import type { EnvironmentTheme } from '$lib/environment-theme';
	import type { PrState } from '$lib/view-models/pr-pipeline';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		PauseSolid,
		CircleMinusSolid,
		RefreshOutline,
		UndoOutline,
		LockSolid,
		MinusOutline,
		ArrowRightOutline
	} from 'flowbite-svelte-icons';

	let {
		family,
		count = 1,
		state,
		sentence,
		href,
		theme = null,
		class: className = ''
	}: {
		/** `DEV` / `STG` / `PRD` / `TEST`, or a 3-letter fallback. */
		family: string;
		/** Regions collapsed into this mark. >1 draws the superscript count. */
		count?: number;
		state: PrState;
		/** The full state sentence (every collapsed region, named) — `title`
		 *  and the accessible name both read from this. */
		sentence: string;
		href: string;
		/** Ring + word ink. `null` renders a neutral identity-less hairline
		 *  (no `EnvironmentTheme` resolved for any region in this mark). */
		theme?: EnvironmentTheme | null;
		class?: string;
	} = $props();

	// ── THE STATE TABLE. CHANGES-2026-09-10.md §2a — every glyph and field
	// below is already shipped elsewhere (`BakeStatusIcon`, `bake-status.ts`,
	// `getStatusCircleClass`); nothing new is mixed. `live` and `not-built`
	// are the two norms and neither takes a field — "mark the deviation,
	// never the norm".
	const GLYPH = {
		live: CheckCircleSolid,
		deploying: RefreshOutline,
		baking: ClockSolid,
		retrying: RefreshOutline,
		gated: PauseSolid,
		'waiting-upstream': PauseSolid,
		pinned: LockSolid,
		failed: ExclamationCircleSolid,
		cancelled: CircleMinusSolid,
		'rolled-back': UndoOutline,
		promoting: ArrowRightOutline,
		// ⭐ FIX PASS ITEM 4 (2026-09-10). Same glyph as `promoting` — the SAME
		// neutral "will move once its turn comes" semantic, no new shape
		// mixed into the closed vocabulary.
		queued: ArrowRightOutline,
		'not-built': MinusOutline
	} as const satisfies Record<PrState, unknown>;

	// Ink: `tone-live`/`tone-active`/`tone-bad` are the product's own global
	// glyph inks (`app.css`); yellow/orange are `BakeStatusIcon`'s own
	// `TONE.yellow`/`TONE.orange` values, copied verbatim (that component
	// scopes them to a literal class map for the same reason — Tailwind
	// cannot see an interpolated class name).
	const GLYPH_INK: Record<PrState, string> = {
		live: 'tone-live',
		deploying: 'tone-active',
		baking: 'text-yellow-700 dark:text-yellow-400',
		retrying: 'text-yellow-700 dark:text-yellow-400',
		gated: 'text-orange-950 dark:text-orange-300',
		'waiting-upstream': 'text-orange-950 dark:text-orange-300',
		pinned: 'text-orange-950 dark:text-orange-300',
		failed: 'tone-bad',
		cancelled: 'tone-mute',
		'rolled-back': 'tone-mute',
		promoting: 'tone-mute',
		// ⭐ FIX PASS ITEM 4. Neutral, same as `promoting` — never the amber
		// `waiting-upstream`/`gated`/`pinned` ink. Amber is reserved for
		// `stuck`; a normal promotion-order wait is not that.
		queued: 'tone-mute',
		'not-built': 'text-gray-400 dark:text-gray-500'
	};

	// Field: the tinted ground `getStatusCircleClass` already gives each
	// state (held reuses its exact `orange-100`/`orange-950/70`). `live` and
	// `not-built` take none — the two norms, drawn as a plain tick and a
	// dashed empty box.
	const FIELD: Record<PrState, string> = {
		live: '',
		deploying: 'bg-blue-50 dark:bg-blue-950/40',
		baking: 'bg-yellow-50 dark:bg-yellow-950/40',
		retrying: 'bg-yellow-50 dark:bg-yellow-950/40',
		gated: 'bg-orange-100 dark:bg-orange-950/70',
		'waiting-upstream': 'bg-orange-100 dark:bg-orange-950/70',
		pinned: 'bg-orange-100 dark:bg-orange-950/70',
		failed: 'bg-red-50 dark:bg-red-950/50',
		cancelled: 'bg-gray-100 dark:bg-gray-800',
		'rolled-back': 'bg-gray-100 dark:bg-gray-800',
		promoting: '',
		// ⭐ FIX PASS ITEM 4. No field, same as `promoting` — the amber
		// `bg-orange-100`/`bg-orange-950/70` field is reserved for a GENUINE
		// stuck dependency (`waiting-upstream`/`gated`/`pinned`), never a
		// normal, expected promotion-order wait.
		queued: '',
		'not-built': ''
	};

	const STATE_WORD: Record<PrState, string> = {
		live: 'live',
		deploying: 'deploying',
		baking: 'baking',
		retrying: 'retrying',
		gated: 'held',
		'waiting-upstream': 'held',
		pinned: 'pinned',
		failed: 'failed',
		cancelled: 'cancelled',
		'rolled-back': 'rolled back',
		promoting: 'promoting',
		queued: 'queued',
		'not-built': 'not built'
	};

	const Icon = $derived(GLYPH[state]);
	// `not-built` is the ONLY dashed ring — the other 11 states are solid.
	// See the state table's own header: "not-built needed a shape, not a hue."
	const dashed = $derived(state === 'not-built');
	// ⛔ FIX PASS ITEM 3, 2026-09-10 — HELD IS THE ONE FIELD IDENTITY INK
	// MEASURES BADLY AGAINST. Canvas-resolved: DEV's identity green
	// (`#008236`, `PRESET_RAMPS.dev.textColor`) on the held field
	// (`orange-100`) is 4.31:1 in light — under the 4.5 floor, the one
	// combination this state table's own accept criterion names
	// ("held word ink ≥4.5:1 on its field in light"). STG/PRD's identity
	// inks clear it fine (8.0/7.9) but a per-environment carve-out would be
	// a second spelling of the same rule, so the darkening below applies to
	// every environment's word ink on the held field alike — 10% toward
	// black is enough to take DEV to 5.1:1 and only adds headroom to the
	// two that already passed. Dark mode is untouched (15-19:1 already).
	const held = $derived(state === 'gated' || state === 'waiting-upstream' || state === 'pinned');

	const accessibleLabel = $derived(
		`${family}${count > 1 ? ` × ${count}` : ''}, ${STATE_WORD[state]}: ${sentence}`
	);

	// Ring + word ink are IDENTITY, so they read off `theme` — never off
	// `state` — via custom properties, because `theme`'s colours are
	// per-environment hex, not a closed Tailwind class set the way state's
	// six values are. `null` (no theme resolved) falls back to a plain
	// neutral hairline in the scoped CSS below.
	const themeStyle = $derived(
		theme
			? `--lm-ring: ${theme.borderColor}; --lm-ring-dark: ${theme.darkBorderColor}; --lm-word: ${theme.textColor}; --lm-word-dark: ${theme.darkTextColor};`
			: ''
	);
</script>

<a
	class="lm {FIELD[state]} {className}"
	class:lm--dashed={dashed}
	class:lm--themed={!!theme}
	class:lm--held={held}
	style={themeStyle}
	{href}
	title={sentence}
	aria-label={accessibleLabel}
>
	<Icon class="lm-glyph {GLYPH_INK[state]}" aria-hidden="true" />
	<span class="lm-word"
		>{family}{#if count > 1}<sup class="lm-count">{count}</sup>{/if}</span
	>
</a>

<style>
	/* GEOMETRY — one declaration, CHANGES-2026-09-10.md §2a's own table.
	   18px tall, 4px radius (the chip radius — 8/12px are cards), 0 4px
	   padding, 3px glyph→word gap. */
	.lm {
		display: inline-flex;
		align-items: center;
		height: 18px;
		padding: 0 4px;
		gap: 3px;
		border-radius: 4px;
		border: 1px solid var(--color-gray-300);
		text-decoration: none;
		box-sizing: border-box;
		line-height: 1;
	}

	:global(.dark) .lm {
		border-color: var(--color-gray-600);
	}

	/* Identity ring, when a theme resolved. Solid by default; `not-built`
	   switches to dashed below. */
	.lm--themed {
		border-color: var(--lm-ring);
	}

	:global(.dark) .lm--themed {
		border-color: var(--lm-ring-dark);
	}

	/* `not-built` — the one DASHED ring. ⛔ FIX PASS ITEM 3, 2026-09-10 (ROUND
	   2) — "colour is state only": the previous cut still derived this ring
	   from `--lm-word`/`--lm-ring` (the mark's IDENTITY colour), so a
	   not-built DEV/STG/PRD mark drew a green/purple/amber dashed ring —
	   the exact defect the human flagged live ("the not-built dashed ring
	   still carries the environment hue"). `not-built` has no build to have
	   an identity-tinted OUTCOME for; it is the one state this mark draws
	   with NO colour at all — flat gray, in both themes, regardless of
	   whether a theme resolved (`.lm--dashed` alone, not gated behind
	   `.lm--themed`). The environment is still legible — the WORD's TEXT
	   ("PRD") — just not through colour. `gray-500`/white ≈ 4.8:1, `gray-400`/
	   `gray-900` ≈ 7.0:1: comfortably past the state table's own "dashed
	   ring ≥ 3:1" floor in both themes. */
	.lm--dashed {
		border-style: dashed;
		border-color: var(--color-gray-500);
	}

	:global(.dark) .lm--dashed {
		border-color: var(--color-gray-400);
	}

	/* ⛔ FIX PASS ITEM 3, 2026-09-10 — `:global`, NOT SCOPED. `<Icon>` is a
	   flowbite-svelte-icons component; the class we pass through lands on
	   ITS OWN `<svg>`, which never receives THIS component's scope-hash
	   attribute (Svelte only stamps that hash on elements written literally
	   in this component's own template). A scoped `.lm-glyph` selector
	   therefore matched nothing, ever, and every glyph rendered at the
	   icon's own default `size="md"` (`w-5 h-5`, i.e. 20px) inside a mark
	   sized for 12px — the marks measured 56px wide at ~44px's budget.
	   `:global(.lm-glyph)` matches the class wherever it lands, in the
	   child's DOM, and wins the cascade over the icon's own `w-5 h-5`. */
	:global(.lm-glyph) {
		height: 12px;
		width: 12px;
		flex-shrink: 0;
	}

	/* Word ink is IDENTITY too (the theme's own text colour), unchanged by
	   state — a neutral fallback when no theme resolved. 10px/600/uppercase/
	   0.02em is this mark's OWN type, deliberately not `.t-chip` (which is
	   mono at 0.08em tracking — `.chip`'s own word, not this one's). */
	.lm-word {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: var(--color-gray-700);
		white-space: nowrap;
	}

	:global(.dark) .lm-word {
		color: var(--color-gray-300);
	}

	.lm--themed .lm-word {
		color: var(--lm-word);
	}

	:global(.dark) .lm--themed .lm-word {
		color: var(--lm-word-dark);
	}

	/* `not-built`'s word, same ruling as its ring above: no identity colour,
	   flat gray in both themes — falls back to exactly the SAME value
	   `.lm-word`'s own no-theme default already uses (already ≥4.5:1 in
	   both themes, per L1's own accept criterion), so this is a plain
	   override of `.lm--themed .lm-word` rather than a third ink to
	   maintain. Source order (after `.lm--themed .lm-word` above) breaks
	   the specificity tie. */
	.lm--dashed.lm--themed .lm-word {
		color: var(--color-gray-700);
	}

	:global(.dark) .lm--dashed.lm--themed .lm-word {
		color: var(--color-gray-300);
	}

	/* HELD, LIGHT ONLY — canvas-measured floor. `:global(html:not(.dark))`
	   rather than fighting cascade order against the rule above: a mutually
	   exclusive selector on the root, so light and dark can never both
	   apply. See the `held` derivation above for the numbers. */
	:global(html:not(.dark)) .lm--held.lm--themed .lm-word {
		color: color-mix(in srgb, var(--lm-word) 90%, black 10%);
	}

	.lm-count {
		font-size: 8px;
		line-height: 1;
		margin-left: 1px;
	}

	.lm:focus-visible {
		outline: 2px solid var(--color-blue-500);
		outline-offset: 1px;
	}
</style>
