<svelte:options runes={true} />

<script lang="ts">
	/**
	 * StarToggle: the one control that stars an app for this browser.
	 *
	 * ROLE. A two-state toggle beside an app's NAME (Home's app rows, the
	 * `/apps/<name>` header, rollout detail's header). Starred apps get their
	 * own tier on Home; nothing else changes. State lives in
	 * `$lib/stores/stars.svelte` (localStorage `kuberik.home.starred`), so every
	 * StarToggle for the same app, on any page and in any tab, agrees.
	 *
	 * WHY NOTHING EXISTING FITS. `Chip` is a status word, `.pill-btn` is a
	 * filter that carries a label, `.btn` is an action with words and a 36px
	 * box. A star is none of those: it is a bare glyph whose STATE is its whole
	 * message (outline = not starred, filled = starred), it must sit on a
	 * title's line without changing that line's height, and it is pressed far
	 * more rarely than it is read. So it is a new, deliberately tiny object.
	 *
	 * PROPORTIONS, BORROWED. The glyph is 16px, the size of the product's other
	 * inline icons beside a title (`ReplyOutline h-4 w-4` in RolloutTabHeader,
	 * `PageHeader`'s identity row). The hit area is the product's small-control
	 * idiom `.hit-32` (app.css): a 32px floor drawn by an invisible `::before`,
	 * the same one chip links and chevrons use, so the visible box never grows.
	 * The focus ring is the product's base `:focus-visible` outline
	 * (`--focus-ring-color`, 2px, offset 2), with a 4px radius (the small-radius
	 * step).
	 *
	 * ⛔ COLOUR: THE TOGGLE RULE, NEVER A HUE. (2026-10-25, design review.) The
	 * star first filled with `warning-solid`, which is the STUCK chip's amber
	 * exactly (dE00 0.0), and "amber = stuck, and nothing else". A star is a
	 * toggle, and a selected toggle in this product is ink: `--k-inverse`
	 * (gray-900 light, gray-100 dark), the fill `.pill[aria-pressed='true']`
	 * wears (language.css). So starred = a FILLED star in `text-inverse`
	 * (fill and edge one colour); not starred = an OUTLINE in `fg-subtle`
	 * (`fg-muted` on hover). State reads from fill vs outline, not from colour,
	 * and both inks hold at least 3:1 on the surface in both themes.
	 *
	 * INSIDE A `.tap-zone` ROW it is raised above the row's overlay by
	 * app.css's own rule (every `button` in a tap zone that is not the
	 * `.tap-link` gets `position: relative; z-index: 1`), so a click on the star
	 * stars, and a click anywhere else on the row still navigates.
	 *
	 * NO OUTER MARGIN: the caller owns spacing (a component never owns its
	 * outer margin). Pass `class` for alignment (e.g. `self-center` on a
	 * baseline row).
	 *
	 * A11Y. A real `<button aria-pressed>`; Tab reaches it, Enter and Space
	 * toggle it. The accessible name is CONSTANT ("Star <app>") and
	 * `aria-pressed` carries the state, which is how a toggle button is
	 * announced ("Star orders-api, toggle button, pressed"). Swapping the name
	 * to "Unstar" as well would announce the state twice and inverted
	 * ("Unstar orders-api, pressed"). The tooltip (`title`) names the ACTION a
	 * click takes, "Star …" or "Unstar …", for the pointer reader who has no
	 * `aria-pressed`.
	 */
	import { isStarred, toggleStar } from '$lib/stores/stars.svelte';
	import * as m from '$lib/paraglide/messages';

	let { app, class: className = '' }: { app: string; class?: string } = $props();

	const on = $derived(isStarred(app));
</script>

<button
	type="button"
	class="star-toggle hit-32 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] {on
		? 'text-inverse'
		: 'text-fg-subtle hover:text-fg-muted'} {className}"
	aria-pressed={on}
	aria-label={m.star_star({ app })}
	title={on ? m.star_unstar({ app }) : m.star_star({ app })}
	data-starred={on ? 'true' : 'false'}
	onclick={() => toggleStar(app)}
>
	<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" class="block">
		<path
			d="M8 1.6l1.93 3.92 4.32.63-3.13 3.05.74 4.3L8 11.47l-3.86 2.03.74-4.3L1.75 6.15l4.32-.63L8 1.6z"
			fill={on ? 'currentColor' : 'none'}
			stroke="currentColor"
			stroke-width="1.25"
			stroke-linejoin="round"
		/>
	</svg>
</button>
