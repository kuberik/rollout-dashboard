<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE CHANGE PAGE'S RAIL, CARD 2. CHANGES-2026-09-10.md ROUND 2, §R2.3.
	 *
	 * "the ops content of the old build page" — `ran here before`,
	 * `rolled back`, `where it sits` — in the rollout detail History TAB's
	 * own row grammar (`/rollouts/<cluster>/<ns>/<name>/history`), not a new
	 * one invented for this card:
	 *
	 * ```
	 * [bake glyph] [env Chip]  1.66.0-66 abc1234        [↩ rolled back]  2h ago
	 *                                                        · @who
	 * ```
	 *
	 * `rows` is `pr-pipeline.ts`'s own `buildChangeHistory(services,
	 * localClusterName)` — one row per `status.history` entry, ANY
	 * service/environment, that carries this change. This component only
	 * RENDERS the already-flattened, already-sorted feed; the fold across
	 * every service's every cell lives in the view-model, per this lane's
	 * own "push logic into view-models, keep components rendering" rule.
	 *
	 * ⛔ NOT A NEW ROLLBACK MARK. `act.kind === 'rollback'` reuses the exact
	 * `UndoOutline` + neutral-strong chip the History tab already draws for
	 * the identical fact — "the product's existing rollback mark, never a
	 * new one."
	 */
	import { ClockOutline, UndoOutline, UserSolid, CogSolid } from 'flowbite-svelte-icons';
	import Card from './Card.svelte';
	import Chip from './Chip.svelte';
	import BakeStatusIcon from './BakeStatusIcon.svelte';
	import { getStatusCircleClass } from '$lib/bake-status';
	import { formatTimeAgoCompact } from '$lib/utils';
	import type { ChangeHistoryRow } from '$lib/view-models/pr-pipeline';

	let {
		rows,
		retentionNote = null,
		now = new Date()
	}: {
		rows: ChangeHistoryRow[];
		/** `pr-pipeline.ts`'s own `changeHistoryRetentionNote(services)` — the
		 *  History tab's retention caveat, printed once at the card's foot,
		 *  only when at least one matched rollout is at its retention limit. */
		retentionNote?: string | null;
		now?: Date;
	} = $props();

	// A `rolled-back`/`Succeeded` deploy still gets the plain green disc —
	// the "state" override on `getStatusCircleClass`/`BakeStatusIcon` is for
	// the CURRENT cell in `PipelineRow`, a different question ("can this
	// cell take a build today") from this card's own ("what happened, when
	// it happened") — so this disc reads `bakeStatus` alone, unconditioned.
</script>

<Card icon={ClockOutline} title="History" verdict="{rows.length} deploy{rows.length === 1 ? '' : 's'}" padded={false}>
	{#if rows.length === 0}
		<p class="t-dense px-4 py-3 text-gray-500 dark:text-gray-400">
			This build has not deployed anywhere on this cluster.
		</p>
	{:else}
		<ol class="divide-y divide-gray-100 dark:divide-gray-700/60">
			{#each rows as row (row.key)}
				<li>
					<a
						href={row.href}
						class="tap-zone tap-link flex items-start gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/40"
					>
						<span
							class="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
								row.bakeStatus
							)}"
						>
							<BakeStatusIcon bakeStatus={row.bakeStatus} size="small" decorative />
						</span>
						<Chip role="env" theme={row.theme} label={row.envName} title={`${row.appName} in ${row.envName.toUpperCase()}`} />
						<span class="min-w-0 flex-1">
							<span class="flex flex-wrap items-center gap-1.5">
								<span class="t-code-sm font-semibold text-gray-900 dark:text-white">{row.displayVersion}</span>
								{#if row.shortRevision}
									<span class="t-code-sm text-gray-400 dark:text-gray-500">{row.shortRevision}</span>
								{/if}
								{#if row.act?.kind === 'rollback'}
									<!-- ⛔ THE PRODUCT'S EXISTING ROLLBACK MARK, NEVER A NEW ONE —
									     byte-identical chip to the History tab's own. -->
									<span
										class="chip t-chip chip-wide gap-1 border-gray-200 text-gray-900 dark:border-gray-700 dark:text-gray-100"
										title={row.act.sentence}
									>
										<UndoOutline class="h-3 w-3" aria-hidden="true" />
										{row.act.word}
									</span>
								{/if}
							</span>
							<span class="t-micro mt-0.5 flex flex-wrap items-center gap-x-1.5 text-gray-500 dark:text-gray-400">
								<span>{formatTimeAgoCompact(row.timestamp, now)} ago</span>
								{#if row.actorName}
									<span aria-hidden="true">·</span>
									{#if row.actorKind === 'User'}
										<UserSolid class="h-3 w-3 shrink-0" aria-hidden="true" />
									{:else}
										<CogSolid class="h-3 w-3 shrink-0" aria-hidden="true" />
									{/if}
									<span class="truncate">{row.actorName}</span>
								{/if}
							</span>
						</span>
					</a>
				</li>
			{/each}
		</ol>
	{/if}
	{#if retentionNote}
		<p class="t-micro border-t border-gray-100 px-4 py-2.5 text-gray-400 dark:border-gray-700/60 dark:text-gray-500">
			{retentionNote}
		</p>
	{/if}
</Card>
