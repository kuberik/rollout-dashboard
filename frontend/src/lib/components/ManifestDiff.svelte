<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE MANIFEST DIFF BODY — one resource's unified diff, drawn by us.
	 *
	 * ROLE: the body of each resource Card on the rollout diff page
	 * (`/rollouts/…/diff/<build>`), under the Card's headline row. It answers
	 * "which lines of this manifest moved, and to what" — the evidence behind
	 * the headline ("image b7e0d41 → d09e6f4 · replicas 4 → 6").
	 *
	 * WHY A NEW COMPONENT: nothing in the product draws code lines. The page
	 * used diff2html and failed six AD rounds on it — its table carries two
	 * number columns sized for an overlay layout, a code cell that collapses
	 * when asked to wrap, a hunk header cut inside a cell, and its own palette.
	 * Rows come from `view-models/line-diff.ts` (pure, tested); this file only
	 * lays them out.
	 *
	 * ANATOMY (squad-rollout, AD round 5):
	 *   · one row per line; text wraps inside its row, never scrolls sideways;
	 *   · the wrapped tail hangs under the CODE (marker + the line's own
	 *     indentation + 2ch), never under the number gutter;
	 *   · a narrow card (< 640px, i.e. every phone) has ONE 32px number column —
	 *     the old number on a deleted line, the new number otherwise; a wide
	 *     card has GitHub's two (old, new), 48px each;
	 *   · the `@@` hunk header is its own full-width `bg-subtle` row, its text
	 *     on the code column's x;
	 *   · deleted / added rows are the danger / success TINT, the `-` / `+`
	 *     marker in the status ink, the changed token inside an edited line one
	 *     step stronger (the status LINE token) — no amber, no blue.
	 *
	 * Type: `t-code-sm` (12/16 mono) on a 20px row. Proportions borrowed from
	 * GitHub's unified view; the one-column phone gutter from Vercel's.
	 */
	import type { DiffRow, DiffLineRow } from '$lib/view-models/line-diff';

	let {
		rows,
		hiddenAfter = 0,
		label
	}: {
		rows: DiffRow[];
		/** Unchanged lines after the last hunk (stated, not drawn). */
		hiddenAfter?: number;
		/** Accessible name for the diff, e.g. "Changes to Deployment checkout-edge". */
		label: string;
	} = $props();

	/** Break opportunities after `/`, `:` and `,` so a long image ref wraps at its seams. */
	function pieces(s: string): string[] {
		return s.split(/(?<=[/:,])/);
	}

	function segments(r: DiffLineRow): { text: string; mark: boolean }[] {
		if (!r.mark) return [{ text: r.text, mark: false }];
		const [a, b] = r.mark;
		return [
			{ text: r.text.slice(0, a), mark: false },
			{ text: r.text.slice(a, b), mark: true },
			{ text: r.text.slice(b), mark: false }
		].filter((x) => x.text !== '');
	}

	const MARKER: Record<DiffLineRow['kind'], string> = { context: ' ', add: '+', del: '-' };
	const KIND_WORD: Record<DiffLineRow['kind'], string> = {
		context: 'unchanged',
		add: 'added',
		del: 'removed'
	};
</script>

<div class="md-cq">
	<div class="md t-code-sm" role="list" aria-label={label}>
		{#each rows as r, i (i)}
			{#if r.type === 'hunk'}
				<div class="md-hunk bg-subtle text-fg-subtle" role="listitem">
					<span class="md-hunk-text">{r.header}</span>
				</div>
			{:else}
				<div
					class="md-row md-{r.kind} {r.kind === 'add'
						? 'bg-success-tint'
						: r.kind === 'del'
							? 'bg-danger-tint'
							: ''}"
					role="listitem"
					style="--md-indent: {r.indent + 4}"
				>
					<span class="md-no md-no-one text-fg-subtle" aria-hidden="true">{r.no}</span>
					<span class="md-no md-no-old text-fg-subtle" aria-hidden="true">{r.oldNo ?? ''}</span>
					<span class="md-no md-no-new text-fg-subtle" aria-hidden="true">{r.newNo ?? ''}</span>
					<span class="md-code {r.kind === 'context' ? 'text-fg-muted' : 'text-fg'}"
						><span class="sr-only">{KIND_WORD[r.kind]} line {r.no}: </span><span
							class={r.kind === 'add' ? 'text-success' : r.kind === 'del' ? 'text-danger' : ''}
							aria-hidden="true">{MARKER[r.kind]}</span
						>{' '}{#each segments(r) as seg, k (k)}{#if seg.mark}<mark
									class="md-mark rounded-xs text-fg {r.kind === 'add'
										? 'bg-success-line'
										: 'bg-danger-line'}"
									>{#each pieces(seg.text) as p, j (j)}{p}<wbr />{/each}</mark
								>{:else}{#each pieces(seg.text) as p, j (j)}{p}<wbr />{/each}{/if}{/each}</span
					>
				</div>
			{/if}
		{/each}
		{#if hiddenAfter > 0}
			<div class="md-hunk md-tail bg-subtle text-fg-subtle" role="listitem">
				<span class="md-hunk-text t-meta"
					>{hiddenAfter} unchanged line{hiddenAfter === 1 ? '' : 's'} below</span
				>
			</div>
		{/if}
	</div>
</div>

<style>
	/* The card body is the query subject: a phone, or a narrow column, gets the
	   one-number gutter whatever the viewport says. */
	.md-cq {
		container-type: inline-size;
	}
	.md {
		--md-gutter: 2rem;
		--md-hang-cap: 10;
		display: grid;
		grid-template-columns: var(--md-gutter) minmax(0, 1fr);
	}
	.md-row,
	.md-hunk {
		display: grid;
		grid-column: 1 / -1;
		grid-template-columns: subgrid;
	}
	.md-hunk {
		min-height: 24px;
		align-items: center;
	}
	.md-hunk-text {
		grid-column: 2 / -1;
		padding: 4px 8px;
		overflow-wrap: anywhere;
	}
	.md-no {
		padding: 2px 6px 2px 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
		user-select: none;
		border-right: 1px solid var(--k-line-subtle);
	}
	.md-no-old,
	.md-no-new {
		display: none;
	}
	.md-code {
		min-width: 0;
		padding: 2px 16px 2px calc(8px + min(var(--md-indent), var(--md-hang-cap)) * 1ch);
		text-indent: calc(min(var(--md-indent), var(--md-hang-cap)) * -1ch);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.md-mark {
		padding: 1px 0;
		/* `<mark>`'s UA yellow is replaced by the status line token in markup. */
		color: inherit;
	}
	@container (min-width: 640px) {
		.md {
			--md-gutter: 3rem;
			--md-hang-cap: 40;
			grid-template-columns: var(--md-gutter) var(--md-gutter) minmax(0, 1fr);
		}
		.md-no-one {
			display: none;
		}
		.md-no-old,
		.md-no-new {
			display: block;
		}
		.md-hunk-text {
			grid-column: 3 / -1;
		}
	}
</style>
