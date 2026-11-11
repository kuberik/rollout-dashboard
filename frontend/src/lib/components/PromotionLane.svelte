<svelte:options runes={true} />

<script lang="ts">
	import { siteCount, prodCountPhrase } from '$lib/view-models/regions';
	/**
	 * ONE APP'S PROMOTION LANE: the Lane view-model (where each build is, what is moving, held or failing, per environment) MAPPED to
	 * `EnvRow` cells. This file draws no box: the box, the connector, the size step and the "you are here" highlight are EnvRow's, the
	 * same component the repo cards and the ask cards use (r39 follow-up, owner 2026-11-08: one environment row, never stretched).
	 *
	 * ROLE: the rollout tab's header lane (links; `youAreHere` highlights the page's own environment), the Apps tile's row (`fill`, no
	 * links: the tile is the link), the app page's header strip. With `showApp` it is a list row: name over the lead sentence, then the row.
	 * A healthy box says only its name and its lag; a box that needs reading adds the state mark and word in the state's ink. A prod set
	 * of several regions is ONE box: the worst region's mark and word, the region when exactly one, and "k of N regions".
	 */
	import { STATE_ORDER, settledSentence, type Lane, type LaneNode, type NodeState, type Tier } from '$lib/view-models/promotion-lanes';
	import { formatTimeAgoCompact, shortenVersion } from '$lib/utils';
	import { splitEnvName } from '$lib/env-badge';
	import { getEnvironmentThemeStyle } from '$lib/environment-theme';
	import { now } from '$lib/stores/time';
	import { lagLabel } from '$lib/view-models/env-rank';
	import EnvRow, { type EnvCell } from '$lib/components/EnvRow.svelte';
	import { approvalWord, stateWord } from '$lib/components/new/state-words';
	import { atoms } from '$lib/components/atoms/atoms-context';
	import type { Bead } from '$lib/view-models/bead';

	let {
		lane,
		tiers,
		hrefFor,
		appHref = null,
		current = null,
		youAreHere = false,
		showApp = true,
		quietLead = false,
		fill = undefined,
		beads = undefined,
		words = false,
		yours = false
	}: {
		lane: Lane;
		/** Restrict / order the boxes; defaults to this lane's own tiers. */
		tiers?: Tier[];
		hrefFor: (n: LaneNode) => string;
		appHref?: string | null;
		/** The rollout this page is about (picks which prod region a prod box names). */
		current?: { ns: string; name: string } | null;
		/** The rollout tab only: highlight `current`'s box. Every other page stays neutral. */
		youAreHere?: boolean;
		showApp?: boolean;
		/** The page already states the lead fact (a banner): say it in neutral ink. */
		quietLead?: boolean;
		/** The card-scale row (Apps tiles): no links (the tile is the link); `M` a tile, `L` the lead tile. Unset = the tab's row (L, links). */
		fill?: 'L' | 'M';
		/** Beads drawn inside the box a change reached (design specimens). */
		beads?: (n: LaneNode) => Bead[];
		/** Accepted for call-site compatibility; boxes are neutral, so nothing reads it. */
		calm?: boolean;
		words?: boolean;
		/** the viewer can give the approval this lane waits on: its box says "Needs your approval" (approvalWord) instead of "Waiting for approval"; only with `words` */
		yours?: boolean;
		mutedRest?: boolean;
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

	function sentence(n: LaneNode): string {
		const env = n.env;
		const ver = n.card.version ? shortenVersion(n.card.version) : '';
		const age = n.card.timestamp ? formatTimeAgoCompact(n.card.timestamp, $now) : '';
		switch (n.state) {
			case 'failed':
				return n.card.checkFailure ? `Health check failing in ${env}` : `Deploy failed in ${env}`;
			case 'stuck':
				return `Stuck in ${env}`;
			case 'deploying':
				return `Deploying ${ver} to ${env}${age ? ` · ${age}` : ''}`;
			case 'checking':
				return `Checking ${ver} in ${env}${age ? ` · ${age}` : ''}`;
			case 'held':
				// qa11b: the hold's CAUSE (held.ts), never the chain env it sits behind.
				if (n.card.heldCause === 'person') return `Waits for you in ${env}`;
				return `Held in ${env}${n.card.heldCauseLabel ? ` · waits on ${n.card.heldCauseLabel}` : ''}`;
			case 'behind': {
				// Promotion is the subject, not lag: where the newest is, what is next.
				const all = [...lane.stages, ...lane.prod];
				const at = all.filter((x) => x.state === 'newest');
				const next = all.find((x) => x.state === 'behind');
				if (at.length === 0) return 'Newest build not deployed yet';
				const newest = at[at.length - 1];
				const v = newest.card.version ? shortenVersion(newest.card.version) : 'Newest';
				const nextName = next ? (next.tier === 'prod' && lane.prod.length > 1 ? 'prod' : next.env) : '';
				return `${v} in ${newest.env}${nextName ? ` · ${nextName} next` : ''}`;
			}
			case 'newest':
				return settledSentence(lane, 'newest');
			default:
				return settledSentence(lane, 'none');
		}
	}

	const WORD: Record<NodeState, string> = { failed: 'Failing', stuck: 'Stuck', deploying: 'Deploying', checking: 'Checking', held: 'Held', behind: '', newest: '', none: '' };
	/** a healthy box (behind / newest) says no word: its name and its lag are the whole statement */
	const wordOf = (n: LaneNode) => (n.state === 'held' && n.card.heldCause === 'person' ? (words ? approvalWord(yours) : 'Waiting') : WORD[n.state]);
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
	const leadInk = $derived(
		!lane.lead || quietLead || lane.lead.state === 'behind' || lane.lead.state === 'newest'
			? 'text-fg-subtle'
			: INK[lane.lead.state]
	);

	function withProgress(m: EnvCell['mark'], n: LaneNode): EnvCell['mark'] {
		const p = m && AT.progress ? AT.progress.get(`${n.card.ns}/${n.card.name}`) : null;
		return m && p ? { ...m, progress: p.fraction } : m;
	}
	function cellOf(n: LaneNode): EnvCell {
		return {
			key: n.tier === 'prod' ? 'prod' : n.env,
			label: n.env,
			href: linked ? hrefFor(n) : undefined,
			current: youAreHere && isCurrent(n),
			title: `${n.card.envDisplay || n.env}: ${n.card.version ?? 'no build'}${n.behind > 0 ? ` · ${lagLabel({ builds: n.behind })} the newest` : ''}`,
			style: n.card.theme ? getEnvironmentThemeStyle(n.card.theme) : undefined,
			mark: withProgress(markOf(n), n),
			word: wordOf(n) || undefined,
			wordShort: n.state === 'held' && n.card.heldCause === 'person' && words ? stateWord('approval', { compact: true }) ?? undefined : undefined,
			wordInk: INK[n.state],
			hot: MARKED.has(n.state),
			fact: n.behind > 0 ? (size === 'M' ? `${n.behind} behind` : lagLabel({ builds: n.behind })) : undefined,
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
	const cells = $derived<EnvCell[]>(
		cols.map((t) => {
			const ns = lane.byTier[t] ?? [];
			/* QA #10: a prod CELL folds several SITES; places of one site (or none) are one box with the most urgent place's state */
			if (t === 'prod' && ns.length > 1 && prodWorst && siteCount(ns.map((n) => n.env)) > 1) return prodCellOf(ns, prodWorst);
			return cellOf(t === 'prod' ? ns.reduce((b, n) => (STATE_ORDER.indexOf(n.state) < STATE_ORDER.indexOf(b.state) ? n : b), ns[0]) : ns[0]);
		})
	);
</script>

{#if showApp}
	<div class="lane-cq">
		<div class="lane">
			<div class="lane-head min-w-0">
				{#if appHref}
					<a href={appHref} class="tap-link t-card-title block truncate text-fg hover:underline">{lane.app}</a>
				{:else}
					<span class="t-card-title block truncate text-fg">{lane.app}</span>
				{/if}
				{#if lane.lead}
					<p class="t-meta truncate {leadInk}">{sentence(lane.lead)}</p>
				{/if}
			</div>
			<EnvRow {cells} {size} />
		</div>
	</div>
{:else}
	<EnvRow {cells} {size} />
{/if}

<style>
	.lane-cq {
		container-type: inline-size;
	}
	.lane {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		row-gap: 8px;
		padding: 10px 16px;
		min-height: 56px;
		align-items: center;
	}
	@container (min-width: 720px) {
		.lane {
			grid-template-columns: 320px minmax(0, 1fr);
			column-gap: 24px;
		}
	}
</style>
