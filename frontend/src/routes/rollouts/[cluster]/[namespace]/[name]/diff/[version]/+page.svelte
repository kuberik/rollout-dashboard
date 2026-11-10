<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE ROLLOUT DIFF PAGE — "What did this deploy change in the cluster?"
	 * (SPEC §7; squad-rollout, AD rounds 5–6, 2026-10-10).
	 *
	 * Composition (the Overview's grammar):
	 *   · header: `RolloutTabHeader`. The title names THIS deploy
	 *     (`checkout-edge / b7e0d41 → d09e6f4`, one nowrap group), the pill is
	 *     THIS deploy's outcome ("healthy" / "failed"; the live state only when
	 *     the deploy is the running one). ONE right-aligned 36px action slot:
	 *     "Roll back to X" as the primary when the rollout is failing, the
	 *     secondary "Roll back to {from}" otherwise, nothing when neither is a
	 *     remedy. The fill is the only thing that changes.
	 *   · main + rail, always, with the Overview's `.ov-split` math. Main: one
	 *     Card per changed resource — headline change (field `t-heading`,
	 *     values `t-code-lg`) over `ManifestDiff`, our own diff body. Rail:
	 *     "This deploy" — the commit (title, author, Open commit), the failed
	 *     checks, the changed resources as jump links, the unchanged list.
	 *   · phone: the changed resources come first as a compact index Card; the
	 *     rail follows the diffs without repeating that index.
	 *   · a first deploy renders what it created as all-added lines; a
	 *     redeploy, an evicted predecessor, a missing manifest or a build no
	 *     longer in history is a NEUTRAL §3.15 empty in the main Card. Only a
	 *     real fetch failure is `ErrorState`, and the page then really does
	 *     recheck every 30s, so its "Rechecking" chip is true.
	 */
	import { page } from '$app/state';
	import { onDestroy, untrack } from 'svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		FileCodeOutline,
		ListOutline,
		UndoOutline,
		ExclamationCircleSolid
	} from 'flowbite-svelte-icons';
	import type { Rollout } from '../../../../../../../types';
	import { fetchRollout } from '$lib/api/rollouts';
	import { ApiError, RECOVERY_POLL_MS } from '$lib/api/errors';
	import { fetchManifest } from '$lib/api/manifests';
	import { commitQueryOptions } from '$lib/api/commit';
	import { fetchGithubStatus, githubStatusQueryKey } from '$lib/api/github';
	import { avatarForLogin as resolveAvatarForLogin } from '$lib/github-avatar';
	import { href } from '$lib/paths';
	import { pageTitle } from '$lib/page-title';
	import { now } from '$lib/stores/time';
	import {
		formatTimeAgoCompact,
		getDisplayVersion,
		hasFailedBakeStatus,
		hasUnblockFailedAnnotation
	} from '$lib/utils';
	import { githubOwnerRepo, repoKeyFor } from '$lib/version-utils';
	import { deployActs, historyAtLimit } from '$lib/history-marks';
	import { deployKey } from '$lib/history-deeplink';
	import { rollbackTarget } from '$lib/view-models/deploy-risk';
	import {
		diffPageTitle,
		diffSubject,
		deployOutcome,
		type DiffSubject
	} from '$lib/view-models/diff-page-title';
	import {
		manifestChangeParts,
		manifestResource,
		summarizeManifestChange
	} from '$lib/view-models/manifest-diff-summary';
	import { lineDiff } from '$lib/view-models/line-diff';
	import NotFound from '$lib/components/NotFound.svelte';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import RolloutTabHeader from '$lib/components/RolloutTabHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import CardSkeleton from '$lib/components/skeleton/CardSkeleton.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import GitHubViewButton from '$lib/components/GitHubViewButton.svelte';
	import ManifestDiff from '$lib/components/ManifestDiff.svelte';

	const cluster = $derived(page.params.cluster as string);
	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);
	const version = $derived(page.params.version as string);

	type Files = Record<string, string>;
	let rollout = $state<Rollout | null>(null);
	let phase = $state<'loading' | 'ready' | 'missing-rollout' | 'error'>('loading');
	let error = $state<unknown>(null);
	let retrying = $state(false);
	let prevFiles = $state<Files | null>(null);
	let curFiles = $state<Files | null>(null);
	/** Builds (display form) the server holds no manifest for. */
	let noManifestFor = $state<string[]>([]);
	let retryTimer: ReturnType<typeof setTimeout> | null = null;

	const history = $derived(rollout?.status?.history ?? []);
	const located = $derived.by(() => {
		if (!rollout) return null;
		const acts = deployActs(rollout);
		const idx = history.findIndex((h) => h.version.tag === version);
		return diffSubject({
			history,
			tag: version,
			atLimit: historyAtLimit(rollout),
			actKind: idx >= 0 ? (acts[idx]?.kind ?? null) : null
		});
	});
	const subject = $derived<DiffSubject | null>(located?.subject ?? null);
	const entry = $derived(located && located.index >= 0 ? history[located.index] : null);
	const prevEntry = $derived(
		located && located.index >= 0 ? (history[located.index + 1] ?? null) : null
	);
	const isLive = $derived(located?.index === 0);
	const outcome = $derived(
		entry ? deployOutcome(entry, { live: isLive, now: $now.getTime() }) : null
	);

	/** Fetch one build's manifest files; `null` = the server has none for it. */
	const manifestFor = (tag: string) => fetchManifest(cluster, namespace, name, tag);

	async function load() {
		if (retryTimer) clearTimeout(retryTimer);
		retryTimer = null;
		if (phase === 'error') retrying = true;
		try {
			let r: Rollout | null;
			try {
				r = (await fetchRollout(namespace, name, cluster)).rollout ?? null;
			} catch (e) {
				if (e instanceof ApiError && e.isMissing) {
					phase = 'missing-rollout';
					return;
				}
				throw e;
			}
			if (!r) {
				phase = 'missing-rollout';
				return;
			}
			rollout = r;
			const s = located?.subject;
			if (s?.kind === 'change') {
				const [p, c] = await Promise.all([manifestFor(s.fromTag), manifestFor(s.toTag)]);
				prevFiles = p;
				curFiles = c;
				noManifestFor = [...(p ? [] : [s.from]), ...(c ? [] : [s.to])];
			} else if (s?.kind === 'first') {
				// Nothing ran before: everything this build created is "added".
				const c = await manifestFor(version);
				prevFiles = c ? {} : null;
				curFiles = c;
				noManifestFor = c ? [] : [s.build];
			}
			error = null;
			phase = 'ready';
		} catch (e) {
			error = e;
			phase = 'error';
			// A one-shot page that shows ErrorState's "Rechecking every 30s"
			// must actually recheck.
			retryTimer = setTimeout(load, RECOVERY_POLL_MS);
		} finally {
			retrying = false;
		}
	}

	// Load on mount and whenever the route moves to another build.
	$effect(() => {
		void version;
		void name;
		untrack(() => {
			phase = 'loading';
			prevFiles = null;
			curFiles = null;
			noManifestFor = [];
		});
		untrack(load);
	});
	onDestroy(() => {
		if (retryTimer) clearTimeout(retryTimer);
	});

	// The commit this deploy shipped: title + author for the rail.
	const githubStatus = createQuery(() => ({
		queryKey: githubStatusQueryKey,
		queryFn: fetchGithubStatus,
		staleTime: 300_000,
		refetchInterval: false as const
	}));
	const ownerRepo = $derived(
		rollout?.status?.source ? githubOwnerRepo(repoKeyFor(rollout, name)) : null
	);
	const commitQuery = createQuery(() =>
		commitQueryOptions({
			owner: ownerRepo?.owner ?? '',
			repo: ownerRepo?.repo ?? '',
			sha: entry?.version?.revision ?? '',
			cluster,
			enabled: (githubStatus.data?.connected ?? false) && !!ownerRepo && !!entry?.version?.revision
		})
	);
	const commit = $derived(commitQuery.data ?? null);
	const commitTitle = $derived(commit?.subject?.split('\n')[0] ?? null);
	/** The one avatar lookup by login (`lib/github-avatar.ts`) — see its own
	 *  doc comment for why this rail used to show `danielreed` as a photo
	 *  on one row and a monogram on the next. */
	const avatarForLogin = (login: string | null | undefined) =>
		resolveAvatarForLogin(login, githubStatus.data);

	type Resource = {
		file: string;
		anchor: string;
		title: string;
		/** Card title: the resource's own name (kind goes in the caption). */
		cardTitle: string;
		/** `ConfigMap · configmap.yaml` */
		caption: string;
		state: 'changed' | 'added' | 'removed' | 'unchanged';
		diff: ReturnType<typeof lineDiff>;
		parts: ReturnType<typeof manifestChangeParts>;
	};
	const resources = $derived.by<Resource[]>(() => {
		if (!prevFiles || !curFiles) return [];
		const files = [...new Set([...Object.keys(curFiles), ...Object.keys(prevFiles)])].sort();
		return files.map((file) => {
			const before = prevFiles?.[file];
			const after = curFiles?.[file];
			const diff = lineDiff(before ?? '', after ?? '');
			const res = manifestResource(after ?? before ?? '');
			return {
				file,
				anchor: `diff-${file.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
				title: res ? `${res.kind} ${res.name}` : file,
				cardTitle: res ? res.name : file,
				caption: res ? `${res.kind} · ${file}` : file,
				state:
					before === undefined
						? 'added'
						: after === undefined
							? 'removed'
							: diff.add + diff.del > 0
								? 'changed'
								: 'unchanged',
				diff,
				parts: before !== undefined && after !== undefined ? manifestChangeParts(before, after) : []
			};
		});
	});
	/** Workloads lead: the image change is usually the headline of the deploy. */
	const WORKLOADS = ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'Rollout'];
	const rank = (r: Resource) => (WORKLOADS.includes(r.title.split(' ')[0]) ? 0 : 1);
	const changed = $derived(
		resources
			.filter((r) => r.state !== 'unchanged')
			.sort((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file))
	);
	const unchanged = $derived(resources.filter((r) => r.state === 'unchanged'));

	/**
	 * THE ONE ACTION SLOT (AD round 6, item c). The rollout-level remedy wins:
	 * on a failing rollout the PRIMARY "Roll back to X" (RolloutTabHeader's own
	 * predicates and target, drawn here because the slot is ours). Otherwise
	 * the secondary "Roll back to {from}", only where it is a real remedy:
	 * the from-build ran healthy and is not what is live now.
	 */
	const failing = $derived(
		!!rollout && hasFailedBakeStatus(rollout) && !hasUnblockFailedAnnotation(rollout)
	);
	const failTarget = $derived(failing && rollout ? rollbackTarget(rollout) : null);
	const action = $derived.by<{ label: string; href: string; primary: boolean } | null>(() => {
		if (failTarget) {
			return {
				label: 'Roll back',
				href: href(`/rollouts/${cluster}/${namespace}/${name}/history?action=rollback`),
				primary: true
			};
		}
		if (
			subject?.kind === 'change' &&
			prevEntry?.bakeStatus === 'Succeeded' &&
			subject.fromTag !== history[0]?.version?.tag
		) {
			return {
				label: 'Roll back',
				href: href(
					`/rollouts/${cluster}/${namespace}/${name}/history?deploy=${encodeURIComponent(deployKey(prevEntry) ?? '')}&action=rollback`
				),
				primary: false
			};
		}
		return null;
	});
	const source = $derived(rollout?.status?.source ?? null);

	const empty = $derived.by<{ headline: string; next: string } | null>(() => {
		if (!subject || phase !== 'ready') return null;
		switch (subject.kind) {
			case 'redeploy':
				return {
					headline: `Redeploy of ${subject.build}`,
					next: 'The same build was deployed again, so nothing in the cluster changed.'
				};
			case 'oldest':
				return {
					headline: 'Nothing to compare',
					next: `History keeps the last ${history.length} deploys; the one before this was evicted, so what it replaced is unknown.`
				};
			case 'missing':
				return {
					headline: `No deploy of ${subject.build} in this history`,
					next: `History keeps the last ${history.length} deploys. Pick one from History to see its diff.`
				};
			case 'first':
			case 'change':
				if (noManifestFor.length === 0) return null;
				return {
					headline: `No manifest recorded for ${noManifestFor.join(' or ')}`,
					next: 'The registry no longer holds that build’s manifests, so its changes cannot be shown. Its code change is on GitHub.'
				};
		}
	});

	const tabTitle = $derived(
		diffPageTitle({
			rolloutName: rollout?.metadata?.name,
			rolloutNamespace: rollout?.metadata?.namespace,
			toBuild: entry ? getDisplayVersion(entry.version) : null,
			fallbackTag: version ?? ''
		})
	);
	const ROLLUP_TONE = {
		good: 'text-success',
		adverse: 'text-danger',
		active: 'text-active',
		neutral: 'text-fg-subtle'
	};
</script>

<svelte:head>
	<title>{pageTitle(tabTitle)}</title>
</svelte:head>

{#snippet diffTitle()}
	<!-- The title names the deploy this page shows. One nowrap group (History's
	     own fix), so the slash never sits alone at a line end. -->
	{#if subject}
		<span class="inline-flex items-baseline gap-x-3 whitespace-nowrap">
			<!-- A change title ("name / from → to") always wraps below sm; the
			     builds then start their own line, where a leading "/" reads as
			     an orphan (AD round 7). A build-only title fits and keeps it. -->
			<span
				class="t-title text-fg-disabled {subject.kind === 'change' ? 'max-sm:hidden' : ''}"
				aria-hidden="true">/</span
			>
			{#if subject.kind === 'change'}
				<span class="t-code-lg text-fg-muted"
					>{subject.from}<span class="text-fg-disabled">{' → '}</span><span class="text-fg"
						>{subject.to}</span
					></span
				>
			{:else}
				<span class="t-code-lg text-fg">{subject.build}</span>
			{/if}
		</span>
	{/if}
{/snippet}

{#snippet resourceStats(r: Resource)}
	<span class="t-meta shrink-0 tabular-nums">
		{#if r.state === 'added'}<span class="text-fg-subtle">new </span>{/if}
		{#if r.state === 'removed'}<span class="text-fg-subtle">removed </span>{/if}
		{#if r.diff.add > 0}<span class="text-success">+{r.diff.add}</span>{/if}
		{#if r.diff.del > 0}<span class="text-danger">−{r.diff.del}</span>{/if}
	</span>
{/snippet}

{#snippet resourceIndex()}
	<ul class="divide-line-subtle divide-y">
		{#each changed as r (r.file)}
			<li>
				<a href="#{r.anchor}" class="tap-zone hover:bg-hover flex items-center gap-2 px-4 py-3">
					<FileCodeOutline class="text-fg-subtle h-4 w-4 shrink-0" aria-hidden="true" />
					<span class="tap-link t-body text-fg min-w-0 flex-1 truncate">{r.title}</span>
					{@render resourceStats(r)}
				</a>
			</li>
		{/each}
		{#each unchanged as r (r.file)}
			<li class="flex items-center gap-2 px-4 py-3">
				<FileCodeOutline class="text-fg-disabled h-4 w-4 shrink-0" aria-hidden="true" />
				<span class="t-body text-fg-subtle min-w-0 flex-1 truncate">{r.title}</span>
				<span class="t-meta text-fg-subtle shrink-0">unchanged</span>
			</li>
		{/each}
	</ul>
{/snippet}

{#if phase === 'missing-rollout'}
	<div class="mx-auto w-full px-4 pt-6 pb-10 sm:px-6">
		<NotFound
			eyebrow="Rollout"
			title={name ?? ''}
			headline="This rollout does not exist"
			nextStep="It may have been deleted, or the address may be wrong."
			facts={[
				{ label: 'Rollout', value: `${namespace}/${name}`, handle: true },
				...(cluster ? [{ label: 'Cluster', value: cluster, handle: true }] : []),
				{ label: 'Server answered', value: 'not found' }
			]}
			backHref={href('/rollouts')}
			backLabel="Back to all rollouts"
		/>
	</div>
{:else if phase === 'error'}
	<!-- ErrorState draws the rollout tab header itself on a rollout page. -->
	<ErrorState
		{error}
		subject="this diff"
		backHref={href(`/rollouts/${cluster}/${namespace}/${name}/history`)}
		backLabel="Back to history"
		onRetry={load}
		isRetrying={retrying}
	/>
{:else}
	<div class="mx-auto w-full px-4 pt-6 pb-10 sm:px-6">
		<RolloutTabHeader
			{name}
			{rollout}
			titleAfter={subject ? diffTitle : undefined}
			chip={outcome?.chip}
			inlineRollback={false}
		>
			{#snippet meta()}
				{#if subject?.kind === 'change' && subject.rollback}
					<span>Rollback</span>
				{:else if subject?.kind === 'first'}
					<span>First deploy</span>
				{/if}
				{#if entry}
					<span title={entry.timestamp}
						>deployed {formatTimeAgoCompact(entry.timestamp, $now)} ago</span
					>
					{#if entry.triggeredBy}
						<!-- Below sm the line is state · age · Roll back; who triggered
						     it stays one tap away in the History row (LOGOPEN r9). -->
						<span class="inline-flex items-center gap-1.5 max-lg:hidden">
							{#if entry.triggeredBy.kind === 'User'}
								<Avatar
									name={entry.triggeredBy.name}
									src={avatarForLogin(entry.triggeredBy.name)}
									size={16}
								/>
								{entry.triggeredBy.name}
							{:else}
								<Avatar name="Automatic" kind="controller" size={16} />
								Automatic
							{/if}
						</span>
					{/if}
				{/if}
				{#if action?.primary}
					<!-- Phone only: 44px, right-aligned, "Roll back" alone (the
					     dialog names the build), as RolloutTabHeader draws it. -->
					<a
						href={action.href}
						class="btn ml-auto h-11 bg-none px-4 lg:hidden {action.primary
							? 'btn-primary'
							: 'btn-secondary'}"
						title={action.label}
						data-phone-only
					>
						<UndoOutline class="h-4 w-4 shrink-0" aria-hidden="true" />
						{action.label.startsWith('Roll back') ? 'Roll back' : action.label}
					</a>
				{/if}
			{/snippet}
			{#snippet actions()}
				{#if action}
					<!-- sm+ only; below sm the action ends the meta line, the same
					     phone header every rollout tab draws (LOGOPEN r9, item 2). -->
					<!-- A failed build's primary Roll back moves to the phone meta
					     line (as on every tab); a calm build's secondary one stays in
					     the actions slot at every width, as on Overview and History. -->
					<a
						href={action.href}
						class="btn {action.primary ? 'btn-primary max-lg:hidden' : 'btn-secondary max-lg:h-11'}"
						title={action.label}
						data-desktop-only={action.primary ? '' : undefined}
						data-phone-end={action.primary ? undefined : ''}
					>
						<UndoOutline class="h-4 w-4 shrink-0" aria-hidden="true" />
						{action.label}
					</a>
				{/if}
			{/snippet}
		</RolloutTabHeader>

		<div class="ov-split-cq">
			<div class="ov-split flex flex-col gap-4">
				<!-- MAIN -->
				<div class="flex min-w-0 flex-col gap-4">
					{#if phase === 'loading'}
						<CardSkeleton titleWidth="w-48" bodyHeight={280} />
					{:else if empty}
						<Card icon={FileCodeOutline} title="Changes in the cluster">
							<div class="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
								<FileCodeOutline class="text-fg-disabled h-5 w-5" aria-hidden="true" />
								<p class="t-ui text-fg">{empty.headline}</p>
								<p class="t-meta text-fg-subtle max-w-[320px]">{empty.next}</p>
								{#if subject?.kind === 'missing'}
									<a
										class="nav-link mt-2"
										href={href(`/rollouts/${cluster}/${namespace}/${name}/history`)}>Open History</a
									>
								{/if}
							</div>
						</Card>
					{:else if changed.length === 0}
						<Card icon={FileCodeOutline} title="Changes in the cluster">
							<div class="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
								<FileCodeOutline class="text-fg-disabled h-5 w-5" aria-hidden="true" />
								<p class="t-ui text-fg">The manifests are identical</p>
								<p class="t-meta text-fg-subtle max-w-[320px]">
									Both builds render the same resources; only the image behind the tag can differ.
								</p>
							</div>
						</Card>
					{:else}
						<!-- Phone / narrow: the changed resources first, as a compact index. -->
						<div class="diff-index-narrow">
							<Card icon={ListOutline} title="Changed resources" padded={false}>
								{#snippet rollup()}
									<span class="t-ui-sm text-fg-subtle tabular-nums"
										>{changed.length} of {resources.length}</span
									>
								{/snippet}
								{@render resourceIndex()}
							</Card>
						</div>
						{#each changed as r (r.file)}
							<div id={r.anchor} class="scroll-mt-20">
								<!-- Title = the resource name only, so it shares its 47px header with
							     the +N −M rollup even at 360 ("ConfigMap checkout-edge-config"
							     wrapped there and Card dropped the rollup flush-left). The kind
							     moves to the caption under the headline. -->
								<Card
									icon={FileCodeOutline}
									title={r.cardTitle}
									titleTooltip={r.title}
									padded={false}
								>
									{#snippet rollup()}
										<span class="t-ui-sm tabular-nums">
											{#if r.state === 'added'}<span class="text-fg-subtle">new · </span>{/if}
											{#if r.state === 'removed'}<span class="text-fg-subtle">removed · </span>{/if}
											{#if r.diff.add > 0}<span class="text-success">+{r.diff.add}</span>{/if}
											{#if r.diff.del > 0}<span class="text-danger">−{r.diff.del}</span>{/if}
										</span>
									{/snippet}
									{#if r.parts.length > 0}
										<!-- The headline: what changed, before how. -->
										<div class="border-line-subtle border-b px-4 py-3">
											<p class="sr-only">
												{summarizeManifestChange(
													prevFiles?.[r.file] ?? '',
													curFiles?.[r.file] ?? ''
												)}
											</p>
											<div class="dot-list" aria-hidden="true">
												<div class="dot-list-row flex flex-wrap items-baseline gap-y-1">
													{#each r.parts as p, k (k)}
														<span class="inline-flex min-w-0 flex-wrap items-baseline gap-x-2">
															{#if p.kind === 'field'}
																<span class="t-heading text-fg-muted">{p.field}</span>
																<span class="hl-value t-code-lg text-fg-muted">{p.from}</span>
																<span class="t-heading text-fg-disabled">→</span>
																<span class="hl-value t-code-lg text-fg">{p.to}</span>
															{:else if p.kind === 'added' || p.kind === 'removed'}
																<span class="t-heading text-fg-muted">{p.kind}</span>
																{#if p.name.length > 14}
																	<!-- A long name drops to t-code in a narrow card
																	     instead of breaking a 20px word in two. -->
																	<span class="hl-value hl-wide t-code-lg text-fg">{p.name}</span>
																	<span class="hl-value hl-narrow t-code text-fg"
																		>{#each p.name.split(/(?<=_)/) as w, j (j)}{w}<wbr
																			/>{/each}</span
																	>
																{:else}
																	<span class="hl-value t-code-lg text-fg">{p.name}</span>
																{/if}
															{:else}
																<span class="t-heading text-fg">{p.text}</span>
															{/if}
														</span>
													{/each}
												</div>
											</div>
											<p class="t-meta text-fg-subtle mt-1">{r.caption}</p>
										</div>
									{:else}
										<p class="t-meta border-line-subtle text-fg-subtle border-b px-4 py-3">
											{r.caption}
										</p>
									{/if}
									<ManifestDiff
										rows={r.diff.rows}
										hiddenAfter={r.diff.hiddenAfter}
										label="Changes to {r.title}"
									/>
								</Card>
							</div>
						{/each}
					{/if}
				</div>

				<!-- RAIL: this deploy's context. -->
				<div class="min-w-0">
					{#if phase === 'loading'}
						<CardSkeleton titleWidth="w-28" bodyHeight={200} />
					{:else if entry}
						<Card
							icon={ListOutline}
							title="This deploy"
							verdict={outcome?.sentence ?? null}
							verdictTone={outcome?.tone === 'neutral' ? 'neutral' : outcome?.tone}
							padded={false}
						>
							<div class="divide-line-subtle divide-y">
								<!-- The commit -->
								<section class="flex flex-col gap-2 px-4 py-3">
									<h3 class="t-label text-fg-subtle">Commit</h3>
									{#if commitTitle}
										<p class="t-card-title text-fg break-words">{commitTitle}</p>
									{/if}
									<div class="t-meta text-fg-subtle flex flex-wrap items-center gap-x-3 gap-y-1">
										{#if commit?.author}
											<span class="text-fg-muted inline-flex items-center gap-1.5">
												<Avatar
													name={commit.author}
													src={avatarForLogin(commit.author)}
													size={16}
												/>
												{commit.author}
											</span>
										{/if}
										<span class="t-code-sm text-fg-muted">{getDisplayVersion(entry.version)}</span>
										{#if source}
											<span class="ml-auto">
												<GitHubViewButton
													sourceUrl={source}
													version={entry.version.tag}
													revision={entry.version.revision}
													size="xs"
													mode="commit"
												/>
											</span>
										{/if}
									</div>
								</section>
								<!-- The failed checks -->
								{#if entry.failedHealthChecks && entry.failedHealthChecks.length > 0}
									<section class="flex flex-col gap-2 px-4 py-3">
										<h3 class="t-label text-fg-subtle">Failed checks</h3>
										<ul class="flex flex-col gap-2">
											{#each entry.failedHealthChecks as check (check.name)}
												<li class="t-meta flex items-start gap-2">
													<ExclamationCircleSolid
														class="text-danger h-4 w-4 shrink-0"
														aria-hidden="true"
													/>
													<span class="min-w-0">
														<span class="t-ui-sm text-fg block break-words">{check.name}</span>
														<span class="text-danger block break-words">{check.message}</span>
													</span>
												</li>
											{/each}
										</ul>
									</section>
								{/if}
								<!-- The resources (wide only: on a phone the index leads main) -->
								{#if changed.length > 0 || unchanged.length > 0}
									<section class="diff-index-wide flex flex-col pt-3">
										<h3 class="t-label text-fg-subtle px-4 pb-1">
											Resources · {changed.length} changed{unchanged.length
												? ` · ${unchanged.length} unchanged`
												: ''}
										</h3>
										{@render resourceIndex()}
									</section>
								{/if}
							</div>
						</Card>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	/* The Overview's own split (`.ov-split`, rollout Overview <style>):
	   rail floors at 22rem, threshold 1080px of container. */
	.ov-split-cq {
		container: diffsplit / inline-size;
	}
	@container diffsplit (min-width: 1080px) {
		.ov-split {
			display: grid;
			grid-template-columns: 3fr minmax(22rem, 2fr);
			align-items: start;
		}
	}
	/* One resource index per layout: the compact Card leads main below the
	   split, the rail section carries it beside it. */
	.diff-index-wide {
		display: none;
	}
	@container diffsplit (min-width: 1080px) {
		.diff-index-narrow {
			display: none;
		}
		.diff-index-wide {
			display: flex;
		}
	}
	.hl-value {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	/* The headline sits inside Card's own `.card-cq` container. */
	.hl-narrow {
		display: none;
	}
	@container (max-width: 479.98px) {
		.hl-wide {
			display: none;
		}
		.hl-narrow {
			display: inline;
		}
	}
</style>
