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
	// THE PRODUCT'S ONE RANK VOCABULARY. This page prints exactly one of its
	// words — `unreleased` — and it takes it from here rather than spelling it.
	import { rankLabel } from '$lib/view-models/env-rank';
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
		coverageSegments,
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
		ClockOutline,
		CodeBranchOutline,
		ExclamationCircleSolid,
		FolderOutline,
		HourglassOutline,
		LayersOutline,
		LockSolid,
		QuestionCircleOutline,
		RocketOutline,
		TagOutline,
		TagSolid,
		UserCircleSolid
	} from 'flowbite-svelte-icons';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import FactList, { type Fact } from '$lib/components/FactList.svelte';
	import Card from '$lib/components/Card.svelte';
	import CommitSummary from '$lib/components/CommitSummary.svelte';
	import ChangeVersionModal from '$lib/components/ChangeVersionModal.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import CoverageBar from '$lib/components/CoverageBar.svelte';
	import type { Rollout, Environment } from '../../../types';
	import { pollWhenHealthy } from '$lib/api/errors';
	import ErrorState from '$lib/components/ErrorState.svelte';
	// THE REPO, NOT THE URL IT IS FETCHED FROM — one spelling with `/versions`.
	import { repoTitle, repoTitleFull } from '../repo-title';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';

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
		rolloutsListQueryOptions({
			options: { staleTime: 10000, refetchInterval: pollWhenHealthy(10000) }
		})
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

	/**
	 * ⭐ THE DISCLOSED TIER IS A RECORD, AND THE TRIGGER COUNTS. (2026-09-02)
	 * Same object, same argument, same shape as `/versions`' banner — see the
	 * note there and `lib/disclosure.ts` for the rule that decides between a
	 * noun and a count. A SET of gate handles with a clock in front of it is
	 * not a sentence, and it had been narrated as one.
	 */
	const bannerFacts = $derived.by<Fact[]>(() => {
		const approval = [...new Set(blockedSlots.flatMap((s) => s.awaitingApprovalGates))];
		const windowGates = [...new Set(blockedSlots.flatMap((s) => s.notPassingGates))];
		const facts: Fact[] = [];
		// ⛔ ONLY WHERE THERE IS A CLOCK. `opens` with nothing after it is a
		// broken row, not a terse one.
		if (windowGates.length > 0 && opensIn) {
			facts.push({
				label: 'Opens',
				value: `in ${formatTimeUntil(opensIn, $now)} · ${new Date(opensIn).toLocaleString()}`
			});
		}
		for (const name of windowGates) facts.push({ label: 'Not passing', value: name, handle: true });
		for (const name of approval) facts.push({ label: 'Approval', value: name, handle: true });
		return facts;
	});

	/** The SET the trigger counts: gate handles, both buckets, never the clock. */
	const bannerRuleCount = $derived(bannerFacts.filter((f) => f.handle).length);

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

	/**
	 * ⭐ PER-PLACE AGE, FOR THE `live` BUCKET ONLY. (F13, 2026-09-03)
	 *
	 * `Running it now` used to print an environment's chip and stop —
	 * `hello-api-app › DEV STAGING PROD` — leaving 65.9% of the card's
	 * height-matched row empty while `This build` beside it ran to 249px of
	 * real content. The fact was already on the wire and unused: a slot in
	 * this bucket is CURRENTLY running the row's own revision, which by
	 * `revision-ledger.ts`'s own `onIt = cur === revision` derivation means
	 * `history[0]` IS that deploy — the same entry `currentKeyOf` reads to
	 * decide `onIt` in the first place. So the age is not a new fetch or a
	 * new field, only a read of a timestamp that was already being compared.
	 *
	 * Three environments running one build rarely arrived at the same
	 * moment — DEV got it days before PROD did — so this also answers a
	 * question the bare chip row could not: how long has EACH place actually
	 * had it, not just the row's own single `last deployed N ago`.
	 */
	function slotDeployedAgo(s: CoverageSlotVM): string | null {
		const ts = s.slot.cell.rollout?.status?.history?.[0]?.timestamp;
		return ts ? formatTimeAgo(ts, $now) : null;
	}

	/**
	 * ⭐ PER-SERVICE ENV PINS, ON `What each service calls it`. (F13,
	 * 2026-09-03)
	 *
	 * The card's row was a name, a rank chip and an `of N` — one line, done,
	 * while its neighbour `This build` ran on for five. `spec.wantedVersion`
	 * is already on every slot's own `rollout` (the same object `promoteTag`
	 * reads three lines up in `revision-ledger.ts`), so a service pinned
	 * somewhere is a fact this page already has and was not saying — and it
	 * is directly relevant to the row it sits under: a reader looking at
	 * `hello-api-app · NEWEST · of 1` benefits from knowing PROD will not
	 * move off it even though nothing is holding it, because it is pinned.
	 */
	function pinnedEnvsOf(svc: RevisionService): string[] {
		return svc.slots
			.filter((s) => s.cell.rollout?.spec?.wantedVersion)
			.map((s) => s.envName.toUpperCase());
	}

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
			//
			// ⭐ AND A THIRD CASE, FOUND ON THE LIVE CLUSTER: THE ENVIRONMENT IS
			// ALREADY ON THIS REVISION. (2026-09-02, design re-check.) `s.slot.onIt`
			// is a git-sha match — true whenever the running release shares the
			// row's own commit, whatever RANK that release sits at. Two releases
			// of one revision are how a rollback re-deploys a build already
			// shipped once, under a new tag (`revision-coverage.ts`'s
			// two-denominator note): rel-66 and rel-67 can be the SAME commit,
			// with rel-67 simply the newer, still-held release of it. "Newer
			// builds are ahead of this one" is a lie there — nothing newer has
			// arrived, this place is already running the row's revision, just
			// under an older label than the row's own newest release of it.
			const heldNewerRelease =
				s.slot.onIt && s.runs && s.label && s.runs !== s.label ? s.label : null;
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
					: heldNewerRelease
						? `Running ${s.runs} of this revision; ${heldNewerRelease} is held`
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
		// ⛔ THE WORD COMES FROM `rankLabel`, NOT FROM THIS FILE. (2026-09-01)
		// It said `diverged` — git's word for two branches — while `/apps`,
		// `/environments` and `/envs/*` all said `unreleased`, which is the
		// fact: this build is on no environment's release list. One fact, one
		// spelling, and it is now READ from the product's one formatter so
		// this call site cannot drift again. Same `diverged` Chip ROLE, same
		// colour value; only the string moves.
		if (svc.diverged) return { role: 'diverged', label: rankLabel({ kind: 'diverged' }) };
		return { role: svc.rank === 0 ? 'newest' : 'rank', label: r.rank };
	}
</script>

<svelte:head>
	<title>kuberik | {row ? row.short : urlKey}</title>
</svelte:head>

<div class="rev-cq mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<a
		href="/versions"
		class="t-micro mb-4 inline-flex items-center gap-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
	>
		<ArrowLeftOutline class="h-3 w-3" /> All revisions
	</a>

	<!--
		⭐ THE HUB FAILS SOFT. `/api/rollouts` answers 200 with the spokes that
		replied and names the ones that did not in `clusterErrors`, so this page
		can be PARTLY true — and until now only `/` and `/rollouts` said so.
		A rollout on an unreachable spoke is absent from every count here, and
		absent is not healthy. Renders nothing when every cluster answered.
	-->
	<PartialDataNotice
		errors={query.data?.clusterErrors ?? []}
		subject="this revision"
		onRetry={() => query.refetch()}
		isRetrying={query.isFetching}
	/>

	{#if query.isLoading}
		<StillTryingNotice failureCount={query.failureCount} class="mt-4 mb-0" />
		<div class="flex items-center justify-center py-20"><Spinner size="6" /></div>
	{:else if query.isError}
		<!--
			⛔ WAS `Failed to load: <status code>` IN A ONE-LINE RED BOX. With
			`/api/rollouts` at 503 that left the page as a title and a whisper —
			indistinguishable at a glance from this page's own empty state, which
			is the reading that gets an operator to go back to bed at 3am. A
			request that FAILED is a different fact from one that succeeded and
			returned nothing, and `ErrorState` is the object that says so.
		-->
		<ErrorState
			error={query.error}
			subject="this revision"
			backHref="/versions"
			backLabel="Back to all revisions"
			onRetry={() => query.refetch()}
			isRetrying={query.isFetching}
			class="mt-4"
		/>
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
			⭐ THE HERO IS THE HEAD BAND NOW, THE SAME ROW `/versions`, `/activity`
			AND `/dependencies` LEAD WITH. (2026-09-02, design re-check: *"the
			hero is eight ungrouped lines on the page ground … the page's rollup
			floating 1180px away top-right; it is the one region with no card."*)

			`RevisionLead`'s two-column hero (eyebrow / sha / count / bar) is gone
			from THIS page — it stays exactly as it was on `/versions`, where it
			leads a card and is the page's only object. Here the object is named
			ONCE, at display scale, in one row: an `sr-only` `h1` (the object's
			full name, for the outline and for a screen reader), the sha at
			`t-display-id`, and the coverage count at `t-display` on its baseline.
			Everything else this build has to say — the commit, the repo, the
			services, when it last moved, the outbound link — moved into ONE
			titled card below (`This build`), which is also the card that gives
			the page's previously 39%-empty viewport something to hold. See the
			`rev-buckets` block for it.

			⛔ `BuildStateMark` USED TO SIT HERE TOO, AND IT WAS A SECOND
			STATEMENT OF THE SAME NUMBER. (2026-09-02, residue.) `3 of 6 places
			running it` and, 40px later, `⧗ 3 places still to go` say one fact
			twice — the second is `buildState()`'s word for whichever bucket
			dominates, and on THIS page that bucket already has its own titled
			card with its own count (`Not here yet · 3 places`). The count stays
			here ONCE; the state word lives on the card that owns it. `/versions`'
			list row had the identical duplication (the word beside the sha,
			`Running in N of M places` in the roll column) and is fixed the same
			way — see the comment there.
		-->
		<div class="mb-5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
			<h1 class="sr-only">Tracking build {row.short} in {repoTitle(ledger.repoLabel)}</h1>
			<span class="t-display-id text-gray-900 dark:text-white">{row.short}</span>
			<span class="t-display text-gray-900 tabular-nums dark:text-white"
				>{coverage.liveCount}</span
			>
			<span
				class="t-body text-gray-500 dark:text-gray-400"
				title="A place is one service in one environment."
				>of {coverage.totalCount} places running it</span
			>
		</div>

		<!--
			THE ONE BLOCKING FACT, AS A FILLED FIELD. `AlertPanel` IS the object
			rollout detail draws its schedule gate in — 40px circular icon, bold
			headline, the concrete consequence underneath, a chip on the right.
			ONE banner: a page with three has none.
		-->
		{#if blockedSlots.length > 0}
			<!-- ⭐ THE RECORD. One aligned `<dl>`, the product's only one, reading
			     `currentColor` off the banner's own footnote ink. -->
			{#snippet gateFacts()}
				<FactList facts={bannerFacts} tone="banner" />
			{/snippet}

			<AlertPanel
				severity="warning"
				icon={blockedSlots.some((s) => s.notPassingGates.length > 0)
					? CalendarMonthSolid
					: UserCircleSolid}
				title="{row.short} can’t go any further yet"
				message={bannerMessage}
				footnoteBody={bannerRuleCount > 0 ? gateFacts : undefined}
				footnoteCount={bannerRuleCount > 0 ? bannerRuleCount : undefined}
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
			⭐ ONE FLAT 2-COLUMN GRID NOW, NOT A RAIL. (2026-09-02, design
			re-check, two rounds: first *"the three cards in the side-by-side row
			end at 460 / 538 / 546 — 86px of rag"*, then *"`This build | Running
			it now | Not here yet` on row 1 and `What each service calls it`
			alone on row 2 with two empty tracks beside it."*) `This build`, the
			bucket cards and `What each service calls it` used to split across
			two grid levels — a `rev-buckets` sub-grid plus a fixed-340px rail —
			each with its OWN `align-items: start`, so a rail taller than the
			buckets (or the reverse) just left a gap. Cards are `flex flex-col`
			with a `grow` body for exactly this case (see the comment on
			`Card.svelte`'s `<section>`); `align-items: stretch` plus one grid
			instead of two makes every card sharing a row share that row's
			height. `class="self-start"` came off the former rail card — it was
			opting that one card OUT of the stretch this fix depends on.

			AND `auto-fit` GAVE WAY TO A FIXED 2 COLUMNS, because a THIRD track
			at 1440 is exactly what stranded the fourth card alone. `What each
			service calls it` moved up to sit right beside `This build` — both
			are about the BUILD — so the bucket cards, both about PLACES, fill
			row 2 on. See the CSS for the rest (the 2-column breakpoint and the
			odd-card-spans-both-tracks rule).
		-->
		<div class="rev-buckets mt-4">
			<!--
				⭐ `This build` — THE CARD THE HERO'S FACTS MOVED INTO. (2026-09-02)
				Commit, repo, services, last deployed and the outbound link were
				eight ungrouped lines on the page ground with no card of their own —
				the one region on this page without one. The coverage bar shrinks to
				a ROW-SCALE mark in the header (`compact`, same object the list rows
				carry at 8px) rather than repeating the head band's `N of M` in
				digits a fourth time; its accessible name carries the full sentence
				for anyone who cannot see the segments.
			-->
			<Card icon={RocketOutline} title="This build">
				{#snippet rollup()}
					<CoverageBar
						segments={coverageSegments(coverage)}
						compact
						class="w-20"
						label="{coverage.liveCount} of {coverage.totalCount} places running {row.short} · {coverage.buckets
							.map((b) => `${b.slots.length} ${b.title.toLowerCase()}`)
							.join(' · ')}"
					/>
				{/snippet}
				<ul class="space-y-3">
					<!--
						THE COMMIT — DEGRADES HONESTLY. Concept 07 puts the commit message
						and author here. GitHub is not connected on this cluster — that is
						the SHIPPED STATE, not an edge case — so the row says which fact is
						missing and why, and takes no data row and no second button.
						`CommitSummary` draws its own branch glyph, so the row's icon track
						is not doubled with a second one in the connected case.
					-->
					{#if githubConnected && rep && prev}
						<li class="flex items-start gap-2.5">
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
						</li>
					{:else}
						<li class="flex items-start gap-2.5">
							<CodeBranchOutline
								class="mt-0.5 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
								aria-hidden="true"
							/>
							<span class="t-body text-gray-500 dark:text-gray-400">
								Commit message and author need GitHub, which is not connected.
							</span>
						</li>
					{/if}
					<li class="flex items-start gap-2.5">
						<FolderOutline
							class="mt-0.5 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
							aria-hidden="true"
						/>
						<span
							class="t-body min-w-0 truncate text-gray-700 dark:text-gray-200"
							title={repoTitleFull(ledger.repoLabel) ?? undefined}
							>{repoTitle(ledger.repoLabel)}</span
						>
					</li>
					<li class="flex items-start gap-2.5">
						<LayersOutline
							class="mt-0.5 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
							aria-hidden="true"
						/>
						<span class="t-body text-gray-700 dark:text-gray-200"
							>{row.services.length} service{row.services.length === 1 ? '' : 's'}</span
						>
					</li>
					<li class="flex items-start gap-2.5">
						<ClockOutline
							class="mt-0.5 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
							aria-hidden="true"
						/>
						<span class="t-body text-gray-700 dark:text-gray-200">
							{#if row.lastDeployMs}
								last deployed {formatTimeAgo(new Date(row.lastDeployMs).toISOString(), $now)}
							{:else}
								never deployed
							{/if}
						</span>
					</li>
					<!--
						⛔ `View commit` WAS A `.btn` AND IT IS NAVIGATION. (2026-09-02,
						from the human: *"two navigation controls wearing button chrome"*,
						filed against the list and true here for the same control.) It
						changes no cluster state — it opens someone else's website — so it
						is `.nav-link` with the external glyph, which is the rule's stated
						answer for an outbound link.
					-->
					{#if commitUrl}
						<li class="flex items-start gap-2.5">
							<TagOutline
								class="mt-0.5 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
								aria-hidden="true"
							/>
							<a
								class="nav-link"
								href={commitUrl}
								target="_blank"
								rel="noopener noreferrer"
								aria-label={`View the commit for ${row.short} on GitHub — opens in a new tab`}
							>
								View commit
								<ArrowUpRightFromSquareOutline class="h-4 w-4" aria-hidden="true" />
							</a>
						</li>
					{/if}
				</ul>
			</Card>

				<!--
					CRITERION 2, NOW A PEER TILE IN THE SAME FLAT GRID, NOT A FIXED-WIDTH
					RAIL. One rank per service, against that service's OWN denominator,
					with the denominator named. `newest of 4` beside `newest of 37` is
					the page's whole point — those two services share a source repo and
					nothing else, and collapsing them onto one ladder is the defect
					revision keying was built to close, one level down. It does NOT
					restate the buckets: the buckets say WHERE, this says WHAT EACH
					SERVICE CALLS IT and how far down its own ladder it now sits.
				-->
				<Card
					icon={TagSolid}
					title="What each service calls it"
					verdict="{row.services.length} service{row.services.length === 1 ? '' : 's'}"
					verdictTitle="One commit, one row per service — each service names and ranks it on its own"
					padded={false}
				>
				<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
					{#each row.services as svc (svc.appName)}
						{@const rank = rankSentence(svc)}
						{@const chip = rankChipFor(svc)}
						{@const pinned = pinnedEnvsOf(svc)}
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
											: chip.role === 'newest'
												? `The newest of the ${rank.of.replace('of ', '')} builds ${svc.appName} can deploy`
												: `${chip.label} the newest of the ${rank.of.replace('of ', '')} builds ${svc.appName} can deploy`}
										value={svc.label}
										valueTitle={svc.label}
										wide
										class="min-w-0"
									/>
									<!-- ⭐ THE DENOMINATOR CARRIES ITS OWN DEFINITION.
									     `newest` means different things in different corners of
									     this product; here it is rank 0 on THIS service's ladder,
									     and `newest of 1` beside `newest of 37` is only readable
									     once that is said. It was said in a 3-line footer under
									     the card (2026-09-02, cut with the page's other
									     definitions); it is said here, on the `of N` the sentence
									     is about. `scan.ts` reads `title`, so it stays pinned. -->
									<span
										class="t-micro text-gray-500 dark:text-gray-400"
										title="Every service counts its own builds, so newest here means newest for that service. Two services from one repo can be on different builds and both be up to date."
										>{rank.of}</span
									>
								{:else}
									<!-- No number at all. A `0` here would read as "newest".
									     The WORD is `rankLabel`'s, like the `unreleased` above it:
									     `unknown` is a legible answer and the product spells it in
									     exactly one place. -->
									<Chip
										role="unranked"
										label={rankLabel({ kind: 'unknown' })}
										title="This service does not list this build, so it has no position for it"
										value={svc.label}
										wide
										class="min-w-0"
									/>
								{/if}
							</span>
							{#if pinned.length > 0}
								<div
									class="mt-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
								>
									<LockSolid class="h-3 w-3 shrink-0" aria-hidden="true" />
									<span
										>Pinned in {pinned.join(', ')} — automatic updates are off {pinned.length ===
										1
											? 'there'
											: 'in those environments'}</span
									>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
				<!-- ⛔ THE FOOTER THAT SAID THIS IS GONE, THE SENTENCE IS NOT.
				     (2026-09-02.) It is the `title` on `of N` in every row above —
				     on the term it defines, which is where a definition belongs and
				     is the only place it is legible without counting rows. -->
			</Card>

			<!--
				THE BUCKETS, AS TITLED CARDS. One per NON-EMPTY bucket, so a fully
				converged revision renders one card and a mid-promotion head renders
				three. The card lists its places, which is what makes the design hold
				at 4 prod regions and at 13: the bar is proportional and the buckets
				are LISTS, so N environments cost wrapped chips inside one card rather
				than columns across the page.
			-->
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
												aria-label="Open the {g.slots[0].envLabel.toUpperCase()} rollout for {g.appName}"
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
															<!-- ⛔ `−N` → `N behind`. (2026-08-30) The last
															     `−N` in the product. Same `rank` role, same
															     joined box; a signed integer beside a build id
															     reads as a diff and names no unit. -->
															<Chip
																role="rank"
																label={`${s.currentRank} behind`}
																title="{s.envLabel.toUpperCase()} can still take {s.currentRank} newer version{s.currentRank ===
																1
																	? ''
																	: 's'}"
															/>
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
													<ReasonIcon class="mt-0.5 h-4 w-4 shrink-0 {r.tone}" aria-hidden="true" />
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
													aria-label="Open the {rg.slots[0].envLabel.toUpperCase()} rollout for {g.appName}"
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
													<!-- ⭐ PER-PLACE AGE — `live` ONLY. (F13, 2026-09-03) See
													     `slotDeployedAgo`'s own note: three environments
													     running one build rarely arrived together, and this
													     is the one card on the page that can say when EACH
													     place actually got it, from data already read to
													     decide the place belongs in this bucket at all. -->
													{#if bucket.key === 'live'}
														{@const age = slotDeployedAgo(s)}
														{#if age}
															<span class="t-micro text-gray-500 dark:text-gray-400"
																>{age}</span
															>
														{/if}
													{/if}
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

						<!-- ⛔ A FOOTER `<p>` PRINTED `bucket.description`, WHICH IS THE
						     CARD'S OWN `verdictTitle` AND, WORSE, ITS OWN TITLE RESTATED.
						     (2026-09-02, from the human: definitions belong in a record,
						     not in the printed tier.) `Running it now` sat 130px above
						     `These are running this build right now.` — one card, one
						     fact, twice, and the second copy in prose. The record on the
						     `N places` rollup keeps every word of it. -->
					</Card>
				{/each}

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

	/* THE HERO'S GEOMETRY MOVED OUT OF THIS COMPONENT ENTIRELY. `RevisionLead`
	   still owns it for `/versions`, where it leads a card and is the page's
	   only object; here the object is named once, in the head band, in plain
	   markup (see the comment there). */

	/*
	 * ⛔ THE FIXED-WIDTH RAIL IS GONE, AND SO IS THE SECOND GRID LEVEL.
	 * (2026-09-02, design re-check: *"the three cards in the side-by-side row
	 * end at 460 / 538 / 546 — 86px of rag in one row."*) `.rev-cols` held
	 * `.rev-buckets` in one column and `What each service calls it` fixed at
	 * 340px in the other, each with its OWN `align-items: start` — so a
	 * card's height never had anything to answer to but its own content, in
	 * either grid. ONE flat grid now holds every card on the page (`This
	 * build`, the service-rank card, the bucket cards) as equal siblings, and
	 * `align-items: stretch` — CSS Grid's own default, which `start` had been
	 * overriding — makes every card sharing a ROW share that row's height.
	 * `Card.svelte`'s `flex flex-col` root and `grow` body exist for exactly
	 * this (see the comment on its `<section>`); this is the first place on
	 * this page that asks for it.
	 *
	 * ⛔ AND `auto-fit` IS GONE TOO — A RESIDUE OF THE FIRST FIX. (2026-09-02,
	 * design re-check: *"`This build | Running it now | Not here yet` on row
	 * 1 and `What each service calls it` alone on row 2 with two empty tracks
	 * beside it."*) `auto-fit` packs as many 300px tracks as the width allows,
	 * so a 1440 row fit THREE cards and left a fourth stranded with two empty
	 * columns beside it — the rag this file's own previous fix was written to
	 * remove, one level up. TWO FIXED TRACKS, always, from `sm` up: no width
	 * ever earns a third, so no card count can strand a lone survivor beside
	 * more than one empty track.
	 *
	 * THE ORDER PAIRS BY SUBJECT, NOT BY ARRIVAL. `This build` and `What each
	 * service calls it` are both about the BUILD (identity, then what each
	 * service calls it) and sit in row 1; the bucket cards are all about
	 * PLACES (where it is, where it isn't) and fill row 2 on. Markup order is
	 * the row order in a 2-column grid, so the Card for `What each service
	 * calls it` moved up to sit right after `This build` in the template —
	 * see the comment there.
	 */
	/*
	 * ⭐ F3: A CONTAINER QUERY, NOT `@media (min-width: 640px)`. (2026-09-03,
	 * breakpoints pass) The sidebar is 175px from `sm` (640px) viewport width
	 * on, so this page's own content box is not monotonic in viewport width
	 * — a 639px viewport gives it ~624px, a 640px viewport gives it ~449px.
	 * The old media query flipped to two columns at the exact viewport where
	 * the box available to `.rev-buckets` SHRANK below what two tracks need,
	 * so every card here truncated at 640 (`What each service calls it`
	 * 202→62px = `What …`, `This build`→`Thi…`). `.rev-cq`
	 * (`container-type: inline-size` on the page's own content container,
	 * two lines up) makes the query subject the box `.rev-buckets` actually
	 * has, at the same 640px number — moved from the wrong signal to the
	 * right one, not re-tuned.
	 */
	.rev-cq {
		container-type: inline-size;
	}

	.rev-buckets {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 16px;
		align-items: stretch;
	}

	@container (min-width: 640px) {
		.rev-buckets {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	/*
	 * ⭐ AN ODD CARD OUT SPANS BOTH TRACKS RATHER THAN SITTING ALONE BESIDE AN
	 * EMPTY ONE. The bucket count varies (1–3 non-empty buckets), so `This
	 * build` + the rank card + N buckets is not always a multiple of 2 — a
	 * THIRD or FIFTH card would otherwise strand itself in the last row with
	 * one empty track beside it, the exact defect this fix exists to remove,
	 * just smaller. `:last-child:nth-child(odd)` is true only when the total
	 * count is odd AND this is the final one, so it fires on exactly the card
	 * that would otherwise be alone, at any bucket count, with no JS needed
	 * to count cards.
	 */
	.rev-buckets > :global(:last-child:nth-child(odd)) {
		grid-column: 1 / -1;
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
	 * THE HEAD BAND WRAPS AT 390 rather than keeping a fixed two-column split —
	 * it is one `flex-wrap` row now (sha, then the count), so it costs
	 * whatever it costs at the width it is read at, same as `/versions` and
	 * `/activity`'s own head bands. The card grid below it drops to one column
	 * under the `sm` breakpoint, so `This build`, the service-rank card and
	 * every bucket card stack in reading order with no breakpoint of their own.
	 *
	 * The service rows become a two-line stack, because a name track plus a
	 * joined badge plus a denominator cannot share 358px without the badge
	 * ellipsising, and the badge is the one thing on the row that carries
	 * information the reader came for.
	 */
</style>
