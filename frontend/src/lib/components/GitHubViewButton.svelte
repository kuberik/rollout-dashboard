<script lang="ts">
	/**
	 * ⭐ `.btn btn-secondary`, NOT A FLOWBITE `<Button>`. (2026-10-09, TL
	 * review round 4, design-review-5.) Measured on the History tab's
	 * expanded row: this rendered flowbite's own `rounded-lg` pill shape
	 * beside two square `.btn` controls ("Roll back", "Copy tag") — one
	 * button grammar on a row that otherwise only has one. `class` stays a
	 * LAYOUT-ONLY escape hatch (now redundant with `.btn`'s own fixed
	 * radius, kept only so no call site needs to drop a stray class), and
	 * `size`/`color` keep their exact prop shape so every existing call
	 * site (History's expanded row, `/apps/[name]`'s build-row actions)
	 * is unchanged at the call site — only what gets drawn moves onto the
	 * shared button.
	 */
	import { gitRef } from '$lib/git-ref';
	import { sourceTreeUrl } from '$lib/source-url';
	import { GithubSolid } from 'flowbite-svelte-icons';

	export let sourceUrl: string;
	export let version: string;
	/** Commit sha (or `<tag>@sha1:<sha>`); the link targets it over `version` when present. */
	export let revision: string | null | undefined = undefined;
	export let size: 'xs' | 'sm' | 'md' | 'lg' = 'xs';
	/**
	 * ⭐ ADDITIVE (AD round 3, diff page item 2 — "Open commit"). `'tree'`
	 * (the default, every existing call site) opens the ref's whole tree,
	 * the right target for "go look at this build's source." `'commit'`
	 * opens that one commit's own page instead — the diff page's own
	 * question is "what changed", which a commit page answers directly and
	 * a tree browse does not. Same `gitRef` resolution either way; only the
	 * URL segment and the label differ.
	 */
	export let mode: 'tree' | 'commit' = 'tree';
	export let label: string | undefined = undefined;
	/**
	 * ⚠️ KEPT FOR API COMPATIBILITY, NO LONGER SPENT. Every call site passes
	 * `color="light"` (the only colour `.btn-secondary` draws); a filled
	 * GitHub button was never a thing either caller asked for.
	 */
	export const color: 'light' | 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'dark' = 'light';
	let className = '';
	export { className as class };

	const SIZE_CLASS: Record<NonNullable<typeof size>, string> = {
		xs: 'btn-xs',
		sm: 'btn-sm',
		md: '',
		lg: ''
	};
	$: sizeClass = SIZE_CLASS[size];
	$: iconClass = size === 'xs' ? 'h-3 w-3' : 'h-4 w-4';
	$: segment = mode === 'commit' ? 'commit' : 'tree';
	$: buttonLabel = label ?? (mode === 'commit' ? 'Open commit' : 'View on GitHub');

	function openGitHubUrl() {
		// Always absolute (qa9 B3): a scheme-less source was a relative href.
		// `mode="commit"` swaps the tree segment for the commit page.
		const tree = sourceTreeUrl(sourceUrl, gitRef(revision, version));
		const url = tree && segment === 'commit' ? tree.replace(/\/tree\/([^/]+)$/, '/commit/$1') : tree;
		if (url) window.open(url, '_blank');
	}
</script>

<button
	type="button"
	class="btn {sizeClass} btn-secondary {className}"
	onclick={openGitHubUrl}
	title={buttonLabel}
>
	<GithubSolid class="{iconClass} shrink-0" aria-hidden="true" />
	{buttonLabel}
</button>
