<script lang="ts">
	/**
	 * r34 v2 CD — /changes/<slug> on its real route (owner ruling 2026-11-01: the redesign replaces the page here, no new path).
	 *
	 * RETIRED on this branch: the old 3,000-line body (the live rollout-list query, the PR-pipeline view-model, the repository
	 * ledger and build pages) is gone. This route resolves the slug (`github.com/<owner>/<repo>/pull/<n>` or `/<sha>`; the
	 * host-less shape is 308'd by +page.ts) to the change the Changes list links to and renders `new/change/ChangeDetail`, which
	 * reads the same fixture-backed model (`new/data.ts`) as the list, so list -> detail -> tab agree. Kept from the old page: the slug
	 * parsing (`parseChangeSlug`), `pageTitle`, `NotFound`, the GitHub links and the PR's checks line (`ensurePrMeta` + `checksLine`).
	 * A bare repository slug (`github.com/<owner>/<repo>`) has no page of its own any more and goes to the Changes list.
	 * `?calm=1` / `?quiet=1` switch the scenario (new/scenario.ts).
	 * LIVE DATA (detail pass 2026-11-08): the page renders inside FleetGate, which installs the live FleetSource the Changes list reads, so
	 * the change is found in (and every fact is computed from) the same data the list draws: list and detail cannot disagree.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { pageTitle } from '$lib/page-title';
	import { parseChangeSlug, changeSlugTitle } from '$lib/pr-ref';
	import { checksLine } from '$lib/pr-cell-copy';
	import { ensurePrMeta } from '$lib/stores/pr-meta.svelte';
	import NotFound from '$lib/components/NotFound.svelte';
	import { scenarioOf } from '$lib/components/new/scenario';
	import FleetGate from '$lib/components/new/FleetGate.svelte';
	import { liveSource } from '$lib/components/home/sketch/fleet-source.svelte';
	import ChangeDetail from '$lib/components/new/change/ChangeDetail.svelte';
	import { findChange } from '$lib/components/new/change/detail-model';
	import { githubAbsence } from '$lib/components/new/data';
	import SectionHeader from '$lib/components/SectionHeader.svelte';
	import { CodeBranchOutline } from 'flowbite-svelte-icons';
	import ConnectGithubAction from '$lib/components/ConnectGithubAction.svelte';

	const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
	const scenario = $derived(scenarioOf(page.url));
	const segments = $derived(((page.params.slug as string) || '').split('/').filter((s) => s.length > 0).map(safeDecode));
	const slug = $derived(segments.join('/'));
	const parsed = $derived(parseChangeSlug(segments));
	/* QA2 #12: what the address names, for when the change itself cannot load */
	const named = $derived(changeSlugTitle(segments));
	/* reads the live source FleetGate installs (liveSource() is a dependency, so the change resolves once the fleet has answered) */
	const change = $derived((liveSource(), findChange(slug, scenario)));
	/* `github.com/<owner>/<repo>`: the repository, which has no page of its own any more */
	const isRepo = $derived(!change && segments.length === 3 && segments[0] === 'github.com');
	$effect(() => { if (isRepo) void goto(`/changes${page.url.search}`, { replaceState: true }); });

	const pr = $derived.by(() => {
		const parts = (parsed?.repoSlug ?? '').split('/');
		return change && parsed?.ref.kind === 'pull' && parts.length === 3 && parts[0] === 'github.com' ? ensurePrMeta(parts[1], parts[2], parsed.ref.number) : null;
	});
	/* QA #9: with GitHub absent the change list is empty, so "not found" would be a lie — say why, and offer the remedy */
	const ab = $derived((liveSource(), githubAbsence()));
	const checks = $derived(checksLine(pr?.data?.checks));
</script>

<svelte:head><title>{pageTitle(change ? (change.prNumber != null ? `#${change.prNumber} ${change.title}` : change.title) : (named?.title ?? segments[segments.length - 1] ?? 'Change'))}</title></svelte:head>

<FleetGate subject="this change">
	{#if change}
		<ChangeDetail {change} {scenario} {checks} />
	{:else if !isRepo}
		{#if ab && ab.kind !== 'loading'}
			<!-- QA #9 / round 2 C4: the SAME centred empty state /changes draws when GitHub is absent, under the same section header. -->
			<div class="w-full px-4 py-6 sm:px-6" data-page="change-github-absent">
				<h1 class="sr-only">Change {named?.title ?? segments[segments.length - 1] ?? slug}</h1>
				<SectionHeader title={named?.title ?? 'Change'} icon={CodeBranchOutline} rollup={[named?.repo ?? segments[segments.length - 1] ?? slug]} />
				<div class="empty" data-list-empty data-github-absence={ab.kind}>
					<CodeBranchOutline class="h-5 w-5 text-fg-disabled" aria-hidden="true" />
					<p class="t-ui text-fg">{ab.kind === 'error' ? 'This change could not be read' : 'This change needs GitHub'}</p>
					<p class="t-meta text-fg-subtle">{ab.sentence}</p>
					{#if ab.connect}<ConnectGithubAction class="mt-3" />{/if}
				</div>
			</div>
			{:else}
				<NotFound
					eyebrow="Change"
					title={named?.title ?? segments[segments.length - 1] ?? slug}
					headline="This change does not exist"
					nextStep="Check the address, or find the change in the list."
					facts={[{ label: 'Address', value: slug }]}
					backHref="/changes"
					backLabel="Back to all changes"
				/>
		{/if}
	{/if}
</FleetGate>

<style>
	.empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 32px 16px; text-align: center; border: 1px solid var(--k-line); border-radius: 8px; }
	.empty p { margin: 0; }
</style>
