<script lang="ts">
	/**
	 * THE CHANGE CARD (r34 r4, BUILD-R4 / premium-changes mock) — the PR's own content: its commit(s) and the size of the change.
	 * Replaces the Commits card, whose "Builds" band listed the same places "Where it runs" lists (and said neither what a build was to the
	 * change nor that the places were already above). Now the builds live as "Where it runs" subheaders and this card holds only what is the
	 * CHANGE's: the commit rows (kind mark · title · author on line 2 · the mono sha right) and the rollup `1 commit · +39 −24 · 3 files`.
	 * REFERENCE: the Overview's commit rows (sha mono · title · Avatar + login); the mock's Change card for the rollup and row heights.
	 * The fixture carries a diffstat and a file COUNT but no file names, so there is no file list (nothing is invented); the count is in the rollup.
	 * change-strip r2 (owner 2026-11-12: "it doesn't show commit message or author"): every commit names its author with the face, the viewer's too ("(you)").
	 */
	import { CodeBranchOutline } from 'flowbite-svelte-icons';
	import Card from '$lib/components/Card.svelte';
	import ChangeKindMark from './ChangeKindMark.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { avatarSrc } from '../data';
	import { isViewer, plural } from '../change-view';
	import type { Commit } from './detail-model';
	import { href as toHref } from '$lib/paths';

	/** a commit row may also carry its own diffstat and the change page it links to (the App page's "In this release" reuses this card) */
	export type CardCommit = Commit & { add?: number | null; del?: number | null; href?: string | null };

	let { commits, stat = null, checkText = null, title = 'Change', max = null, more = null, class: className = '' }: { commits: CardCommit[]; /** the card's title (default "Change") */ title?: string; /** cap the rows; the rest is `more` */ max?: number | null; /** the link that stands for the rows past `max` */ more?: { text: string; href: string } | null; /** the range's size: additions / deletions when known, always the file count */ stat?: { add: number | null; del: number | null; files: number } | null; checkText?: string | null; class?: string } = $props();
	const lead = $derived(commits.length ? plural(commits.length, 'commit') : '');
	const tail = $derived([stat ? plural(stat.files, 'file') : '', checkText ?? ''].filter(Boolean).join(' · '));
</script>

<!-- Group's chrome (Card, padded false, divided rows), with the diffstat in GitHub's colours (owner 2026-11-12: "the diff +- lines is not colored") -->
<Card icon={CodeBranchOutline} {title} padded={false} class={className}>
	{#snippet rollup()}<span class="t-ui-sm tabular-nums text-fg-subtle" data-change-rollup>{lead}{#if lead && stat?.add != null}{' · '}{/if}{#if stat?.add != null}<span class="text-success" data-diff-add>+{stat.add}</span>{' '}<span class="text-danger" data-diff-del>−{stat.del}</span>{/if}{#if tail}{' · '}{tail}{/if}</span>{/snippet}
	<ul class="divide-y divide-line-subtle">
	{#each max ? commits.slice(0, max) : commits as k (k.sha + k.title)}
		<li class="cc-row relative px-4 py-3" data-commit={k.sha}>
			<span class="cc-mark flex h-5 items-center justify-center"><ChangeKindMark kind="commit" label="Commit" /></span>
			<p class="cc-main t-body min-w-0 text-fg [overflow-wrap:anywhere]">{#if k.href}<a href={toHref(k.href)} class="hover:underline before:absolute before:inset-0" data-commit-link>{k.title}</a>{:else}{k.title}{/if}</p>
			{#if k.sha}<span class="cc-id t-code-sm flex h-5 items-center whitespace-nowrap text-fg-subtle">{k.sha}</span>{/if}
			{#if k.author}<p class="cc-sub t-meta flex min-w-0 items-center gap-1.5 text-fg-subtle" data-commit-author><Avatar name={k.author} src={avatarSrc(k.author)} size={20} /><span class="min-w-0 break-words text-fg-muted">{k.author}</span>{#if isViewer(k.author)}<span>(you)</span>{/if}{#if k.add != null}<span class="ml-2 tabular-nums" data-commit-stat><span class="text-success">+{k.add}</span>{' '}<span class="text-danger">−{k.del}</span></span>{/if}</p>{/if}
		</li>
	{/each}
	</ul>
	{#if more && max && commits.length > max}<a href={toHref(more.href)} class="nav-link t-ui-sm flex min-h-11 items-center border-t border-line-subtle px-4" data-commit-more>{more.text}</a>{/if}
</Card>

<style>
	.cc-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; column-gap: 12px; row-gap: 4px; align-items: start; }
	.cc-mark { grid-column: 1; } .cc-main { grid-column: 2; } .cc-id { grid-column: 3; justify-self: end; } .cc-sub { grid-column: 2; }
</style>
