<script lang="ts">
	/**
	 * THE CHANGE CARD (r34 r4, BUILD-R4 / premium-changes mock) — the PR's own content: its commit(s) and the size of the change.
	 * Replaces the Commits card, whose "Builds" band listed the same places "Where it runs" lists (and said neither what a build was to the
	 * change nor that the places were already above). Now the builds live as "Where it runs" subheaders and this card holds only what is the
	 * CHANGE's: the commit rows (kind mark · title · author on line 2 · the mono sha right) and the rollup `1 commit · +39 −24 · 3 files`.
	 * REFERENCE: the Overview's commit rows (sha mono · title · Avatar + login); the mock's Change card for the rollup and row heights.
	 * The fixture carries a diffstat and a file COUNT but no file names, so there is no file list (nothing is invented); the count is in the rollup.
	 * The viewer never sees their own face on their own change (the header already says "yours"): their commit has no author line.
	 */
	import { CodeBranchOutline } from 'flowbite-svelte-icons';
	import Group from '../Group.svelte';
	import ChangeKindMark from './ChangeKindMark.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { avatarSrc } from '../data';
	import { isViewer, plural } from '../change-view';
	import type { Commit } from './detail-model';

	let { commits, stat = null, checkText = null, class: className = '' }: { commits: Commit[]; /** the range's size: additions / deletions when known, always the file count */ stat?: { add: number | null; del: number | null; files: number } | null; checkText?: string | null; class?: string } = $props();
	const sizeText = $derived(stat ? `${stat.add != null ? `+${stat.add} −${stat.del} · ` : ''}${plural(stat.files, 'file')}` : '');
	const rollup = $derived([commits.length ? plural(commits.length, 'commit') : '', sizeText, checkText ?? ''].filter(Boolean).join(' · '));
</script>

<Group icon={CodeBranchOutline} title="Change" {rollup} class={className}>
	{#each commits as k (k.sha + k.title)}
		<li class="cc-row px-4 py-3" data-commit={k.sha}>
			<span class="cc-mark flex h-5 items-center justify-center"><ChangeKindMark kind="commit" label="Commit" /></span>
			<p class="cc-main t-body min-w-0 text-fg [overflow-wrap:anywhere]">{k.title}</p>
			{#if k.sha}<span class="cc-id t-code-sm flex h-5 items-center whitespace-nowrap text-fg-subtle">{k.sha}</span>{/if}
			{#if k.author && !isViewer(k.author)}<p class="cc-sub t-meta flex min-w-0 items-center gap-1.5 text-fg-subtle"><Avatar name={k.author} src={avatarSrc(k.author)} size={20} /><span class="min-w-0 break-words text-fg-muted">{k.author}</span></p>{/if}
		</li>
	{/each}
</Group>

<style>
	.cc-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; column-gap: 12px; row-gap: 4px; align-items: start; }
	.cc-mark { grid-column: 1; } .cc-main { grid-column: 2; } .cc-id { grid-column: 3; justify-self: end; } .cc-sub { grid-column: 2; }
</style>
