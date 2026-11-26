<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { href, appPath } from '$lib/paths';
	import { NAV_ICON } from '$lib/nav-icons';

	/**
	 * ⛔ U-13 (2026-10-08, polish pass) — the TL's ruling (lib/CLAUDE.md,
	 * "the vocabulary decision, continued" (f)) is "Environments," full
	 * word, nav section included if it fits at 360. It does not fit here.
	 * Measured live at 360×740 (own playwright-core, 6 equal `flex-1` tabs,
	 * each a 57.5px column): substituting "Environments" for "Envs" renders
	 * the label at 69px — wider than its own 57.5px column — which either
	 * clips the word mid-letter or (since no sibling has slack to give up;
	 * every tab is already at its own content-free minimum) pushes the
	 * whole bar wider than the viewport, the exact D-1 defect ("the
	 * Activity tab ends past the screen edge") this pass is also fixing.
	 * `Envs` is kept, abbreviated, specifically here — nowhere else in the
	 * product abbreviates the environments section name.
	 */
	const tabs = [
		{ key: 'control', href: '/', label: 'Home', icon: NAV_ICON['/'] },
		{ key: 'rollouts', href: '/rollouts', label: 'Rollouts', icon: NAV_ICON['/rollouts'] },
		{ key: 'apps', href: '/apps', label: 'Apps', icon: NAV_ICON['/apps'] },
		{ key: 'envs', href: '/environments', label: 'Envs', icon: NAV_ICON['/environments'] },
		// Five items: six clipped `Activity` at 390 (AD round 1). Activity stays
		// one tap away from Home's Recent activity card.
		{ key: 'changes', href: '/changes', label: 'Changes', icon: NAV_ICON['/changes'] }
	] as const;
	function isActive(navHref: string): boolean {
		const path = appPath(page.url.pathname);
		if (navHref === '/') return path === '/';
		if (navHref === '/rollouts') return path === '/rollouts' || path.startsWith('/rollouts/') || path.startsWith('/namespaces/');
		if (navHref === '/environments') return path === '/environments' || path.startsWith('/envs/');
		return path === navHref || path.startsWith(navHref + '/');
	}

	/**
	 * ⛔ P10, OPERATOR-WALK FINDING (2026-09-03, cosmetic): "the bottom tab
	 * bar draws on top of open modals at 390 and stays tappable."
	 *
	 * `z-40` is enough to sit above ordinary page content, but this bar is
	 * `sticky`, not `fixed` inside a portal, and every dialog in the product
	 * is opened from a DIFFERENT component the tab bar knows nothing about —
	 * a stacking-context guess here (a bigger `z-*`) cannot be correct for
	 * dialogs that render later, in a different subtree, or with no explicit
	 * `z-index` of their own (an implicit stacking context loses to an
	 * explicit one regardless of DOM order). Rather than trying to out-rank
	 * every dialog this product has or will ever add, this bar checks
	 * whether one is actually open and gets out of the way — the same
	 * question a screen reader already asks via `aria-modal`.
	 *
	 * `[role="dialog"][aria-modal="true"]` covers flowbite's `<Modal>` (see
	 * `ClearPinModal.svelte`'s own note: `role`/`aria-modal` flow through
	 * `restProps` onto the underlying element) and `dialog[open]` covers a
	 * native `<dialog>` directly, so this needs no per-component wiring and
	 * cannot go stale as new dialogs are added.
	 *
	 * A `MutationObserver` on `document.body`, not a poll: dialogs open and
	 * close far less often than any reasonable interval would fire, so
	 * polling would either lag the open/close or burn cycles for nothing.
	 */
	let dialogOpen = $state(false);

	function hasOpenDialog(): boolean {
		return !!document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]');
	}

	$effect(() => {
		if (typeof document === 'undefined') return;
		dialogOpen = hasOpenDialog();
		const observer = new MutationObserver(() => {
			dialogOpen = hasOpenDialog();
		});
		observer.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['open', 'aria-modal', 'role']
		});
		return () => observer.disconnect();
	});

	/**
	 * ⭐ THE BAR'S OWN RENDERED HEIGHT, PUBLISHED AS A CSS VARIABLE.
	 * (2026-09-03, scroll model rewrite) Now that `position: fixed` (below)
	 * takes this bar out of the document's normal flow entirely, nothing
	 * reserves the space it occupies at the bottom of the viewport — the
	 * document's own last row would render straight underneath it. `app.css`
	 * reads `--tabbar-h` as `body`'s `padding-bottom`, so the clearance is
	 * always exactly this bar's real height (its own `env(safe-area-inset-
	 * bottom)` padding included, since that is measured, not guessed) rather
	 * than a hand-picked constant that drifts the next time this bar's
	 * content changes. It is 0 at `sm:hidden` widths — `getBoundingClientRect`
	 * on a `display: none` element is a zero-size rect — so the padding
	 * disappears above `sm` with no media query of its own needed.
	 */
	let navEl: HTMLElement | undefined = $state();

	$effect(() => {
		if (typeof document === 'undefined' || !navEl) return;
		const el = navEl;
		function measure() {
			document.documentElement.style.setProperty('--tabbar-h', `${el.getBoundingClientRect().height}px`);
		}
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		window.addEventListener('resize', measure);
		return () => {
			ro.disconnect();
			window.removeEventListener('resize', measure);
		};
	});
</script>

<!-- ⭐ `fixed`, NOT `sticky`. (2026-09-03, scroll model rewrite) `sticky
     bottom-0` stuck against `<main>`, the old model's ONE scroll container.
     Now that the DOCUMENT scrolls (see `app.css`), the nearest scrolling
     ancestor for a `sticky` element here would be the document itself —
     which means `sticky bottom-0` would only ever reach the bottom of the
     PAGE, not stay pinned to the bottom of the VIEWPORT while a short page
     scrolls under it. `fixed` pins it to the viewport unconditionally,
     which is what a bottom tab bar means everywhere else. -->
<nav
	bind:this={navEl}
	class="safe-area-bottom fixed bottom-0 left-0 right-0 z-40 flex items-stretch border-t border-line bg-ground sm:hidden {dialogOpen
		? 'invisible'
		: ''}"
	aria-label="Main navigation"
	aria-hidden={dialogOpen ? 'true' : undefined}
>
	{#each tabs as t (t.key)}
		{@const active = isActive(t.href)}
		<a
			href={href(t.href)}
			aria-current={active ? 'page' : undefined}
			aria-label={t.label}
			tabindex={dialogOpen ? -1 : undefined}
			class="flex flex-1 flex-col items-center justify-center t-ui-sm gap-1 px-1 py-2 transition-colors
				{active
					? 'text-accent-text'
					: 'text-fg-subtle hover:text-fg'}"
		>
			<t.icon class="h-5 w-5" />
			<span>{t.label}</span>
		</a>
	{/each}
</nav>

<style>
	.safe-area-bottom {
		padding-bottom: env(safe-area-inset-bottom, 0);
	}
</style>
