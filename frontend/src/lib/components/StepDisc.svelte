<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE STEP DISC: one pipeline step's state as a tinted disc with its glyph (check, "!", spinner, pause, person, clock, rest dot).
	 * ROLE: the mark of a STEP (a pipeline stage, a gate, a check) on the rollout tab's Deployment-pipeline card, the tray / list
	 * pipeline (TraySteps) and the strand (MiniPipeline's 24px node). It replaces three hand-kept copies of the same disc and the three
	 * inline `animate-spin rounded-full border-2` spinners beside StatusSpinner. WHY NOT StatusMark: that is a 16px mark for a ROW'S
	 * state in a status column, not a step in a pipeline. BORROWS: the tint + ink of the one state-tone table (`TONE[..].disc`), the
	 * spinner of StatusSpinner, the pause of HeldGlyph, the rest dot of StatusMark.
	 *
	 * The caller sizes the disc (`class`: `h-6 w-6`, `h-7 w-7`, or MiniPipeline's `.mp-disc`); the glyph is 16px in every size.
	 * `state` takes the product's spellings (toneOf): done, failed, checking, deploying/current, held, approval, rest, todo/pending.
	 */
	import { CheckCircleSolid, ExclamationCircleSolid, ClockSolid, UserOutline } from 'flowbite-svelte-icons';
	import StatusSpinner from './StatusSpinner.svelte';
	import HeldGlyph from './HeldGlyph.svelte';
	import StatusMark from './StatusMark.svelte';
	import { TONE, toneOf } from '$lib/view-models/state-tone';

	let { state, tint = undefined, class: className = '' }: { state: string; /** replaces the tone's tint + ink (a strand's own approval ring, a rest disc) */ tint?: string; class?: string } = $props();
	const ALIAS: Record<string, string> = { current: 'deploying', pending: 'todo', todo: 'notreached', rest: 'done', fail: 'failed', active: 'deploying', hold: 'held' };
	const key = $derived(ALIAS[state] ?? state);
	const t = $derived(TONE[toneOf(key) ?? 'notreached']);
	const kind = $derived(key === 'rest' || state === 'rest' ? 'rest' : (toneOf(key) ?? 'notreached'));
</script>

<span class="inline-flex shrink-0 items-center justify-center rounded-full {tint ?? t.disc} {className}" data-step-disc={kind}>
	{#if state === 'rest'}<StatusMark state="newest" />
	{:else if kind === 'done'}<CheckCircleSolid class="h-4 w-4" />
	{:else if kind === 'failed'}<ExclamationCircleSolid class="h-4 w-4" />
	{:else if kind === 'checking'}<StatusSpinner size="4" color="yellow" />
	{:else if kind === 'deploying'}<StatusSpinner size="4" color="blue" />
	{:else if kind === 'held'}<HeldGlyph size={16} />
	{:else if kind === 'approval' || kind === 'approval-yours'}<UserOutline class="h-3.5 w-3.5" />
	{:else}<ClockSolid class="h-4 w-4" />{/if}
</span>
