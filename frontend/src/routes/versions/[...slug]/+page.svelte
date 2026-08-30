<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { fetchGithubStatus, githubStatusQueryKey } from '$lib/api/github';
	import { fetchScheduleWindow, formatTimeUntil, type ScheduleWindow } from '$lib/api/schedules';
	import { repoBody, revisionPath } from '$lib/version-utils';
	import { rolloutPath } from '$lib/source-dashboard';
	import {
		buildRevisionLedger,
		findRow,
		rankSentence,
		resolveRevision,
		type RepoLedger,
		type RevisionRow,
		type RevisionService,
		type RevisionSlot
	} from '$lib/view-models/revision-ledger';
	import {
		revisionCoverage,
		coverageSwatch,
		type CoverageKey,
		type CoverageSlotVM
	} from '$lib/view-models/revision-coverage';
	import { formatTimeAgo } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import {
		ArrowLeftOutline,
		ArrowRightOutline,
		ArrowUpRightFromSquareOutline,
		CalendarMonthSolid,
		ChevronRightOutline,
		CheckCircleSolid,
		ExclamationCircleSolid,
		HourglassOutline,
		QuestionCircleOutline,
		TagOutline,
		TagSolid,
		UserCircleSolid
	} from 'flowbite-svelte-icons';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import Card from '$lib/components/Card.svelte';
	import CommitSummary from '$lib/components/CommitSummary.svelte';
	import ChangeVersionModal from '$lib/components/ChangeVersionModal.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import RevisionLead from '$lib/components/RevisionLead.svelte';
	import type { Rollout, Environment } from '../../../types';

	/**
	 * ONE REVISION — RELEASE COVERAGE.
	 *
	 * The page's three questions, from `.agents-context/design/REVISION-PAGES.md`:
	 *
	 *   1. How far has this build reached across the fleet? → the hero count and
	 *      the coverage bar, `fleet-explore.js` concept 07 verbatim.
	 *   2. What is each service running it as? → `What each service ships it as`
	 *      gives each service ONE rank against ITS OWN denominator. `newest of 4`
	 *      beside `newest of 37` is the whole point: those two services share a
	 *      source repo and ship independent streams.
	 *   3. What is stopping it going further? → the `Not yet` card names the gate,
	 *      SAYS WHAT KIND IT IS, says when it clears if the cluster knows, links
	 *      to the rollout that is actually stuck, and carries `Promote` wherever
	 *      one is legal.
	 *
	 * ───────────────────────────────────────────────────────────────────────
	 * ROUND FIVE — COMPOSED, NOT REARRANGED
	 * ───────────────────────────────────────────────────────────────────────
	 *
	 * The measured diagnosis (`COMPOSITION-GRAMMAR.md`): the page the human calls
	 * beautiful carries 115 SVG icons and 8px cards; this pair carried 0 and 1
	 * and got *"criminally underdesigned"*. Every rule the previous rounds
	 * enforced was a REDUCTION rule, and without a composition discipline they
	 * converge on small gray text in undifferentiated rows.
	 *
	 * So the page is now built from the grammar of the reference: TITLED CARDS
	 * with a 16px icon and a right-aligned rollup, a FILLED BANNER for the
	 * blocking fact with its 40px circular icon, BUTTONS AT 14px that look
	 * pressable, and a type range of 24 → 10.
	 *
	 * ───────────────────────────────────────────────────────────────────────
	 * FOUR DEFECTS A LIVE UX CRITIQUE FOUND, AND WHAT THEY BECAME
	 * ───────────────────────────────────────────────────────────────────────
	 *
	 *  1. *"`Not yet` rows link to `/apps/<name>`, not the stuck rollout. The
	 *     page knows the environment and discards it; DEV and STAGING resolve to
	 *     the same URL."* → every place row now links to
	 *     `/rollouts/<cluster>/<ns>/<name>`, the object the gate is attached to
	 *     and the page that can clear it. `rolloutRef` is carried on the slot.
	 *  2. *"Gates render as raw object names (`ghd-kw4lz`) with no type, owner or
	 *     clear-time — while rollout detail knows 'will be allowed in 2d 1h'."*
	 *     → `promotionBlock`'s STRUCTURAL split (allow-list published vs simply
	 *     not passing) now reaches the UI, each kind gets its own glyph and its
	 *     own sentence, and `api/schedules.ts` supplies the clear time from the
	 *     same endpoint `ScheduleStatus` reads.
	 *  3. *"The COVERAGE bar has two colours and no legend."* → the bucket cards
	 *     ARE the legend, and they always were; what was missing is that they
	 *     did not look like anything. Each bucket is now a titled card whose
	 *     header carries the bar's own fill as a 12px swatch, its name in 14px
	 *     semibold, and its count as the rollup. No dummy graphic, no key row:
	 *     the explanation is the object.
	 *  4. Revisions nobody has deployed had no page. → they do now
	 *     (`RepoLedger.pending`), and this page renders them unchanged: `0 of N
	 *     places live`, and the whole `Not yet` card naming the gates.
	 *
	 * WHAT THIS PAGE DELIBERATELY DOES NOT DO. No version ladder and no Gantt —
	 * both rejected, repeatedly. No `heat(rank)` ramp and no stable colour per
	 * sha: both recorded as measured-failed. The bar's segments are BUCKETS,
	 * four status hues the budget already owns, not ranks.
	 */

	// The route is /versions/[...slug]; the slug is "<repo path>/<key>" where
	// the repo path is real path segments and the key is the final one. The key
	// is a REVISION now, but every historical link put a display label there, so
	// the resolver below takes either and rewrites the URL.
	function safeDecode(s: string): string {
		try {
			return decodeURIComponent(s);
		} catch {
			return s;
		}
	}
	const parsed = $derived.by<{ repoPath: string; key: string }>(() => {
		const raw = (page.params.slug as string) || '';
		const parts = raw.split('/').filter((s) => s.length > 0);
		const keyRaw = parts.pop() ?? '';
		return { repoPath: parts.map(safeDecode).join('/'), key: safeDecode(keyRaw) };
	});
	const repoPath = $derived(parsed.repoPath);
	const urlKey = $derived(parsed.key);

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);
	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);
	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

	const ledgers = $derived(buildRevisionLedger(rollouts, environments));
	const ledger = $derived.by<RepoLedger | null>(
		() => ledgers.find((l) => repoBody(l.repoKey) === repoPath) ?? null
	);

	/**
	 * RESOLUTION: REVISION FIRST, THEN LABEL — and now across BOTH halves of the
	 * ledger. A 12-char slug, a 7-char sha pasted from a terminal and a full
	 * 40-char revision all resolve as prefixes of the same string; a
	 * pre-migration link (`…/1.66.0-66`) resolves through the label map; and a
	 * build that has never been deployed resolves through `ledger.pending`
	 * rather than 404ing, which is what made eighteen of this repo's
	 * thirty-four revisions unreachable.
	 */
	const revision = $derived(resolveRevision(ledger, urlKey));
	const row = $derived.by<RevisionRow | null>(() => findRow(ledger, revision));
	/** True when no service has ever run this build. Changes the words, not the shape. */
	const neverDeployed = $derived(!!row && !!ledger && !ledger.rows.includes(row));
	const rowIndex = $derived(ledger && row ? ledger.rows.indexOf(row) : -1);
	const prev = $derived(ledger && rowIndex >= 0 ? (ledger.rows[rowIndex + 1] ?? null) : null);

	/**
	 * Canonicalise the URL once the revision is known, so an old label link and
	 * a short-sha link both settle on one address. `replaceState` rather than
	 * `goto`: this is the same page, and a redirect that pushes history makes
	 * the back button walk the resolution instead of leaving the page.
	 */
	$effect(() => {
		if (!ledger || !revision) return;
		const canonical = revisionPath(ledger.repoKey, revision);
		if (page.url.pathname !== canonical) replaceState(canonical, page.state);
	});

	const githubStatus = createQuery(() => ({
		queryKey: githubStatusQueryKey,
		queryFn: fetchGithubStatus,
		staleTime: 300_000
	}));
	const githubConnected = $derived(githubStatus.data?.connected ?? false);

	/**
	 * A COARSE CLOCK, DELIBERATELY — not `$now`, which ticks every 100ms.
	 * Bucketing calls `detectStuck`, whose thresholds are 1h and 24h, so a 30s
	 * clock is three orders of magnitude inside the shortest one.
	 */
	let coarse = $state(new Date());
	$effect(() => {
		const id = setInterval(() => (coarse = new Date()), 30_000);
		return () => clearInterval(id);
	});

	// THE COVERAGE.
	const coverage = $derived(row ? revisionCoverage(row, coarse) : null);
	const rep = $derived.by(() => {
		const cell = row?.services[0]?.slots[0]?.cell;
		if (!cell) return null;
		return {
			ns: cell.rollout.metadata?.namespace ?? '',
			name: cell.rollout.metadata?.name ?? '',
			cluster: cell.sourceCluster ?? ''
		};
	});

	/**
	 * A CARD PER BUCKET, AND THE ICON IS THE BUCKET'S OWN MEANING.
	 *
	 * Five buckets, five glyphs, each one saying in a second channel what the
	 * swatch says in colour — which is how the bar reads with no legend and no
	 * dummy graphic. The human has rejected legends twice; a card that IS the
	 * explanation is not one.
	 */
	const BUCKET_ICON: Record<CoverageKey, typeof CheckCircleSolid> = {
		live: CheckCircleSolid,
		failing: ExclamationCircleSolid,
		ahead: ArrowRightOutline,
		notYet: HourglassOutline,
		unplaceable: QuestionCircleOutline
	};

	// ── GATE CLEAR TIMES ────────────────────────────────────────────────────
	//
	// One GET per blocked rollout, cached by key, never blocking a render. The
	// endpoint is the one `ScheduleStatus` already reads and the arithmetic
	// lives in `api/schedules.ts` so the two surfaces cannot disagree about when
	// a window opens. Read-only.
	let windows = $state<Record<string, ScheduleWindow>>({});

	function slotKey(s: CoverageSlotVM): string {
		return s.rolloutRef
			? `${s.rolloutRef.cluster}/${s.rolloutRef.namespace}/${s.rolloutRef.name}`
			: '';
	}

	const blockedSlots = $derived.by<CoverageSlotVM[]>(
		() =>
			coverage?.buckets
				.find((b) => b.key === 'notYet')
				?.slots.filter((s) => s.blockingGates.length > 0) ?? []
	);

	$effect(() => {
		for (const s of blockedSlots) {
			if (s.notPassingGates.length === 0 || !s.rolloutRef) continue;
			const key = slotKey(s);
			if (windows[key]) continue;
			fetchScheduleWindow(s.rolloutRef.namespace, s.rolloutRef.name, s.rolloutRef.cluster)
				.then((w) => {
					windows = { ...windows, [key]: w };
				})
				.catch(() => {});
		}
	});

	/** The soonest a window blocking THIS build opens, across every place. */
	const opensIn = $derived.by(() => {
		let best: string | null = null;
		for (const s of blockedSlots) {
			const w = windows[slotKey(s)];
			if (!w?.blocked || !w.nextTransition) continue;
			if (!best || new Date(w.nextTransition) < new Date(best)) best = w.nextTransition;
		}
		return best;
	});

	const bannerFootnote = $derived.by(() => {
		const approval = [...new Set(blockedSlots.flatMap((s) => s.awaitingApprovalGates))];
		const windowGates = [...new Set(blockedSlots.flatMap((s) => s.notPassingGates))];
		const parts: string[] = [];
		if (windowGates.length > 0) {
			const until = opensIn ? formatTimeUntil(opensIn, $now) : null;
			parts.push(
				until
					? `A deployment window is closed — it opens in ${until} (${new Date(opensIn!).toLocaleString()}).`
					: `${windowGates.length} gate${windowGates.length === 1 ? '' : 's'} not passing: ${windowGates.join(', ')}.`
			);
		}
		if (approval.length > 0) {
			parts.push(
				`${approval.length} gate${approval.length === 1 ? '' : 's'} need an approval or an external check: ${approval.join(', ')}.`
			);
		}
		return parts.length > 0 ? parts.join(' ') : undefined;
	});

	const bannerMessage = $derived.by(() => {
		if (!coverage || blockedSlots.length === 0) return '';
		const envs = [...new Set(blockedSlots.map((s) => s.envLabel))].join(', ');
		const apps = [...new Set(blockedSlots.map((s) => s.appName))];
		const who = apps.length === 1 ? apps[0] : `${apps.length} services`;
		// THE BANNER SAYS THE BLOCK AND ONLY THE BLOCK — the hero directly under
		// it states the coverage at 24px over the bar that draws it.
		return `${who} cannot deploy it in ${envs} yet.`;
	});

	// THE ONE MUTATING CONTROL, and the same wiring as before: preselect
	// `ChangeVersionModal` on a tag `isDeployable` has already cleared. No new
	// mutation path, no one-click promote.
	let modalOpen = $state(false);
	let modalRollout = $state<Rollout | null>(null);
	let modalVersion = $state<string | null>(null);
	let modalCluster = $state<string | undefined>(undefined);

	function openPromote(slot: RevisionSlot, tag: string) {
		modalRollout = slot.cell.rollout;
		modalVersion = tag;
		modalCluster = slot.cell.sourceCluster || undefined;
		modalOpen = true;
	}

	const commitUrl = $derived.by<string | null>(() => {
		if (!ledger || !revision) return null;
		if (!ledger.repoKey.startsWith('repo:')) return null;
		const body = repoBody(ledger.repoKey);
		if (!body.includes('/')) return null;
		return `https://${body}/commit/${revision}`;
	});

	/** Where a place actually lives. Never `/apps/<name>` — see the header block. */
	function placeHref(s: CoverageSlotVM): string {
		if (!s.rolloutRef) return `/apps/${encodeURIComponent(s.appName)}`;
		return rolloutPath(
			s.rolloutRef.cluster || localClusterName,
			s.rolloutRef.namespace,
			s.rolloutRef.name
		);
	}

	/**
	 * WHY IT HAS NOT ARRIVED — NAMED ONLY FROM THE FIELD THAT ESTABLISHED IT.
	 *
	 * `blockingGates` is non-empty only when `promotionBlock` found real gates
	 * refusing every candidate; with no gate evidence this describes the
	 * OBSERVABLE and stops. `DESIGN.md`: *"`waiting on a gate` is a lie with
	 * better grammar."*
	 *
	 * WHAT CHANGED IS THE VOCABULARY, NOT THE EVIDENCE. It used to print
	 * `waiting on ghd-p2fld, schedule-gate-nwm62` — two generated object names
	 * and nothing else. The split is `promotionBlock`'s own and it is
	 * STRUCTURAL, never name-based: a gate that published an allow-list has an
	 * opinion and the answer is no, and only a person or an external system
	 * changes that; a gate with no allow-list that is simply not passing is
	 * time- or condition-bounded and clears on its own.
	 */
	type Reason = { icon: typeof HourglassOutline; tone: string; text: string; gates: string[] };

	function reasonsFor(s: CoverageSlotVM): Reason[] {
		const out: Reason[] = [];
		if (s.notPassingGates.length > 0) {
			const w = windows[slotKey(s)];
			const until = w?.blocked && w.nextTransition ? formatTimeUntil(w.nextTransition, $now) : null;
			out.push({
				icon: CalendarMonthSolid,
				tone: 'tone-mute',
				// ⭐ `HELD BY ghd-p2fld` IS GONE. The human named it as a string that
				// assumes the domain, and it is worse than that: `ghd-p2fld` is a
				// GENERATED object name, so the sentence's only content was an
				// identifier the reader has never seen. The names are evidence and
				// they still print, under the claim, in `gates` — where a reader who
				// does know the cluster can use them and one who does not can ignore
				// them.
				text: until
					? `Deploys here are paused for another ${until}`
					: w?.names.length
						? 'Deploys here are paused on a schedule'
						: 'A check has not passed yet — it clears on its own',
				gates: s.notPassingGates
			});
		}
		if (s.awaitingApprovalGates.length > 0) {
			out.push({
				icon: UserCircleSolid,
				tone: 'tone-mute',
				text: 'Needs an approval or an external check',
				gates: s.awaitingApprovalGates
			});
		}
		if (out.length === 0) {
			// NO GATE EVIDENCE. State the observable and stop.
			//
			// TWO DIFFERENT OBSERVABLES, AND THEY ARE NOT THE SAME SENTENCE. A
			// build the controller lists as a candidate here is one this place
			// could take next; a build it does not list is one the place will
			// never take, because newer builds sit in front of it. Printing
			// "not yet" over both is how the old page came to say *"blocked from
			// going further"* about a build nine steps back that no gate has an
			// opinion on.
			out.push({
				icon: HourglassOutline,
				tone: 'tone-mute',
				// NUMBER-NEUTRAL ON PURPOSE. Places sharing a reason render as ONE
				// row (see `notYetGroups`), so `this place runs X` would read as a
				// singular claim over thirteen chips.
				text: s.candidate
					? s.runs
						? `Ready to deploy — still on ${s.runs}`
						: 'Ready to deploy here'
					: s.runs
						? `Already on ${s.runs}, and newer builds are ahead of this one`
						: 'Skipped — newer builds are ahead of this one',
				gates: []
			});
		}
		return out;
	}

	/**
	 * ⭐ PLACES HELD FOR THE SAME REASON ARE ONE ROW, NOT THIRTEEN.
	 *
	 * Found by running the page against a 13-region fan-out under `MOCK_API=1`:
	 * `Not here yet` printed one row per place, and thirteen of them carried the
	 * byte-identical sentence *"Skipped — this place runs 7c14e2a, and newer
	 * builds are ahead of this one"*. That is the furniture the good pages never
	 * draw — a graphic (or a sentence) that is the same on every row carries no
	 * information after the first one, and it buried the two rows that DID have
	 * their own story.
	 *
	 * The bucket's design note said each place here has its own story, and that
	 * is true of a 3-environment app and false at 13 regions. So the grouping is
	 * on the STORY, not on a count: places whose reasons and gate names are
	 * identical collapse into one row whose environments are wrapped chips.
	 *
	 * A PLACE WITH AN ACTION NEVER GROUPS. `promoteTag` means a button, the
	 * button names its environment, and two buttons cannot share a row without
	 * the reader inferring the target from position — so those keep one row
	 * each, which is also where the reader most needs the room.
	 */
	type NotYetGroup = { key: string; appName: string; slots: CoverageSlotVM[]; reasons: Reason[] };

	function notYetGroups(slots: CoverageSlotVM[]): NotYetGroup[] {
		const out: NotYetGroup[] = [];
		for (const s of slots) {
			const reasons = reasonsFor(s);
			const key = s.promoteTag
				? `solo:${s.appName}/${s.envName}`
				: `${s.appName}|${reasons.map((r) => `${r.text}·${r.gates.join(',')}`).join('§')}`;
			let g = out.find((o) => o.key === key);
			if (!g) {
				g = { key, appName: s.appName, slots: [], reasons };
				out.push(g);
			}
			g.slots.push(s);
		}
		return out;
	}

	/**
	 * A BUCKET'S SLOTS, GROUPED TWICE — BY SERVICE, THEN BY WHAT EACH PLACE IS
	 * ACTUALLY RUNNING. Grouping by SERVICE makes criterion 2 structural;
	 * grouping again by RUNNING BUILD is what lets `Moved ahead` say `now on
	 * 9f10e49` once per service instead of once per environment. Environments
	 * become CHIPS THAT WRAP rather than rows that stack, so a 13-region service
	 * costs one wrapped line instead of thirteen rows.
	 */
	type RunsGroup = { runs: string | null; slots: CoverageSlotVM[] };
	type ServiceGroup = { appName: string; runs: RunsGroup[] };

	function groupSlots(slots: CoverageSlotVM[]): ServiceGroup[] {
		const out: ServiceGroup[] = [];
		for (const s of slots) {
			let g = out.find((o) => o.appName === s.appName);
			if (!g) {
				g = { appName: s.appName, runs: [] };
				out.push(g);
			}
			let r = g.runs.find((o) => o.runs === s.runs);
			if (!r) {
				r = { runs: s.runs, slots: [] };
				g.runs.push(r);
			}
			r.slots.push(s);
		}
		return out;
	}

	function rankChipFor(svc: RevisionService): {
		role: 'newest' | 'rank' | 'diverged';
		label: string;
	} | null {
		const r = rankSentence(svc);
		if (!r) return null;
		if (svc.diverged) return { role: 'diverged', label: 'diverged' };
		return { role: svc.rank === 0 ? 'newest' : 'rank', label: r.rank };
	}
</script>

<svelte:head>
	<title>kuberik | {row ? row.short : urlKey}</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<a
		href="/versions"
		class="t-micro mb-4 inline-flex items-center gap-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
	>
		<ArrowLeftOutline class="h-3 w-3" /> All revisions
	</a>

	{#if query.isLoading}
		<div class="flex items-center justify-center py-20"><Spinner size="6" /></div>
	{:else if query.isError}
		<div
			class="t-body rounded-lg border border-gray-200 p-4 text-red-700 dark:border-gray-700 dark:text-red-400"
		>
			Failed to load: {(query.error as Error).message}
		</div>
	{:else if !row || !ledger || !coverage}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<TagOutline class="mb-3 h-8 w-8 text-gray-500 dark:text-gray-400" />
			<h1 class="t-body font-semibold text-gray-900 dark:text-white">Revision not found</h1>
			<!--
				THE REPO CLAUSE ONLY PRINTS WHEN THERE IS A REPO. Naming a scope you
				do not have is the same defect as naming a cause you cannot evidence.
			-->
			<p class="t-body mt-1 max-w-md text-gray-500 dark:text-gray-400">
				{#if repoPath}
					Nothing in <span class="t-code">{repoPath}</span> knows the revision
					<span class="t-code">{urlKey}</span>.
				{:else}
					No revision matches <span class="t-code">{urlKey}</span>.
				{/if} This page covers every commit on a service's release ladder, deployed or not.
			</p>
		</div>
	{:else}
		<!--
			THE HERO — identity on the left, the measurement on the right, baselines
			aligned. Concept 07's anatomy. The eyebrow supplies the noun so the
			heading is only the sha, and the count is the page's one number.
			A PLACE IS A (SERVICE, ENVIRONMENT) SLOT AND THE LABEL SAYS SO.
			`/api/rollouts` carries no pod counts, so a pod ratio here would be
			invented; `places` is the honest unit and the caption names it.
		-->
		<!--
			⭐ THE HERO IS `RevisionLead`, THE SAME OBJECT `/versions` LEADS WITH.
			Identifier at 24px, state word beside it, measurement at 24px on the same
			baseline, the 26px bar directly under the count that names it. The list
			and the detail page are now ONE OBJECT AT TWO SCALES rather than two
			heroes that rhyme — which is what `REVISION-PAGES.md` asks of the bar,
			applied to the thing the bar sits inside.

			`spread={false}`: here the bucket CARDS are the spread, at full size and
			carrying the gates and the actions. Drawing both would print the same
			environments twice on one screen.
		-->
		<RevisionLead short={row.short} eyebrow="Tracking build" {coverage} spread={false}>
			{#snippet meta()}
				<span class="t-code-sm min-w-0 truncate text-gray-500 dark:text-gray-400"
					>{ledger.repoLabel}</span
				>
			{/snippet}
		</RevisionLead>

		<!--
			SECOND LINE OF THE HERO, AND IT DEGRADES HONESTLY. Concept 07 puts the
			commit message and author here. GitHub is not connected on this cluster —
			that is the SHIPPED STATE, not an edge case — so the line says which fact
			is missing and why, in one muted sentence, and takes no data row and no
			second button.
		-->
		{#if githubConnected && rep && prev}
			<div class="mt-2">
				<CommitSummary
					namespace={rep.ns}
					name={rep.name}
					cluster={rep.cluster}
					base={prev.revision}
					head={row.revision}
					verb={`in this build · since ${prev.short}`}
					showMessages
					showAvatars
				/>
			</div>
		{:else}
			<p class="t-micro mt-2 text-gray-500 dark:text-gray-400">
				Commit message and author need GitHub, which is not connected.
			</p>
		{/if}

		<!-- THE UNIT IS DEFINED WHERE ITS NUMBER IS, ON THE SCOPE LINE, in seven
		     words. `places live` was on the human's list of strings that assume the
		     domain, and the word cannot simply be dropped: `/api/rollouts` carries
		     no pod counts, so a (service, environment) slot is the honest unit and a
		     pod ratio would be invented. So the page says what it means, once. -->
		<p class="t-micro mt-1 text-gray-500 dark:text-gray-400">
			{row.services.length} service{row.services.length === 1 ? '' : 's'} · {coverage.totalCount} place{coverage.totalCount ===
			1
				? ''
				: 's'} (one service in one environment)
			{#if row.lastDeployMs}
				· last deployed {formatTimeAgo(new Date(row.lastDeployMs).toISOString(), $now)}
			{:else}
				· never deployed
			{/if}
		</p>

		<!--
			BUTTONS LOOK LIKE BUTTONS — `.btn`, 14px, 8px 16px, 8px radius, with an
			icon, exactly the geometry measured off `View on GitHub` on the reference
			page. It was a 12px black fill before, which is a size the rejected pages
			use and a weight the loudest control on a deploy surface should not have.
			SECONDARY, not primary: `View commit` is READ-ONLY, and the one filled
			action on a deploy surface must never be the read-only one.
		-->
		{#if neverDeployed}
			<!--
				THE PAGE WORKS FOR A BUILD NOBODY HAS RUN — that is the whole point of
				`RepoLedger.pending`, and this is the ONE sentence that changes. It sits
				with the scope line rather than under the cards, because it IS the
				scope: it tells the reader what the `0` in the hero means before they
				read a card that says where the build is not.
			-->
			<p class="t-dense mt-2 text-gray-600 dark:text-gray-300">
				No service has ever run this build. Everything here is a place it has not reached.
			</p>
		{/if}

		{#if commitUrl}
			<div class="mt-4 flex flex-wrap gap-2">
				<a class="btn btn-secondary" href={commitUrl} target="_blank" rel="noopener noreferrer">
					<ArrowUpRightFromSquareOutline class="h-4 w-4" />
					View commit
				</a>
			</div>
		{/if}

		<!--
			THE ONE BLOCKING FACT, AS A FILLED FIELD. `AlertPanel` IS the object
			rollout detail draws its schedule gate in — 40px circular icon, bold
			headline, the concrete consequence underneath, a chip on the right.
			ONE banner: a page with three has none.
		-->
		{#if blockedSlots.length > 0}
			<AlertPanel
				severity="warning"
				icon={blockedSlots.some((s) => s.notPassingGates.length > 0)
					? CalendarMonthSolid
					: UserCircleSolid}
				title="{row.short} can’t go any further yet"
				message={bannerMessage}
				footnote={bannerFootnote}
				class="mt-5"
			>
				{#snippet extra()}
					<Chip
						role="alarm"
						label="{blockedSlots.length} blocked"
						wide
						title="{blockedSlots.length} places — a place is one service in one environment — are waiting on a gate"
					/>
				{/snippet}
			</AlertPanel>
		{/if}

		<!--
			THE COVERAGE BAR. Full width, proportional, one segment per non-empty
			bucket. Same component the list rows carry at 8px, so the two pages are
			one idea at two scales.

			HOW IT READS WITH NO LEGEND: the hero states `N / M places live` directly
			above it, and every segment has a titled CARD below it whose header
			carries that segment's own fill at 12px, its name in 14px semibold and
			its count as the rollup. The explanation is the object, not a key built
			from a dummy graphic — which the human has rejected twice.
		-->

		<div class="rev-cols mt-4">
			<!--
				THE BUCKETS, AS TITLED CARDS. One per NON-EMPTY bucket, so a fully
				converged revision renders one card and a mid-promotion head renders
				three. The card lists its places, which is what makes the design hold
				at 4 prod regions and at 13: the bar is proportional and the buckets
				are LISTS, so N environments cost wrapped chips inside one card rather
				than columns across the page.
			-->
			<div class="rev-buckets">
				{#each coverage.buckets as bucket (bucket.key)}
					<Card
						icon={BUCKET_ICON[bucket.key]}
						iconClass={bucket.key === 'live'
							? 'tone-live'
							: bucket.key === 'failing'
								? 'tone-bad'
								: 'tone-mute'}
						title={bucket.title}
						verdict="{bucket.slots.length} place{bucket.slots.length === 1 ? '' : 's'}"
						verdictTitle={bucket.description}
						padded={false}
					>
						{#snippet rollup()}
							<!-- THE SWATCH IS THE BAR'S OWN FILL VALUE, at 12px, in the card
							     header — so the segment above and the card below are bound by
							     colour without a key row anywhere on the page. -->
							<span
								class="cov-swatch {coverageSwatch(bucket.key, coverage!.reachable)}"
								aria-hidden="true"
							></span>
							<span class="text-xs font-medium text-gray-500 dark:text-gray-400"
								>{bucket.slots.length} place{bucket.slots.length === 1 ? '' : 's'}</span
							>
						{/snippet}

						{#if bucket.key === 'notYet'}
							<!--
								ONE ROW PER PLACE, AND ONLY HERE. `Not yet` is the bucket whose
								places each have their OWN story — a different gate holding them,
								a different action — so a group heading cannot carry it, and this
								is the bucket that must stay actionable.
							-->
							<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
								{#each notYetGroups(bucket.slots) as g (g.key)}
									{@const solo = g.slots.length === 1 ? g.slots[0] : null}
									<li class="px-4 py-3">
										<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
											<!-- ⭐ THE SERVICE LEADS, ITS ENVIRONMENTS WRAP AFTER IT.
											     One row per REASON, not per place, so a 13-region fan-out
											     held by one gate is one row with thirteen chips instead
											     of thirteen rows carrying one sentence thirteen times.
											     The link goes to the ROLLOUT, never to `/apps/<name>`:
											     the rollout is the object the gate is attached to and
											     the page that can clear it. -->
											<a
												href={placeHref(g.slots[0])}
												class="t-body inline-flex min-w-0 items-center gap-1 text-gray-700 hover:underline dark:text-gray-200"
												title="Open the {g.slots[0].envLabel.toUpperCase()} rollout for {g.appName}"
												><span class="min-w-0 truncate">{g.appName}</span><ChevronRightOutline
													class="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400"
													aria-hidden="true"
												/></a
											>
											{#each g.slots as s (s.envName)}
												<!-- `[ENV][−N]` and nothing more, with `STUCK` loose 4px
												     beside it in the same `.chip-mark` group — the form
												     `StuckBadge` already ships on `/`, `/rollouts` and the
												     rollout detail page. -->
												<span class="chip-mark">
													{#if s.currentRank !== null && s.currentRank > 0}
														<span class="chip-joined">
															<Chip
																role="env"
																theme={s.slot.cell.theme}
																label={s.envLabel}
																wide
																title="{s.envLabel.toUpperCase()} — {s.statusWord}"
															/>
															<Chip role="rank" label={`−${s.currentRank}`} />
														</span>
													{:else}
														<Chip
															role="env"
															theme={s.slot.cell.theme}
															label={s.envLabel}
															wide
															title="{s.envLabel.toUpperCase()} — {s.statusWord}"
														/>
													{/if}
													{#if s.stuck}
														<Chip
															role="alarm"
															label="stuck"
															title="{s.envLabel.toUpperCase()} is stuck"
														/>
													{/if}
												</span>
											{/each}
										</div>

										<!-- CRITERION 3, ON THE ROW THAT STATES THE PROBLEM — and
										     each reason carries a glyph naming WHAT KIND of gate it
										     is, plus the clear time when the cluster publishes one. -->
										<div class="mt-2 flex flex-col gap-1.5">
											{#each g.reasons as r, i (i)}
												{@const ReasonIcon = r.icon}
												<div class="flex items-start gap-2">
													<ReasonIcon
														class="mt-0.5 h-4 w-4 shrink-0 {r.tone}"
														aria-hidden="true"
													/>
													<div class="min-w-0">
														<!-- THE SENTENCE FIRST, THE OBJECT NAMES UNDER IT.
														     Inline, the gate name's `whitespace-nowrap` pushed the
														     break INTO the sentence and orphaned `3h` on its own
														     line — the clear time, which is the one thing on the
														     row a reader came for, split in half to keep a
														     generated identifier whole. The names are evidence, so
														     they go under the claim they support and wrap among
														     themselves. -->
														<div class="t-body text-gray-600 dark:text-gray-300">{r.text}</div>
														{#if r.gates.length > 0}
															<div class="mt-0.5 flex flex-wrap gap-x-2">
																{#each r.gates as gate (gate)}
																	<span
																		class="t-code-sm text-gray-500 dark:text-gray-400"
																		title="Gate {gate}">{gate}</span
																	>
																{/each}
															</div>
														{/if}
													</div>
												</div>
											{/each}
										</div>

										{#if solo?.promoteTag}
											<!-- `secondary`, never `primary`: the loudest control on a
											     deploy surface must not be the one that changes
											     production. The label names the environment, because two
											     buttons reading `Promote` eight pixels apart have a
											     target the reader has to infer from position. And a
											     place with an action never shares a row, so this button
											     always has exactly one target. -->
											<div class="mt-2.5">
												<button
													type="button"
													class="btn btn-secondary"
													onclick={() => openPromote(solo.slot, solo.promoteTag!)}
													title={`Deploy ${row.short} to ${solo.appName} in ${solo.envName}`}
												>
													<ArrowRightOutline class="h-4 w-4" />
													Promote to {solo.envLabel}
												</button>
											</div>
										{/if}
									</li>
								{/each}
							</ul>
						{:else}
							<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
								{#each groupSlots(bucket.slots) as g (g.appName)}
									<li class="px-4 py-3">
										{#each g.runs as rg, gi (rg.runs ?? '—')}
											<div class="flex flex-wrap items-center gap-x-4 gap-y-2" class:mt-2={gi > 0}>
												<a
													href={placeHref(rg.slots[0])}
													class="t-body inline-flex min-w-0 items-center gap-1 text-gray-700 hover:underline dark:text-gray-200"
													title="Open the {rg.slots[0].envLabel.toUpperCase()} rollout for {g.appName}"
													><span class="min-w-0 truncate">{g.appName}</span><ChevronRightOutline
														class="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400"
														aria-hidden="true"
													/></a
												>
												{#each rg.slots as s (s.envName)}
													<!--
														`/apps`'s unit, character for character: the
														environment's badge, and nothing beside it unless the
														environment is stuck.
														`wide` IS LOAD-BEARING: `.chip` caps at 12ch, which is
														right in a fixed table track and wrong here —
														`prod-ap-south`, `prod-us-east` and `prod-us-west` all
														ellipsise to the same eight characters, the exact defect
														that killed the `/apps` convergence bar.
													-->
													<span class="chip-mark">
														<Chip
															role="env"
															theme={s.slot.cell.theme}
															label={s.envLabel}
															wide
															title="{s.envLabel.toUpperCase()} — {s.statusWord}"
														/>
														{#if s.stuck}
															<Chip
																role="alarm"
																label="stuck"
																title="{s.envLabel.toUpperCase()} is stuck"
															/>
														{/if}
													</span>
												{/each}
												<!-- WHAT TOOK ITS PLACE — once per (service, build), not
												     once per environment. -->
												{#if bucket.key !== 'live' && bucket.key !== 'failing' && rg.runs}
													<span class="t-micro ml-auto text-gray-500 dark:text-gray-400"
														>now on <span class="t-code-sm">{rg.runs}</span></span
													>
												{/if}
											</div>
										{/each}
									</li>
								{/each}
							</ul>
						{/if}

						<p
							class="t-micro border-t border-gray-100 px-4 py-2.5 text-gray-500 dark:border-gray-700/60 dark:text-gray-400"
						>
							{bucket.description}
						</p>
					</Card>
				{/each}
			</div>

			<!--
				CRITERION 2, IN THE RAIL. One rank per service, against that service's
				OWN denominator, with the denominator named. `newest of 4` beside
				`newest of 37` is the page's whole point — those two services share a
				source repo and nothing else, and collapsing them onto one ladder is
				the defect revision keying was built to close, one level down.
				It does NOT restate the buckets: the buckets say WHERE, this says WHAT
				EACH SERVICE CALLS IT and how far down its own ladder it now sits.
			-->
			<Card
				icon={TagSolid}
				title="What each service calls it"
				verdict="{row.services.length} service{row.services.length === 1 ? '' : 's'}"
				verdictTitle="One commit, one row per service — each service names and ranks it on its own"
				padded={false}
				class="self-start"
			>
				<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
					{#each row.services as svc (svc.appName)}
						{@const rank = rankSentence(svc)}
						{@const chip = rankChipFor(svc)}
						<!--
							ONE INK FOR A SERVICE NAME, ON BOTH REVISION PAGES. A service is
							never the subject of either page — the revision is — so it takes
							the secondary ink everywhere, and the three places that print it
							stop disagreeing about how important it is.
						-->
						<li class="rev-svc-row">
							<a
								href="/apps/{encodeURIComponent(svc.appName)}"
								class="t-body min-w-0 truncate text-gray-700 hover:underline dark:text-gray-200"
								>{svc.appName}</a
							>
							<span class="rev-svc-build">
								{#if chip && rank}
									<Chip
										role={chip.role}
										label={chip.label}
										title={svc.diverged
											? 'On no environment’s release list — promotion does not arrive at it'
											: `${chip.label} of the ${rank.of.replace('of ', '')} builds ${svc.appName} can deploy`}
										value={svc.label}
										valueTitle={svc.label}
										class="min-w-0"
									/>
									<span class="t-micro text-gray-500 dark:text-gray-400">{rank.of}</span>
								{:else}
									<!-- No number at all. A `0` here would read as "newest". -->
									<Chip
										role="unranked"
										label="unknown"
										title="This service does not list this build, so it has no position for it"
										value={svc.label}
										class="min-w-0"
									/>
								{/if}
							</span>
						</li>
					{/each}
				</ul>
				<!--
					THE ONE PIECE OF PROSE THIS CARD NEEDS, AND IT IS NOT A LEGEND.
					`newest` means DIFFERENT THINGS in different corners of this product
					— on a rollout it means "this rollout is on its newest build"; here
					it means "rank 0 on THIS service's own ladder". Two services sharing
					a source repo ship independent streams, and `newest of 4` beside
					`newest of 37` is only readable once that is said. It states the
					denominator's meaning, not a colour key.
				-->
				<p
					class="t-micro border-t border-gray-100 px-4 py-2.5 text-gray-500 dark:border-gray-700/60 dark:text-gray-400"
				>
					Every service counts its own builds, so <span class="t-code-sm">newest</span> here means
				newest for that service. Two services from one repo can be on different builds and both be
				up to date.
				</p>
			</Card>
		</div>

	{/if}

	<ChangeVersionModal
		bind:open={modalOpen}
		rollout={modalRollout}
		initialSelectedVersion={modalVersion}
		cluster={modalCluster}
	/>
</div>

<style>
	/*
	 * GEOMETRY AND THE THREE GLYPH INKS ONLY — everything else stays in
	 * utilities, per the `app.css` layering note: a Svelte-scoped rule outranks
	 * a Tailwind utility, so anything declared here is un-overridable from the
	 * markup.
	 */

	/* THE HERO'S GEOMETRY MOVED INTO `RevisionLead.svelte` WITH THE HERO. It was
	   `.rev-hero` / `.rev-count` here and a near-identical pair was about to be
	   written on `/versions`; one object owns it now, so the two pages cannot
	   drift apart by a gap value. */

	/* TWO COLUMNS WITH A REAL RIGHT RAIL — `COMPOSITION-GRAMMAR.md` §7. The
	   rail holds one self-contained card that answers "under what names", which
	   is a whole criterion on its own and never belonged underneath the
	   buckets where it read as a footnote to them. */
	.rev-cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 16px;
		align-items: start;
	}

	@media (min-width: 1024px) {
		.rev-cols {
			grid-template-columns: minmax(0, 1fr) 340px;
		}
	}

	/* Concept 07's card grid. `auto-fit` is what makes the design hold at any
	   bucket count: one bucket fills the row, three sit in a row of three at
	   1440 and stack at 390 with no breakpoint of their own. */
	.rev-buckets {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 16px;
		align-items: start;
	}

	/* THE THREE GLYPH INKS. Every value is one the product already owns: the
	   mint is the `newest` chip's and `ExposureBar`'s newest segment, so the
	   `Live here` card's tick is literally the same colour as the bar segment
	   it explains. Zero new colour values. */
	/* ⛔ THE THREE GLYPH INKS MOVED TO `app.css` AND MUST STAY THERE.
	   Declared here they were SCOPED, and the class lands on a `<Glyph>` —
	   a child component's `<svg>`, which Svelte 5 does not give the scoping
	   hash. The rules matched nothing; every glyph rendered PURE BLACK
	   (1.43:1 on the dark card). Do not move them back into a component. */

	/*
	 * NAME OVER BUILD — STACKED, AT EVERY WIDTH.
	 *
	 * It was `name | badge` on one line, right-aligned, which worked in a
	 * 1024px column and does not in a 340px rail: `hello-world-manifests` +
	 * a joined `[NEWEST][0afab6f]` + `of 32` measured 396px and the NAME was
	 * what ellipsised — `hello-world-mani…`. Truncating the identifier to keep
	 * a column is the same defect that killed the `/apps` convergence bar, in
	 * the other direction.
	 *
	 * Stacked, the binding is the line break, which is a stronger grouping cue
	 * than a shared right edge anyway; and every row is one name, one badge and
	 * one denominator, so the badge has exactly one possible referent.
	 */
	.rev-svc-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 16px;
		min-width: 0;
	}

	/* The DENOMINATOR gets a fixed track, so the badges right-align to one x
	   instead of to `of 4` / `of 35` / `of 37` — three different string widths,
	   which would leave the boxes ragged by 12px while claiming to be a column. */
	.rev-svc-build {
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
	}

	/*
	 * PHONE WIDTH IS A DESIGN, NOT A FALLBACK.
	 *
	 * THE HERO KEEPS ITS TWO COLUMNS AT 390, and that is a fold decision rather
	 * than a taste one. Stacked, the count and the degraded GitHub line cost
	 * ~90px above the cards, which at 390x844 pushed the banner — the one object
	 * on the page that can want a person — below the fold.
	 *
	 * The service rows become a two-line stack, because a name track plus a
	 * joined badge plus a denominator cannot share 358px without the badge
	 * ellipsising, and the badge is the one thing on the row that carries
	 * information the reader came for.
	 */
</style>
