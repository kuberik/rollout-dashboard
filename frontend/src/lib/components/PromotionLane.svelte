<svelte:options runes={true} />

<script lang="ts">
	import { siteCount, prodCountPhrase } from '$lib/view-models/regions';
	/**
	 * ONE APP'S PROMOTION LANE: the Lane view-model (where each build is, what is moving, held or failing, per environment) MAPPED to
	 * `EnvRow` cells. This file draws no box: the box, the connector, the size step and the "you are here" highlight are EnvRow's, the
	 * same component the repo cards and the ask cards use (r39 follow-up, owner 2026-11-08: one environment row, never stretched).
	 *
	 * ROLE: the rollout tab's header lane (links; `youAreHere` highlights the page's own environment), the Apps tile's row (`fill`, no
	 * links: the tile is the link), the app page's header strip.
	 * A healthy box says only its name and its lag; a box that needs reading adds the state mark and word in the state's ink. A prod set
	 * of several regions is ONE box: the worst region's mark and word, the region when exactly one, and "k of N regions".
	 */
	import { STATE_ORDER, type Lane, type LaneNode, type NodeState, type Tier } from '$lib/view-models/promotion-lanes';
	import { shortenVersion, formatTimeAgoCompact } from '$lib/utils';
	import { splitEnvName } from '$lib/env-badge';
	import { getEnvironmentThemeStyle } from '$lib/environment-theme';
	import { lagLabel } from '$lib/view-models/env-rank';
	import EnvRow, { type EnvCell, type EnvSite } from '$lib/components/EnvRow.svelte';
	import type { SiteState } from '$lib/components/SiteMark.svelte';
	import { approvalWord } from '$lib/components/new/state-words';
	import { atoms } from '$lib/components/atoms/atoms-context';
	import type { Bead } from '$lib/view-models/bead';

	let {
		lane,
		tiers,
		hrefFor,
		current = null,
		youAreHere = false,
		fill = undefined,
		beads = undefined,
		words = false,
		yours = false,
		quietNoReleases = false,
		sites = false
	}: {
		lane: Lane;
		/** Restrict / order the boxes; defaults to this lane's own tiers. */
		tiers?: Tier[];
		hrefFor: (n: LaneNode) => string;
		/** The rollout this page is about (picks which prod region a prod box names). */
		current?: { ns: string; name: string } | null;
		/** The rollout tab only: highlight `current`'s box. Every other page stays neutral. */
		youAreHere?: boolean;
		/** The card-scale row (Apps tiles): no links (the tile is the link); `M` a tile, `L` the lead tile. Unset = the tab's row (L, links). */
		fill?: 'L' | 'M';
		/** Beads drawn inside the box a change reached (design specimens). */
		beads?: (n: LaneNode) => Bead[];
		/** Accepted for call-site compatibility; boxes are neutral, so nothing reads it. */
		calm?: boolean;
		words?: boolean;
		/** the viewer can give the approval this lane waits on: its title, picker row and banner say "Needs your approval" (approvalWord) instead of "Waiting for approval"; only with `words`. The box itself says "Waiting". */
		yours?: boolean;
		mutedRest?: boolean;
		/** the rollout page says "no releases" once, in its Newer builds card: the boxes keep their names and stay silent */
		quietNoReleases?: boolean;
		/** change-strip r1 (App view, Rollout overview): every box draws its SITES as marks in wave order and lets you pick one (EnvRow `sites`);
		 *  a multi-site box drops its region and "k of N regions" (the marks say it) and keeps its state word */
		sites?: boolean;
	} = $props();
	const size = $derived<'L' | 'M'>(fill ?? 'L');
	/* r42 atoms (opt-in, /design/atoms): the progress pie in a checking / deploying box */
	const AT = atoms();
	const linked = $derived(!fill);

	const cols = $derived<Tier[]>(
		tiers?.filter((t) => lane.byTier[t]?.length) ?? (['dev', 'test', 'staging', 'other', 'prod'] as Tier[]).filter((t) => lane.byTier[t]?.length)
	);

	const INK: Record<NodeState, string> = {
		failed: 'text-danger',
		stuck: 'text-warning',
		deploying: 'text-active',
		checking: 'text-progress',
		held: 'text-held',
		behind: 'text-fg-muted',
		newest: 'text-fg-muted',
		none: 'text-fg-subtle'
	};

	const isCurrent = (n: LaneNode) => !!current && n.card.ns === current.ns && n.card.name === current.name;

	const WORD: Record<NodeState, string> = { failed: 'Failing', stuck: 'Stuck', deploying: 'Deploying', checking: 'Checking', held: 'Held', behind: '', newest: '', none: '' };
	/** a healthy box (behind / newest) says no word: its name and its lag are the whole statement */
	const wordOf = (n: LaneNode) => (n.state === 'held' && n.card.heldCause === 'person' ? (words ? approvalWord(yours) : 'Waiting') : WORD[n.state]);
	/** nothing moves as state changes: every strip box reserves the width of the widest word IT can say (EnvRow `wordSlot`). The strip's approval
	 *  word is always the short one ("Waiting"); "Needs your approval" stays in the title, the picker and the ask banner. */
	const WORD_SLOT = [...new Set([...Object.values(WORD), 'Waiting'].filter(Boolean))];
	const stripWord = (n: LaneNode) => (n.state === 'held' && n.card.heldCause === 'person' ? 'Waiting' : WORD[n.state]);
	const MARKED = new Set<NodeState>(['failed', 'stuck', 'held', 'deploying', 'checking']);
	const markOf = (n: LaneNode): EnvCell['mark'] => (MARKED.has(n.state) ? { state: n.state as 'failed' | 'stuck' | 'held' | 'deploying' | 'checking' } : undefined);
	const prodWorst = $derived(lane.prod.reduce<LaneNode | null>((b, n) => (!b || STATE_ORDER.indexOf(n.state) < STATE_ORDER.indexOf(b.state) ? n : b), null));

	const STATE_NOUN: Record<NodeState, string> = { failed: 'failing', stuck: 'stuck', deploying: 'deploying', checking: 'checking', held: 'held', behind: '', newest: '', none: '' };
	/** The prod cell's tooltip: every site with its state word and build, under its wave (leader marked) once the tier has more than one wave. */
	const prodTitle = (ns: LaneNode[]) => {
		const waves = [...new Set(ns.map((r) => r.card.wave ?? 1))];
		const line = (r: LaneNode) =>
			`${r.env}${r.card.role === 'Leader' && ns.filter((x) => (x.card.wave ?? 1) === (r.card.wave ?? 1)).length > 1 ? ' (leader)' : ''}: ${wordOf(r) || 'Healthy'}${r.card.version ? ` · ${shortenVersion(r.card.version)}` : ''}`;
		return waves.length < 2
			? ns.map(line).join('\n')
			: waves.map((w) => `wave ${w}\n` + ns.filter((r) => (r.card.wave ?? 1) === w).map((r) => '  ' + line(r)).join('\n')).join('\n');
	};
	/** " · wave 2" once the tier has more than one wave, so the place says where it stands in the rollout order. */
	const waveSuffix = (ns: LaneNode[], n: LaneNode) =>
		new Set(ns.map((r) => r.card.wave ?? 1)).size > 1 ? ` · wave ${n.card.wave ?? 1}` : '';
	/** A count only when it informs: "1 of 3 regions" while some need attention, "3 regions" when all are fine. */
	function prodDetail(ns: LaneNode[], worst: LaneNode): string {
		return prodCountPhrase(ns.map((n) => n.env), STATE_NOUN[worst.state] ? ns.filter((r) => r.state === worst.state) : null);
	}
	/** The one region needing attention, when exactly one does (shown where there is room). */
	function prodRegion(ns: LaneNode[], worst: LaneNode): string {
		return STATE_NOUN[worst.state] && ns.filter((r) => r.state === worst.state).length === 1 ? worst.env : '';
	}
	function withProgress(m: EnvCell['mark'], n: LaneNode): EnvCell['mark'] {
		const p = m && AT.progress ? AT.progress.get(`${n.card.ns}/${n.card.name}`) : null;
		return m && p ? { ...m, progress: p.fraction } : m;
	}
	/** a place without releases has no currency: a plain box would read as current, so it says so in the fact slot (same slot as "1 behind") */
	const noRel = (n: LaneNode) => n.state === 'none' && !!n.noReleases;
	function cellOf(n: LaneNode): EnvCell {
		return {
			key: n.tier === 'prod' ? 'prod' : n.env,
			label: n.env,
			href: linked ? hrefFor(n) : undefined,
			current: youAreHere && isCurrent(n),
			title: `${n.card.envDisplay || n.env}: ${n.card.version ?? 'no build'}${n.behind > 0 ? ` · ${lagLabel({ builds: n.behind })} the newest` : ''}${noRel(n) ? ' · no releases' : ''}${wordOf(n) && wordOf(n) !== stripWord(n) ? ` · ${wordOf(n)}` : ''}`,
			style: n.card.theme ? getEnvironmentThemeStyle(n.card.theme) : undefined,
			mark: withProgress(markOf(n), n),
			word: stripWord(n) || undefined,
			wordSlot: WORD_SLOT,
			wordInk: INK[n.state],
			hot: MARKED.has(n.state),
			fact: n.behind > 0 ? (size === 'M' ? `${n.behind} behind` : lagLabel({ builds: n.behind })) : noRel(n) && !quietNoReleases ? 'no releases' : undefined,
			factKind: 'lag',
			beads: beads?.(n)
		};
	}
	function prodCellOf(ns: LaneNode[], worst: LaneNode): EnvCell {
		const cur = ns.find(isCurrent);
		const shown = cur ?? worst;
		const region = cur ? `${splitEnvName(cur.env).place ?? cur.env}${waveSuffix(ns, cur)}` : prodRegion(ns, worst) ? `${prodRegion(ns, worst)}${waveSuffix(ns, worst)}` : undefined;
		return {
			...cellOf(shown),
			key: 'prod',
			label: 'prod',
			current: youAreHere && !!cur,
			title: prodTitle(ns),
			style: ns[0].card.theme ? getEnvironmentThemeStyle(ns[0].card.theme) : undefined,
			region,
			fact: prodDetail(ns, shown),
			factKind: 'detail'
		};
	}

	/* change-strip r1: the tier's sites for EnvRow, in topology order (wave, leader, name), never by state */
	const SITE_STATE: Record<NodeState, SiteState> = { failed: 'failed', stuck: 'stuck', deploying: 'deploying', checking: 'checking', held: 'held', behind: 'done', newest: 'done', none: 'notaffected' };
	const siteName = (n: LaneNode) => (n.card.site && n.card.site !== 'default' ? n.card.site : n.tier === 'prod' ? (splitEnvName(n.env).place ?? n.env) : n.env);
	/* the picker row speaks as the Change page's does: the state word, then the currency ("Deployed · 2 builds behind") */
	const siteWord = (n: LaneNode) => wordOf(n) || (noRel(n) ? 'No releases' : 'Deployed');
	const siteDetail = (n: LaneNode) => (noRel(n) || n.state === 'deploying' || n.state === 'checking' ? undefined : n.behind > 0 ? lagLabel({ builds: n.behind }) : 'Up to date');
	function sitesOf(ns: LaneNode[]): EnvSite[] {
		const multiWave = new Set(ns.map((n) => n.card.wave ?? 1)).size > 1;
		return [...ns]
			.sort((a, b) => (a.card.wave ?? 1) - (b.card.wave ?? 1) || Number(b.card.role === 'Leader') - Number(a.card.role === 'Leader') || siteName(a).localeCompare(siteName(b)))
			.map((n) => ({
				key: `${n.card.ns}/${n.card.name}`,
				name: siteName(n),
				wave: multiWave ? (n.card.wave ?? 1) : null,
				state: n.state === 'held' && n.card.heldCause === 'person' ? 'approval' : SITE_STATE[n.state],
				word: siteWord(n),
				detail: siteDetail(n),
				wordInk: INK[n.state],
				build: n.card.version ? shortenVersion(n.card.version) : undefined,
				aside: n.card.timestamp ? formatTimeAgoCompact(n.card.timestamp) : undefined,
				href: hrefFor(n),
				here: youAreHere && isCurrent(n)
			}));
	}
	function siteCellOf(ns: LaneNode[]): EnvCell {
		const worst = ns.reduce((b, n) => (STATE_ORDER.indexOf(n.state) < STATE_ORDER.indexOf(b.state) ? n : b), ns[0]);
		const base = cellOf(worst);
		const many = ns.length > 1;
		return {
			...base,
			key: worst.tier === 'prod' ? 'prod' : worst.env,
			label: worst.tier === 'prod' ? 'prod' : worst.env,
			href: undefined,
			title: undefined,
			mark: undefined,
			current: youAreHere && ns.some(isCurrent),
			style: ns[0].card.theme ? getEnvironmentThemeStyle(ns[0].card.theme) : undefined,
			region: undefined,
			fact: many ? undefined : base.fact,
			sites: sitesOf(ns)
		};
	}
	const cells = $derived<EnvCell[]>(
		cols.map((t) => {
			const ns = lane.byTier[t] ?? [];
			if (sites && linked && ns.length) return siteCellOf(ns);
			/* QA #10: a prod CELL folds several SITES; places of one site (or none) are one box with the most urgent place's state */
			if (t === 'prod' && ns.length > 1 && prodWorst && siteCount(ns.map((n) => n.env)) > 1) return prodCellOf(ns, prodWorst);
			return cellOf(t === 'prod' ? ns.reduce((b, n) => (STATE_ORDER.indexOf(n.state) < STATE_ORDER.indexOf(b.state) ? n : b), ns[0]) : ns[0]);
		})
	);
</script>

<EnvRow {cells} {size} />
