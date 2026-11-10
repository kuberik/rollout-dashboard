<!--
	@component
	History's "View diff" action for one deploy entry.

	Role: links a History row to /diff/<tag> only when that diff resolves, i.e.
	the manifests the diff page needs exist (see `diff-link.ts`). It replaces an
	`artifactType` gate that no demo rollout satisfied, so History never linked
	to a diff (qa11 B3). It renders inside the row's expanded action bar, so the
	manifest lookups run only for rows a person has opened, and they share the
	query cache with the diff page itself.

	No existing component plays this role: GitHubViewButton links out to the
	code change, this links in to the cluster change. It borrows the action
	bar's own `.btn btn-secondary btn-xs` shape so it sits beside its siblings.
-->
<script lang="ts">
	import { createQueries } from '@tanstack/svelte-query';
	import { CodePullRequestSolid } from 'flowbite-svelte-icons';
	import { fetchManifest, manifestQueryKey } from '$lib/api/manifests';
	import { diffLinkNeeds, diffResolves } from '$lib/view-models/diff-link';
	import { href } from '$lib/paths';

	type EntryLike = { version: { tag: string; version?: string; revision?: string } };

	let {
		cluster,
		namespace,
		name,
		history,
		index,
		atLimit = false
	}: {
		cluster: string | undefined;
		namespace: string;
		name: string;
		history: EntryLike[];
		index: number;
		atLimit?: boolean;
	} = $props();

	const needs = $derived(diffLinkNeeds({ history, index, atLimit }));
	const tag = $derived(history[index]?.version.tag ?? '');

	const manifests = createQueries(() => ({
		queries: (needs ?? []).map((t) => ({
			queryKey: manifestQueryKey(cluster, namespace, name, t),
			queryFn: () => fetchManifest(cluster, namespace, name, t),
			staleTime: Infinity,
			retry: false
		})),
		// See ChangeVersionModal `pickerTitleQueries`: svelte-query 6.0.12 throws when a top-level result array shrinks by 2+.
		combine: (results) => ({ items: results.map((r) => ({ data: r.data })) })
	}));

	const resolved = $derived(
		diffResolves(
			needs,
			manifests.items.map((q) => q.data)
		)
	);
</script>

{#if resolved}
	<a
		href={href(`/rollouts/${cluster}/${namespace}/${name}/diff/${encodeURIComponent(tag)}`)}
		class="btn btn-secondary btn-xs"
	>
		<CodePullRequestSolid class="h-3 w-3 shrink-0" aria-hidden="true" />
		View diff
	</a>
{/if}
