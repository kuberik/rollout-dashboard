<svelte:options runes={true} />

<!--
	Datadog Logo Component

	TRADEMARK NOTICE:
	The Datadog logo and "Bits" are trademarks of Datadog, Inc.
	This component uses official Datadog icon assets in compliance with Datadog's brand guidelines.

	Usage Guidelines:
	- Use white logo on dark/gray backgrounds (variant="white")
	- Use RGB/purple logo on light backgrounds (variant="rgb")
	- Do not modify, invert, or alter the logo's colors, aspect ratio, or proportions
	- Do not contain the logo in a box or shape, use gradients, or outline the logo

	For detailed brand guidelines and official logo assets, refer to:
	https://www.datadoghq.com/about/resources/

	This component is provided for integration purposes only and must be used in accordance
	with Datadog's trademark and brand usage policies.
-->

<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';
	import ddIconWhiteRaw from '$lib/assets/dd_icon_white.svg?raw';
	import ddIconRgbRaw from '$lib/assets/dd_icon_rgb.svg?raw';

	/**
	 * ⛔ AN INLINE SVG'S OWN STYLE ELEMENT IS DOCUMENT-GLOBAL, AND BOTH
	 * ASSETS NAME THEIR ONE CLASS `.st0`. (2026-09-10)
	 *
	 * These are Illustrator exports and each carries its fill in a stylesheet
	 * rather than on the element:
	 *
	 *   dd_icon_rgb.svg    `.st0{fill-rule:evenodd;clip-rule:evenodd;fill:#632CA6;}`
	 *   dd_icon_white.svg  `.st0{fill:#FFFFFF;}`
	 *
	 * `{@html}` puts those style elements in the DOM, and an SVG style element
	 * is NOT scoped to its own `<svg>` — it is a stylesheet for the whole
	 * document. So the two rules are the same selector, and whichever asset
	 * renders LAST wins for every Datadog mark on the page at once. Measured:
	 * with both variants mounted, `getComputedStyle(path).fill` came back
	 * `rgb(255,255,255)` on BOTH — the purple asset rendered white. The
	 * per-theme `variant` below could not have worked while this stood, and
	 * neither could an explicit `variant="rgb"` on any page that also drew a
	 * white one.
	 *
	 * So the declarations are moved onto the elements that carry the class and
	 * the style element is dropped. ⚠️ THIS RECOLOURS NOTHING: each element
	 * ends up with the EXACT declarations its own asset's rule already gave it
	 * (`fill-rule` and `clip-rule` included), just as a `style` attribute
	 * instead of a global rule — same rendered pixels, no inversion, no
	 * gradient, so the trademark terms in the header still hold. Neither asset
	 * has an element carrying both `class` and `style`, so this can never
	 * produce a duplicate attribute; it runs once at module scope.
	 */
	function inlineExportedStyles(raw: string): string {
		const rules = new Map<string, string>();
		// ⚠️ THE TAG NAME IS ASSEMBLED, NOT WRITTEN OUT. `svelte-check`'s own
		// scanner (svelte2tsx) treats a literal closing style tag anywhere in
		// this file as the end of a style element, loses the `<script>`
		// boundary and reports ``<script>` was left open`` at the last line —
		// while Svelte's real parser accepts the file. Composing the name keeps
		// both happy; the compiled regex is identical.
		const S = 'st' + 'yle';
		const blockRe = new RegExp('<' + S + '\\b[^>]*>([\\s\\S]*?)</' + S + '>', 'g');
		const withoutStyleBlock = raw.replace(blockRe, (_all: string, css: string) => {
			for (const [, cls, decls] of css.matchAll(/\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g)) {
				rules.set(cls, decls.trim().replace(/;$/, ''));
			}
			return '';
		});
		return withoutStyleBlock.replace(/class="([^"]*)"/g, (all, names: string) => {
			const decls = names
				.trim()
				.split(/\s+/)
				.map((n) => rules.get(n))
				.filter((d): d is string => !!d);
			return decls.length ? `style="${decls.join(';')}"` : all;
		});
	}

	const ddIconWhite = inlineExportedStyles(ddIconWhiteRaw);
	const ddIconRgb = inlineExportedStyles(ddIconRgbRaw);

	interface Props extends SVGAttributes<SVGElement> {
		color?: string;
		/**
		 * ⛔ `auto` IS THE DEFAULT, AND THE OLD DEFAULT WAS `white` — WHICH
		 * MADE THE MARK INVISIBLE IN LIGHT THEME ON EVERY CALL SITE.
		 * (2026-09-10)
		 *
		 * Not one of the five call sites passed `variant`, so all five took
		 * `white`, and the asset's fill is a LITERAL `#FFFFFF` in the file
		 * (`.st0{fill:#FFFFFF}`) — no `currentColor` to inherit. Measured in
		 * light theme on rollout detail: the `Logs`/`CI`/`Trace` glyph is
		 * `rgb(255,255,255)` on an `oklab(0.985 …)` ground, i.e. white on
		 * white. One call site even passed `text-[#632CA6]` to try to colour
		 * it, which a hardcoded `fill` cannot see.
		 *
		 * The fix is the component's OWN usage guidance above, which the call
		 * sites simply never got to apply: white on dark grounds, RGB/purple
		 * on light ones. Because theme is a runtime toggle and not a build
		 * flag, `auto` renders BOTH official assets and lets `dark:` decide
		 * which one is displayed — no recolouring, no inversion, no gradient,
		 * so it stays inside the trademark terms in both themes. Pass `white`
		 * or `rgb` explicitly only for a ground whose lightness does not
		 * follow the theme.
		 */
		variant?: 'white' | 'rgb' | 'auto';
	}

	let { class: className, color, variant = 'auto', ...restProps }: Props = $props();

	const classString = $derived(
		typeof className === 'string' ? className : className ? String(className) : ''
	);
	// `[&>svg]` reaches the ONE svg each of these wrappers holds; in the `auto`
	// form each theme's asset gets its own wrapper so the selector still means
	// exactly one element and the sizing rules are unchanged.
	const svgFit = '[&>svg]:h-full [&>svg]:max-h-full [&>svg]:w-full [&>svg]:max-w-full';
</script>

<!--
	⚠️ `aria-hidden`, FOR TWO REASONS, AND THE FIRST ONE IS NOT COSMETIC.
	Because `{@html}` put the exports' own style element in the DOM, its CSS
	TEXT counted toward the accessible name of whatever contained the logo:
	measured on rollout detail, the `Logs` link's own `textContent` read
	`.st0{fill:#FFFFFF;}\n\n\n\nLogs`. `inlineExportedStyles` already removes
	that element, so the name is clean on its own now — and the mark is still
	`aria-hidden` on the plain merit that it sits beside a text label at every
	call site, so the label is the name and the logo is decoration.
-->
{#if variant === 'auto'}
	<div class="flex items-center justify-center {classString}" aria-hidden="true">
		<div class="flex h-full w-full items-center justify-center dark:hidden {svgFit}">
			{@html ddIconRgb}
		</div>
		<div class="hidden h-full w-full items-center justify-center dark:flex {svgFit}">
			{@html ddIconWhite}
		</div>
	</div>
{:else}
	<div class="flex items-center justify-center {classString} {svgFit}" aria-hidden="true">
		{@html variant === 'white' ? ddIconWhite : ddIconRgb}
	</div>
{/if}
