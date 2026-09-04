<script lang="ts">
	import { Popover } from 'flowbite-svelte';
	import {
		CalendarWeekSolid,
		ClockSolid,
		ExclamationCircleSolid,
		CloseOutline
	} from 'flowbite-svelte-icons';
	import type { Rollout } from '$lib/types';
	import AlertPanel from './AlertPanel.svelte';
	import type { BlockingStory } from '$lib/view-models/blocking-story';
	import { iconForStory } from './BlockingStoryPanel.svelte';
	import { formatAbsoluteReopen, scheduleWindowQueryKey } from '$lib/api/schedules';
	import { createQuery } from '@tanstack/svelte-query';
	import { apiJson, pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';

	type RolloutSchedule = {
		metadata: { name: string; namespace: string };
		spec: {
			rules: Array<{
				name?: string;
				timeRange?: { start: string; end: string };
				daysOfWeek?: string[];
				dateRange?: { start: string; end: string };
			}>;
			timezone?: string;
			action: 'Allow' | 'Deny';
		};
		status: {
			active: boolean;
			activeRules?: string[];
			nextTransition?: string;
		};
	};

	type ClusterRolloutSchedule = {
		metadata: { name: string };
		spec: {
			rules: Array<{
				name?: string;
				timeRange?: { start: string; end: string };
				daysOfWeek?: string[];
				dateRange?: { start: string; end: string };
			}>;
			timezone?: string;
			action: 'Allow' | 'Deny';
		};
		status: {
			active: boolean;
			activeRules?: string[];
			nextTransition?: string;
		};
	};

	// `cluster` is the cluster name when the rollout lives on a remote cluster;
	// it's appended as ?cluster=<name> so the hub proxies the call to that cluster.
	// `compact` renders a single neutral line instead of the full amber
	// AlertPanel — for surfaces where the amber is reserved for `stuck` and a
	// time-bounded schedule wait is NOT stuck. Same data, same fetch, same
	// nextTransition maths; presentation only.
	// ⭐ `story` AND `onSchedules` EXIST TO STOP THIS COMPONENT SPEAKING FOR THE
	// WHOLE PAGE. A closed deploy window is often ONE of several things holding
	// a rollout, and this banner used to state it as if it were the only one —
	// which is how rollout detail came to say *"nothing promotes itself until
	// 1:00 PM"* about a rollout that was ALSO waiting on an upstream deploy and
	// an approval. When the parent hands down a `BlockingStory` that is actually
	// blocked, the banner renders the story's words; the schedule popover and
	// the not-blocked line are unchanged and still this component's job.
	//
	// `onSchedules` hands the already-fetched objects back UP so the parent can
	// build its gate→schedule join from them. A second `/schedules` request here
	// would be the third fetch of the same fact on one page.
	//
	// ⭐ `onMeta` HANDS UP A ONE-LINE FACT INSTEAD OF A BANNER. (F2, second
	// re-check, 2026-09-03) See `nothingWaiting`'s own comment for the defect:
	// a closed window with nothing queued behind it used to render its OWN
	// full-width `info` (blue) banner here, hue-keyed on "is anything
	// queued" — the same schedule gate painted amber on one rollout and blue
	// on another. The banner slot is reserved for a blocking fact now; a
	// closed-but-empty window is not one, so it hands its sentence UP as
	// plain text (`Deploys pause outside business hours · reopens 1:00 PM`)
	// for the parent to print beside the version, the way `isCurrentVersionCustom`
	// and the upgrade count already do in that row. `null` means "nothing to
	// say" — the parent clears whatever it was showing.
	let {
		rollout,
		cluster,
		compact = false,
		story = null,
		onSchedules,
		onMeta
	}: {
		rollout: Rollout;
		cluster?: string;
		compact?: boolean;
		story?: BlockingStory | null;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		onSchedules?: (schedules: any[]) => void;
		onMeta?: (text: string | null) => void;
	} = $props();

	/**
	 * ⭐ PERF-2026-09-04 §C.7 THIRD FOLLOW-UP — ON THE QUERY CLIENT, NOT A
	 * HAND-ROLLED `setInterval`.
	 *
	 * This used to be its own `fetch` + `$effect` + `setInterval(run, 30000)`,
	 * entirely outside TanStack: it never saw the change stream, never
	 * consulted `pollWhenHealthy`, and never got invalidated by a
	 * RolloutSchedule/ClusterRolloutSchedule event — one `/schedules` request
	 * every 30s, forever, stream healthy or not. Measured on the Overview
	 * with a schedule gate: 1 request/30s regardless of anything the stream
	 * already knew about.
	 *
	 * ⛔ KEEP THE SINGLE-PRIMITIVE-KEY LESSON. The ORIGINAL version of this
	 * effect read `rollout.metadata.namespace`/`.name` directly inside the
	 * effect body, so Svelte 5 tracked every property read on the whole
	 * reactive `rollout` object graph as a dependency — measured 153
	 * identical `/schedules` requests in 15 seconds (~10/s) on the one app
	 * with a schedule gate. The fix was `scheduleKey`, ONE derived string
	 * primitive as the effect's only tracked dependency. `createQuery`'s own
	 * `queryKey` is exactly that discipline, done the TanStack way:
	 * `scheduleWindowQueryKey` returns an array of PRIMITIVES (namespace,
	 * name, cluster — never the `rollout` object itself), so the query only
	 * re-subscribes when the rollout's IDENTITY changes, never when a poll
	 * or an unrelated field replaces the object.
	 *
	 * ⭐ ONE KEY, RECONCILED. `rollout-schedule-window` was already a
	 * recognized tag in `events.ts`'s per-kind invalidation map (added
	 * ahead of this component's own move, for `revisions`' on-demand
	 * `fetchScheduleWindow` calls) and a RolloutSchedule/ClusterRolloutSchedule
	 * event already invalidates it there — so wiring this component onto the
	 * SAME key needed no further change to the invalidation map, only to
	 * this component.
	 */
	const scheduleNamespace = $derived(rollout?.metadata?.namespace ?? '');
	const scheduleName = $derived(rollout?.metadata?.name ?? '');

	async function fetchAllSchedules(
		namespace: string,
		name: string,
		clusterName?: string
	): Promise<Array<RolloutSchedule | ClusterRolloutSchedule>> {
		const clusterParam = clusterName ? `?cluster=${encodeURIComponent(clusterName)}` : '';
		const data = await apiJson<{
			rolloutSchedules?: { items?: RolloutSchedule[] };
			clusterRolloutSchedules?: { items?: ClusterRolloutSchedule[] };
		}>(`/api/rollouts/${namespace}/${name}/schedules${clusterParam}`);
		return [...(data.rolloutSchedules?.items ?? []), ...(data.clusterRolloutSchedules?.items ?? [])];
	}

	const schedulesQuery = createQuery(() => ({
		queryKey: scheduleWindowQueryKey(scheduleNamespace, scheduleName, cluster),
		queryFn: () => fetchAllSchedules(scheduleNamespace, scheduleName, cluster),
		enabled: !!scheduleNamespace && !!scheduleName,
		// ⭐ CLUSTER-AWARE — this rollout's own cluster, not the fleet-wide
		// "every cluster up" gate. See rollout detail's identical comment.
		staleTime: staleTimeWhenHealthy(15000, 30000, cluster),
		refetchInterval: pollWhenHealthy(30000, 60000, cluster)
	}));

	let allSchedules = $derived(schedulesQuery.data ?? []);
	// `isPending` (no data yet, still on the FIRST fetch) — not `isLoading`
	// (`isPending && isFetching`), which would flip back to true on every
	// background poll and make the popover/banner flicker away and back on a
	// 30-60s cadence forever. See `$lib/api/errors`'s own doc comment on why
	// `isLoading` is the wrong primitive for this.
	let loading = $derived(schedulesQuery.isPending);
	let error = $derived(
		schedulesQuery.isError
			? schedulesQuery.error instanceof Error
				? schedulesQuery.error.message
				: 'Failed to load schedules'
			: ''
	);
	// `onSchedules` hands the fetched objects UP to the parent — same
	// semantics as the old callback at the end of the old `fetchSchedules`,
	// now firing off the query's own data instead of a local `$state` write.
	$effect(() => {
		if (schedulesQuery.data) onSchedules?.(schedulesQuery.data);
	});

	let dismissedWarnings = $state<Set<string>>(new Set());

	// Derived state for UI
	let isBlocked = $derived.by(() => {
		const blocking = allSchedules.filter((s) => {
			const { active } = s.status;
			const { action } = s.spec;
			return (action === 'Allow' && !active) || (action === 'Deny' && active);
		});
		return blocking.length > 0;
	});

	let isAllowed = $derived.by(() => {
		const blocking = allSchedules.filter((s) => {
			const { active } = s.status;
			const { action } = s.spec;
			return (action === 'Allow' && !active) || (action === 'Deny' && active);
		});
		const allowing = allSchedules.filter((s) => {
			const { active } = s.status;
			const { action } = s.spec;
			return (action === 'Allow' && active) || (action === 'Deny' && !active);
		});
		return allowing.length > 0 && blocking.length === 0;
	});

	let nextChange = $derived.by(() => {
		let earliestTransition: Date | null = null;
		for (const schedule of allSchedules) {
			if (schedule.status.nextTransition) {
				const transitionDate = new Date(schedule.status.nextTransition);
				if (!earliestTransition || transitionDate < earliestTransition) {
					earliestTransition = transitionDate;
				}
			}
		}
		return earliestTransition ? earliestTransition.toISOString() : null;
	});

	/**
	 * ⭐ THE ZONE BELONGS TO A SCHEDULE, NOT TO `nextChange`. (P2,
	 * operator-walk finding) `nextChange` is the earliest transition across
	 * every schedule this rollout carries — a page-level reduction with no
	 * timezone of its own. Formatting it against the reader's machine (the
	 * old `toLocaleString()`/`toLocaleTimeString()` behaviour) is exactly
	 * the ambiguity this fix removes, so the absolute clock is always
	 * printed against the SCHEDULE that owns the transition — found here by
	 * matching the ISO instant back to the object it came from. On the
	 * ordinary one-schedule rollout this is unambiguous; on the rare
	 * multi-schedule one it is still correct, because the zone printed is
	 * the zone of the window that is actually about to change.
	 */
	function scheduleForTransition(iso: string | null): RolloutSchedule | ClusterRolloutSchedule | null {
		if (!iso) return null;
		return allSchedules.find((s) => s.status.nextTransition === iso) ?? null;
	}

	let blockingSchedulesFull = $derived(
		allSchedules.filter((s) => {
			const { active } = s.status;
			const { action } = s.spec;
			return (action === 'Allow' && !active) || (action === 'Deny' && active);
		})
	);

	let blockingSchedules = $derived(blockingSchedulesFull.map((s) => s.metadata.name));

	const DAY_ORDER: Record<string, number> = {
		Monday: 0,
		Tuesday: 1,
		Wednesday: 2,
		Thursday: 3,
		Friday: 4,
		Saturday: 5,
		Sunday: 6,
		Mon: 0,
		Tue: 1,
		Wed: 2,
		Thu: 3,
		Fri: 4,
		Sat: 5,
		Sun: 6
	};
	const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	function formatDays(days: string[]): string {
		const sorted = [...days]
			.map((d) => (d in DAY_ORDER ? DAY_ORDER[d] : -1))
			.filter((i) => i >= 0)
			.sort((a, b) => a - b);
		if (sorted.length === 0) return days.join(', ');
		// Collapse consecutive runs into ranges (Mon-Fri).
		const ranges: string[] = [];
		let start = sorted[0];
		let prev = sorted[0];
		for (let i = 1; i <= sorted.length; i++) {
			if (i === sorted.length || sorted[i] !== prev + 1) {
				ranges.push(start === prev ? DAY_SHORT[start] : `${DAY_SHORT[start]}–${DAY_SHORT[prev]}`);
				if (i < sorted.length) {
					start = sorted[i];
					prev = sorted[i];
				}
			} else {
				prev = sorted[i];
			}
		}
		return ranges.join(', ');
	}

	function formatRule(
		rule: {
			name?: string;
			timeRange?: { start: string; end: string };
			daysOfWeek?: string[];
			dateRange?: { start: string; end: string };
		},
		timezone: string | undefined
	): string {
		const parts: string[] = [];
		if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
			parts.push(formatDays(rule.daysOfWeek));
		}
		if (rule.timeRange) {
			parts.push(`${rule.timeRange.start}–${rule.timeRange.end}`);
		}
		if (rule.dateRange) {
			parts.push(`${rule.dateRange.start} → ${rule.dateRange.end}`);
		}
		const body = parts.join(' · ') || rule.name || 'Always';
		return timezone ? `${body} (${timezone})` : body;
	}

	let allowingSchedules = $derived(
		allSchedules
			.filter((s) => {
				const { active } = s.status;
				const { action } = s.spec;
				return (action === 'Allow' && active) || (action === 'Deny' && !active);
			})
			.map((s) => s.metadata.name)
	);

	/**
	 * ⭐ A CLOSED WINDOW WITH NOTHING BEHIND IT IS INFORMATIONAL, NOT A
	 * STOPPAGE. (2026-09-03, operator-walk COSMETIC finding — the PROD
	 * `hello-world-app` page opened with a full-width AMBER `Automatic
	 * deploys are paused` banner while `Available Version Upgrades` said
	 * `up to date — no upgrades available` and `/` filed the same rollout
	 * under Steady.) `story?.blocked` is false whenever there is no candidate
	 * to hold back (`promotionBlock` returns `blocked: false` the moment
	 * `candidateCount === 0`), so this branch fell to the hard-coded
	 * `'warning'` fallback below EVEN THOUGH `story.candidateCount` — always
	 * handed down alongside `blocked`, see the call site's own note — already
	 * says there is nothing waiting.
	 *
	 * ⛔ THE FIRST FIX PAINTED IT BLUE, WHICH WAS A DIFFERENT WRONG ANSWER.
	 * (F2, second re-check, 2026-09-03 — from the human's own instrument:
	 * the SAME `Business Hours Only` gate rendered amber on dev
	 * `hello-world-app`, "Automatic deploys are paused", and blue on staging
	 * and prod, "Deploys pause outside business hours" — one gate, two hues,
	 * keyed on `nothingWaiting`, a variable no reader can see. The banner
	 * hue rule (`lib/CLAUDE.md`) is HUE = KIND, and a schedule gate is a
	 * RULE: it is amber whether or not anything happens to be queued behind
	 * it right now. `nothingWaiting` no longer picks a colour. It picks a
	 * SHAPE — see `metaText` below and this component's template: a closed,
	 * empty window is not a filled full-width banner at all, so the banner
	 * slot stays reserved for an actual blocking fact.
	 */
	let nothingWaiting = $derived(
		!!story && !story.pinnedTo && !story.blocked && story.candidateCount === 0
	);

	/**
	 * ⭐ THE ONE-LINE FORM `nothingWaiting` PRINTS INSTEAD OF A BANNER.
	 * (F2, second re-check, 2026-09-03) Handed up via `onMeta` so the parent
	 * can place it beside the version — the same row `isCurrentVersionCustom`
	 * and the upgrade count already share — rather than spending the page's
	 * one banner slot on a fact nobody needs to act on. The NEWS in this
	 * sentence is "nothing is waiting"; naming the window is what makes that
	 * news legible, so both ride in one short line: `Deploys pause outside
	 * business hours · reopens 09:00 America/New_York (13:00 UTC)`. No
	 * duration arithmetic here — a meta row is furniture, not a countdown;
	 * the clock TIME is enough. ⭐ P2: the absolute clock is stated against
	 * the SCHEDULE's own zone, never the reader's — see
	 * `formatAbsoluteReopen`'s own comment.
	 */
	let metaText = $derived.by(() => {
		if (!nothingWaiting) return null;
		return nextChange
			? `Deploys pause outside business hours · reopens ${formatAbsoluteReopen(nextChange, scheduleForTransition(nextChange)?.spec.timezone ?? null)}`
			: 'Deploys pause outside business hours';
	});

	$effect(() => {
		onMeta?.(metaText);
	});

	// Check if window is closing soon (within 1 hour)
	let isClosingSoon = $derived.by(() => {
		if (!nextChange) return false;
		const target = new Date(nextChange);
		const now = new Date();
		const diff = target.getTime() - now.getTime();
		const oneHour = 60 * 60 * 1000;
		return diff > 0 && diff <= oneHour;
	});

	// Generate unique key for this warning based on transition time
	let warningKey = $derived(nextChange ? `schedule-warning-${nextChange}` : '');

	// Check if this specific warning has been dismissed
	let isWarningDismissed = $derived(warningKey && dismissedWarnings.has(warningKey));

	function dismissWarning() {
		if (warningKey) {
			dismissedWarnings.add(warningKey);
			// Store in localStorage
			try {
				const stored = JSON.parse(localStorage.getItem('dismissedScheduleWarnings') || '{}');
				stored[warningKey] = true;
				localStorage.setItem('dismissedScheduleWarnings', JSON.stringify(stored));
			} catch (e) {
				// Ignore localStorage errors
			}
		}
	}

	// Load dismissed warnings from localStorage on mount
	$effect(() => {
		try {
			const stored = JSON.parse(localStorage.getItem('dismissedScheduleWarnings') || '{}');
			// Clean up old warnings (older than 24 hours)
			const now = Date.now();
			const cleaned: Record<string, boolean> = {};
			for (const [key, value] of Object.entries(stored)) {
				const match = key.match(/schedule-warning-(.+)/);
				if (match) {
					const transitionTime = new Date(match[1]).getTime();
					if (now - transitionTime < 24 * 60 * 60 * 1000) {
						cleaned[key] = value as boolean;
						dismissedWarnings.add(key);
					}
				}
			}
			localStorage.setItem('dismissedScheduleWarnings', JSON.stringify(cleaned));
		} catch (e) {
			// Ignore localStorage errors
		}
	});

	function formatTimeUntil(isoString: string): string {
		const target = new Date(isoString);
		const now = new Date();
		const diff = target.getTime() - now.getTime();

		if (diff < 0) return 'now';

		const minutes = Math.floor(diff / 1000 / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) return `${days}d ${hours % 24}h`;
		if (hours > 0) return `${hours}h ${minutes % 60}m`;
		return `${minutes}m`;
	}

	/**
	 * ⭐ THE ABSOLUTE HALF NOW COMES FROM `api/schedules.ts`, ZONE-AWARE.
	 * (P2, operator-walk finding, second pass) This file used to carry two
	 * hand-rolled formatters — `formatTime` (`toLocaleString()`, full date,
	 * seconds, the READER's machine zone) and `formatClockTime`
	 * (`toLocaleTimeString()`, no date/seconds, still the reader's machine
	 * zone) — and both were the same class of bug at different severities:
	 * neither ever named WHOSE clock it was reading. Measured live: a rule
	 * labelled `9 AM - 5 PM EST` reopened at `(9/3/2026, 1:00:00 PM)` with
	 * no zone printed anywhere, and `EST` in September is itself wrong (the
	 * US is on daylight time) — the schedule's own `spec.timezone` (an IANA
	 * name) was sitting on the object the whole time and nothing read it.
	 *
	 * `formatAbsoluteReopen` is that fix, shared with `blocking-story.ts`'s
	 * own clock loop so the two cannot drift back apart the way `formatTime`
	 * and `formatClockTime` already had (one with seconds, one without, both
	 * silently local). Every call site below now hands it the ZONE off the
	 * schedule the instant belongs to — `scheduleForTransition` for the
	 * page-level `nextChange` figure, the gate's own carried `.timezone` for
	 * `shapedConsequence`, and the schedule object directly inside the
	 * popover's per-schedule loop.
	 */
	function shapedConsequence(s: BlockingStory | null | undefined): string {
		if (!s) return '';
		if (s.gates.length === 1 && s.clock.length === 1 && s.clearsAt) {
			const n = s.candidateCount;
			const lead = n > 0 ? `${n} newer build${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} waiting. ` : '';
			return `${lead}Nothing promotes itself for another ${formatTimeUntil(s.clearsAt)} — ${formatAbsoluteReopen(s.clearsAt, s.clock[0].timezone)}.`;
		}
		return s.consequence;
	}
</script>

{#if compact}
	<!-- Compact form: one line, neutral. A schedule block has a clock and
	     clears on its own, so it must not borrow the amber that means `stuck`. -->
	{#if !loading && !error && allSchedules.length > 0 && isBlocked}
		<!-- On the type scale (`t-micro`, 11/400) and the 4px spacing scale.
		     The calendar glyph is gone: it needed a 2px optical nudge that
		     exists on no scale, and the sentence already says "window". -->
		<p class="t-micro text-gray-500 dark:text-gray-400">
			{#if nextChange}
				Automatic deploys resume in <span class="text-gray-600 dark:text-gray-300"
					>{formatTimeUntil(nextChange)}</span
				>
				· {formatAbsoluteReopen(nextChange, scheduleForTransition(nextChange)?.spec.timezone ?? null)}
			{:else}
				<!-- (2026-09-03, vocabulary pass) The generic obstacle noun is
				     `rule` everywhere — this used to say `1 schedule` while the
				     app page's disclosure for the SAME gate said `1 rule`, 90px
				     apart on the live product. `schedule` stays as the KIND word
				     where the kind is what matters (the popover this button
				     opens); the count itself now agrees with every other count
				     in the product. -->
				Held by {blockingSchedules.length} rule{blockingSchedules.length === 1 ? '' : 's'}
			{/if}
		</p>
	{/if}
{:else if !loading && !error && allSchedules.length > 0}
	<!--
		⛔ `isBlocked` ALONE WAS THE HIDDEN SECOND SOURCE OF THE PINNED BANNER.
		(2026-09-03, operator-walk finding) This branch decides whether to
		render its OWN `AlertPanel` from `isBlocked` — a value computed purely
		from this component's own raw schedule fetch, independent of `story`.
		Once blocked it borrows `story`'s WORDS (see the branch below), but
		never asked whether the CALLER was already going to render a banner
		for that same `story`. `blockingStory()`'s pin branch is a short-circuit
		that spreads `...NOT_BLOCKED` and never reaches the gate-classification
		code that populates `clock` — so a pinned rollout always has
		`story.clock.length === 0`, which is precisely the signal rollout
		detail used to decide THIS component wasn't already covering the
		gate. Pinning `hello-world-app/dev` rendered this banner (blue,
		`story.headline`/`story.consequence`, a `1 schedule` chip that no
		longer matched the sentence above it once that sentence stopped being
		about the schedule) AND the page's own `<BlockingStoryPanel>` with the
		BYTE-IDENTICAL headline and consequence, one panel apart. A pin
		outranks every gate including a schedule (`blocking-story.ts`'s own
		comment), so the ONE banner for a pinned rollout is the caller's, not
		this popover's — `!story?.pinnedTo` is the guard.
	-->
	{#if isBlocked && !story?.pinnedTo && !nothingWaiting}
		<!--
			⛔ THIS BANNER USED TO SAY SOMETHING FALSE, AND IT WAS FALSE FOR
			EXACTLY THE ACTION THE READER WAS ABOUT TO TAKE.

			It said *"Deployments currently blocked. Will be allowed in 2d 1h."*
			A live UX critique read that, pressed the blue `Deploy` twelve pixels
			below it, typed the sha, and **production changed immediately** — and
			the page then rendered the new version `Deploying` with this banner
			still above it.

			The controller is unambiguous about why
			(`rollout_controller.go`, gating logic):

			    if !r.hasManualDeployment(&rollout) && len(history) > 0 {
			        if !gatesPassing { return }   // nothing happens
			    }

			and `hasManualDeployment` is true whenever `spec.wantedVersion` is set
			or the `force-deploy` annotation is present — i.e. for every deploy a
			person starts from this page. **A gate holds back AUTOMATIC PROMOTION
			ONLY.** So the banner names what is actually paused, and the second
			line states the other half rather than leaving the reader to discover
			it by changing production.

			Composition is untouched: same `AlertPanel`, same `warning`, same
			calendar glyph, same chip on the right. Only the words moved.
		-->
		<!-- ⭐ THE WORDS COME FROM THE PAGE'S STORY WHEN THERE IS ONE. Same
		     `AlertPanel`, same glyph, same chip — only the sentence widens from
		     "a window is closed" to every gate actually holding this rollout,
		     each with whether it clears on a clock, on another deploy, or on a
		     person. The fallback below is the schedule-only wording, which is
		     still correct on a surface that hands down no story.

		     ⭐ ALWAYS `warning` HERE NOW. (F2, second re-check, 2026-09-03) A
		     schedule gate is a RULE, and hue is a function of KIND, never of
		     "is anything queued behind it" — see `nothingWaiting`'s own
		     comment for the live measurement that caught this branch
		     rendering the SAME gate amber on one rollout and blue on another.
		     The `nothingWaiting` case no longer reaches this branch at all
		     (guarded above): it has no candidate to name and no verdict to
		     print, so it is not a banner, it is `metaText`, handed to the
		     parent to print beside the version instead. -->
		<AlertPanel
			severity="warning"
			title={story?.blocked ? story.headline : 'Automatic deploys are paused'}
			message={story?.blocked
				? shapedConsequence(story)
				: nextChange
					? `Nothing promotes itself for another ${formatTimeUntil(nextChange)} — ${formatAbsoluteReopen(nextChange, scheduleForTransition(nextChange)?.spec.timezone ?? null)}. A deploy you start by hand still applies immediately.`
					: 'Nothing promotes itself while this schedule is closed. A deploy you start by hand still applies immediately.'}
			footnote={story?.blocked ? story.resolution : undefined}
			icon={story?.blocked ? iconForStory(story) : CalendarWeekSolid}
			pulse
		>
			{#snippet actions()}
				<button
					type="button"
					id="schedule-details"
					class="flex cursor-pointer items-center gap-1.5 rounded-lg bg-amber-800/10 px-3 py-1.5 text-xs font-medium text-amber-900 ring-1 ring-amber-400/30 transition hover:bg-amber-800/15 hover:ring-amber-400/50 dark:bg-white/10 dark:text-white/90 dark:ring-white/20 dark:hover:bg-white/15"
				>
					<!-- (2026-09-03, vocabulary pass) Was `N schedule(s)` — the
					     generic obstacle noun is `rule` everywhere; see the
					     compact-form note above. -->
					{blockingSchedules.length} rule{blockingSchedules.length > 1 ? 's' : ''}
				</button>
			{/snippet}
		</AlertPanel>
		<Popover
			triggeredBy="#schedule-details"
			placement="bottom-end"
			arrow={false}
			defaultClass=""
			class="z-20 w-96 max-w-[90vw] rounded-xl border border-amber-300/70 bg-gradient-to-br from-amber-50 via-white to-amber-50 p-0 text-amber-950 shadow-2xl shadow-amber-300/30 dark:border-amber-700/60 dark:from-amber-950 dark:via-amber-900/80 dark:to-amber-950 dark:text-amber-50 dark:shadow-amber-950/50"
		>
			<div class="border-b border-amber-200/70 px-4 py-3 dark:border-amber-800/60">
				<div class="flex items-center gap-2">
					<CalendarWeekSolid class="h-4 w-4 text-amber-600 dark:text-amber-300" />
					<p class="text-sm font-semibold tracking-tight">
						<!-- (2026-09-03, vocabulary pass) `deploy window` is the KIND
						     word this product uses for a schedule gate everywhere
						     else (`GateRecord`'s `Kind` field, `BlockReason`'s
						     `check or deploy window`) — this popover was the one
						     surface still saying `schedule`. -->
						{blockingSchedulesFull.length === 1
							? 'Deploy window holding automatic deploys'
							: 'Deploy windows holding automatic deploys'}
					</p>
				</div>
			</div>
			<ul class="divide-y divide-amber-200/60 dark:divide-amber-800/40">
				{#each blockingSchedulesFull as schedule}
					<li class="px-4 py-3">
						<div class="mb-2 flex items-center justify-between gap-2">
							<span class="truncate text-sm font-medium text-amber-900 dark:text-amber-100">
								{schedule.metadata.name}
							</span>
							<span
								class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 {schedule
									.spec.action === 'Deny'
									? 'bg-red-100 text-red-700 ring-red-300/60 dark:bg-red-500/20 dark:text-red-200 dark:ring-red-700/50'
									: 'bg-gray-100 text-green-700 ring-gray-200 dark:bg-gray-700 dark:text-green-400 dark:ring-gray-600'}"
							>
								{schedule.spec.action}
							</span>
						</div>
						{#if schedule.spec.rules?.length}
							<ul class="space-y-1">
								{#each schedule.spec.rules as rule}
									<li class="flex items-start gap-2 text-xs text-amber-800/90 dark:text-amber-200/85">
										<ClockSolid class="mt-0.5 h-3 w-3 shrink-0 text-amber-500/80 dark:text-amber-400/80" />
										<span class="break-words">{formatRule(rule, schedule.spec.timezone)}</span>
									</li>
								{/each}
							</ul>
						{/if}
						{#if schedule.status?.nextTransition}
							<p class="mt-2 text-xs text-amber-700/80 dark:text-amber-300/70">
								Automatic deploys resume in <span class="font-medium"
									>{formatTimeUntil(schedule.status.nextTransition)}</span
								>
								· {formatAbsoluteReopen(schedule.status.nextTransition, schedule.spec.timezone ?? null)}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		</Popover>
	{:else if isAllowed && isClosingSoon && !isWarningDismissed}
		<AlertPanel
			severity="warning"
			title="Automatic deploys pause soon"
			message={`Nothing will promote itself after ${formatTimeUntil(nextChange!)} — ${formatAbsoluteReopen(nextChange!, scheduleForTransition(nextChange!)?.spec.timezone ?? null)}. Deploys you start by hand are not affected.`}
			icon={ClockSolid}
		>
			{#snippet actions()}
				<button
					type="button"
					onclick={dismissWarning}
					class="inline-flex items-center rounded-lg p-1.5 text-amber-700 transition hover:bg-amber-200/60 dark:text-amber-300 dark:hover:bg-amber-800/40"
					aria-label="Dismiss"
				>
					<CloseOutline class="h-5 w-5" />
				</button>
			{/snippet}
		</AlertPanel>
	{/if}
{/if}
