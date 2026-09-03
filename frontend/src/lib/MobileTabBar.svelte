<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { HomeOutline, GridOutline, RocketOutline, LayersSolid, ClockOutline, TagOutline } from 'flowbite-svelte-icons';

	const tabs = [
		{ key: 'control', href: '/', label: 'Home', icon: HomeOutline },
		{ key: 'rollouts', href: '/rollouts', label: 'Rollouts', icon: GridOutline },
		{ key: 'apps', href: '/apps', label: 'Apps', icon: RocketOutline },
		{ key: 'envs', href: '/environments', label: 'Envs', icon: LayersSolid },
		{ key: 'revisions', href: '/revisions', label: 'Revisions', icon: TagOutline },
		{ key: 'activity', href: '/activity', label: 'Activity', icon: ClockOutline }
	] as const;

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/') return path === '/';
		if (href === '/rollouts') return path === '/rollouts' || path.startsWith('/rollouts/') || path.startsWith('/namespaces/');
		if (href === '/environments') return path === '/environments' || path.startsWith('/envs/');
		return path === href || path.startsWith(href + '/');
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
</script>

<nav
	class="safe-area-bottom sticky bottom-0 z-40 flex w-full shrink-0 items-stretch border-t border-gray-200 bg-white/95 backdrop-blur dark:border-gray-700 dark:bg-gray-800/95 sm:hidden {dialogOpen
		? 'invisible'
		: ''}"
	aria-label="Main navigation"
	aria-hidden={dialogOpen ? 'true' : undefined}
>
	{#each tabs as t (t.key)}
		{@const active = isActive(t.href)}
		<a
			href={t.href}
			aria-current={active ? 'page' : undefined}
			aria-label={t.label}
			tabindex={dialogOpen ? -1 : undefined}
			class="flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium transition-colors
				{active
					? 'text-blue-600 dark:text-blue-400'
					: 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}"
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
