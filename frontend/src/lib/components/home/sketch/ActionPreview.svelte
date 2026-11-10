<script module lang="ts">
	export type PreviewRow = { place: string; before: string; beforeTone: 'danger' | 'held' | 'neutral' | 'active'; after: string | null };
</script>

<script lang="ts">
	/**
	 * r28 sketch v28 — ACTION PREVIEW: what the one button does, per place, before you press it.
	 * Two columns of build pills — "now" and "after <action>" — joined by a connector per place. A
	 * place the action changes draws a solid connector into a new pill; a place it leaves alone draws
	 * a faint line into "stays". The scope of the action (one place out of four, five regions out of
	 * seven) is the information; nothing else on the page shows it.
	 */
	let { rows, action, rest = null, foot = null }: { rows: PreviewRow[]; action: string; rest?: string | null; foot?: string | null } = $props();
	const changed = $derived(rows.filter((r) => r.after).length);
</script>

<div class="ap">
	<div class="hd t-meta text-fg-subtle"><span>place</span><span>runs now</span><span></span><span>after “{action}”</span></div>
	{#each rows as r (r.place)}
		<div class="r" class:on={!!r.after}>
			{#if r.place.includes(', ') && r.place.length > 24}
				<span class="pl t-body">{r.place.split(', ').length} {r.place.includes('(') ? 'places' : 'regions'}<span class="pls t-meta">{r.place}</span></span>
			{:else}<span class="pl t-body">{r.place}</span>{/if}
			<span class="pill t-code-sm p-{r.beforeTone}">{r.before}</span>
			<span class="link"></span>
			{#if r.after}<span class="pill t-code-sm p-after">{r.after}</span>{:else}<span class="stays t-meta">stays</span>{/if}
		</div>
	{/each}
	{#if rest}<p class="t-meta rest">{rest}</p>{/if}
	{#if foot}<p class="t-meta mt-2 text-fg-subtle">{foot}</p>{:else}<p class="t-meta mt-2 text-fg-subtle">Changes {changed} of {rows.length} place{rows.length === 1 ? '' : 's'}; the rest keep what they run.</p>{/if}
</div>

<style>
	.hd,
	.r {
		display: grid;
		grid-template-columns: minmax(0, 11rem) minmax(0, max-content) minmax(24px, 1fr) minmax(0, max-content);
		align-items: center;
		gap: 0 8px;
	}
	.hd {
		padding-bottom: 6px;
	}
	.r {
		min-height: 30px;
		color: var(--color-fg-subtle);
	}
	.pl {
		padding: 4px 0;
	}
	.on .pl {
		color: var(--color-fg);
		font-weight: 600;
	}
	.pill {
		line-height: 20px;
		padding: 0 8px;
		border-radius: 9999px;
		border: 1px solid var(--color-line);
		white-space: nowrap;
		color: var(--color-fg-muted);
	}
	.p-danger {
		border-color: var(--color-danger-line);
		color: var(--color-danger);
	}
	.p-active {
		border-color: var(--color-active-line);
		color: var(--color-active);
	}
	.p-held {
		border-color: var(--color-held-line);
		color: var(--color-held);
	}
	.p-after {
		border-color: var(--color-fg-muted);
		color: var(--color-fg);
		background: var(--color-surface);
	}
	.link {
		height: 0;
		border-top: 1px dashed var(--color-line);
	}
	.on .link {
		border-top: 2px solid var(--color-fg-muted);
		position: relative;
	}
	.on .link::after {
		content: '';
		position: absolute;
		right: -2px;
		top: -5px;
		border: 4px solid transparent;
		border-left: 6px solid var(--color-fg-muted);
	}
	.rest {
		min-height: 34px;
		display: flex;
		align-items: center;
		color: var(--color-fg-subtle);
		border-top: 1px dashed var(--color-line);
	}
	@media (max-width: 639px) {
		.r:not(.on) {
			display: none;
		}
		.hd {
			display: none;
		}
	}
	.pls {
		display: block;
		font-weight: 400;
		color: var(--color-fg-subtle);
	}
	.stays {
		color: var(--color-fg-subtle);
	}
</style>
