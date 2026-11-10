<script lang="ts">
	/**
	 * THE "RECENT ACTIVITY" CARD OF /apps/<name> (detail pass, owner decision 6, 2026-11-08: "use the Activity feed row style").
	 * ROLE: what happened to this app lately, one event per row. REFERENCE: /activity's FeedRow (the one row: status mark · sentence ·
	 * person · time · hairline between rows), here with `bare` because the page IS the app (no app glyph/name column, the verb leads:
	 * "Promoted PROD a -> b"); the time is the clock time under a day label exactly as /activity prints it. Day label = the card's 32px
	 * sub-header (Changes'), the footer says what is shown. NEW BY DESIGN: only the composition; every part is the product's.
	 */
	import { placeKeyOf } from '$lib/view-models/sites-waves';
	import Card from '$lib/components/Card.svelte';
	import { ClockOutline } from 'flowbite-svelte-icons';
	import FeedRow from '$lib/components/activity/FeedRow.svelte';
	import { activityVerb } from '$lib/view-models/activity-verb';
	import { formatClockTime } from '$lib/display-time';
	import { activityKindOf } from '$lib/view-models/activity-kind';
	import type { ActivityKind } from '$lib/view-models/activity-verb';
	import { getEnvironmentRank } from '$lib/env-order';
	import { actorFrom, type Actor } from '$lib/actor';
	import { getDisplayVersion } from '$lib/utils';
	import { deployActs } from '$lib/history-marks';
	import { historyEntrySince } from '$lib/view-models/event-age';
	import { getRolloutEnvironmentTheme, shortEnvLabel } from '$lib/environment-theme';
	import { startOfDayMs, zonedYMD } from '$lib/display-time';
	import { now } from '$lib/stores/time';
	import { href } from '$lib/paths';
	import { avatarSrc } from '../data';
	import type { Rollout, Environment } from '../../../../types';

	let { rollouts, environments = [], limit = 6 }: { rollouts: Rollout[]; environments?: Environment[]; limit?: number } = $props();

	type Entry = { key: string; ts: string; kind: ActivityKind; current: boolean; env: string; theme: ReturnType<typeof getRolloutEnvironmentTheme>; from: string | null; to: string; actor: Actor };
	const dayKey = (ts: string) => { const { year, month, day } = zonedYMD(new Date(ts)); return `${year}-${month}-${day}`; };
	const all = $derived.by<Entry[]>(() => {
		const out: Entry[] = [];
		const ranks = new Map<string, number>();
		for (const e of environments) { const n = e.spec?.rolloutRef?.name; if (n && e.spec?.environment) ranks.set(n, Math.min(ranks.get(n) ?? Infinity, getEnvironmentRank(e.spec.environment))); }
		for (const [ri, r] of rollouts.entries()) {
			const history = r.status?.history ?? [];
			const env = environments.find((e) => e.metadata?.namespace === r.metadata?.namespace && e.spec?.rolloutRef?.name === r.metadata?.name);
			const envName = env ? placeKeyOf(env, environments) : '';
			const theme = env ? getRolloutEnvironmentTheme(r, env) : getRolloutEnvironmentTheme(r);
			const acts = deployActs(r);
			for (let i = 0; i < history.length; i++) {
				const h = history[i];
				if (!h.timestamp) continue;
				const ver = getDisplayVersion(h.version);
				let prev: string | null = null;
				for (let j = i + 1; j < history.length; j++) { const v = getDisplayVersion(history[j].version); if (v && v !== ver) { prev = v; break; } }
				const bs = h.bakeStatus || 'None';
				const actor = actorFrom(h.triggeredBy, undefined);
				const rank = getEnvironmentRank(envName);
				const kind = activityKindOf({ bakeStatus: bs, bakeStatusMessage: h.bakeStatusMessage, isRollback: acts[i]?.kind === 'rollback', actorKind: actor.kind, envRank: rank, firstEnvRank: Math.min(ranks.get(r.metadata?.name ?? '') ?? Infinity, rank) });
				const ts = bs === 'Failed' ? historyEntrySince(h) ?? h.timestamp : h.timestamp;
				out.push({ key: `${ri}:${i}`, ts, kind, current: i === 0, env: shortEnvLabel(theme) || envName, theme, from: prev, to: ver, actor });
			}
		}
		return out.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
	});
	const totals = $derived.by(() => { const m = new Map<string, number>(); for (const e of all) { const k = dayKey(e.ts); m.set(k, (m.get(k) ?? 0) + 1); } return m; });
	const failed = $derived(all.filter((e) => (e.kind === 'failed' || e.kind === 'failedHealthCheck') && dayKey(e.ts) === dayKey(all[0]?.ts ?? '')).length);
	const label = (ts: string) => { const d = Math.round((startOfDayMs($now) - startOfDayMs(new Date(ts))) / 86_400_000); return d === 0 ? 'Today' : d === 1 ? 'Yesterday' : new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
	const groups = $derived.by(() => {
		const m = new Map<string, { label: string; key: string; rows: Entry[] }>();
		for (const e of all.slice(0, limit)) {
			const k = dayKey(e.ts);
			const g = m.get(k) ?? { label: label(e.ts), key: k, rows: [] };
			g.rows.push(e); m.set(k, g);
		}
		return [...m.values()];
	});
	const shown = $derived(groups.reduce((n, g) => n + g.rows.length, 0));
	/** "6 of 35 today" when every shown event is one day's, else "6 of 41" */
	const footLeft = $derived(groups.length === 1 ? `${shown} of ${totals.get(groups[0].key) ?? shown} ${groups[0].label.toLowerCase()}` : `${shown} of ${all.length}`);
	/** the verb column: one word each, in a fixed 96px track */
	const VERB: Record<ActivityKind, string> = { deployed: 'Deployed', promoted: 'Promoted', rolledBack: 'Rolled back', failed: 'Failed', failedHealthCheck: 'Check failed', deploying: 'Deploying', checking: 'Checking', held: 'Held', approved: 'Approved', pinned: 'Pinned' };
</script>

<Card icon={ClockOutline} title="Recent activity" padded={false} smooth={false}>
	<!-- apps-9 AQ9: "failed" is said once per page (How it's going' Failed row); the activity header carries no count -->
	{#snippet rollup()}{/snippet}
	{#if all.length === 0}
		<div class="flex flex-col items-center gap-1 px-4 py-6 text-center">
			<ClockOutline class="h-5 w-5 text-fg-disabled" aria-hidden="true" />
			<p class="t-ui text-fg">No activity yet</p>
			<p class="t-meta text-fg-subtle">Deploys and promotions of this app appear here.</p>
		</div>
	{:else}
		{#each groups as g (g.key)}
			<div class="ac-day t-label flex h-8 items-center border-b border-line-subtle bg-subtle px-4 text-fg-muted">{g.label}</div>
			<ul class="lc-rows">
				{#each g.rows as e (e.key)}
					{@const vb = activityVerb(e.kind)}
					<FeedRow bare app="" href="" verb={VERB[e.kind]} tone={vb.tone} live={e.current} chip={e.env ? (e.env === 'production' ? 'prod' : e.env) : null} theme={e.theme}
						from={e.from} to={e.to} actor={e.actor.kind === 'person' ? { ...e.actor, src: avatarSrc(e.actor.name) } : null} age={formatClockTime(e.ts)} />
				{/each}
			</ul>
		{/each}
		<div class="flex h-11 items-center justify-between gap-3 border-t border-line px-4">
			<span class="t-meta tabular-nums text-fg-muted">{footLeft}</span>
			<a href={href('/activity')} class="t-ui-sm inline-flex items-center gap-1 text-fg hover:underline max-sm:min-h-11">All activity <span aria-hidden="true">→</span></a>
		</div>
	{/if}
</Card>
