<script lang="ts" module>
	export type GlyphState = 'failed' | 'approval' | 'deploying' | 'checking' | 'held' | 'waiting' | 'rest' | 'arrived';
</script>

<script lang="ts">
	/**
	 * r30 depot — the STATE GLYPH: one 14/16px drawn mark per state, told apart by SHAPE first
	 * (Linear My issues: ring, half-fill, dashed ring), hue second. Colour lives here, never in the
	 * words beside it. failed = the one solid disc; approval = a ring around a person dot (a
	 * request); deploying = a ring filling (pie at 50%); checking = pie at 80%; held by a rule = a
	 * ring with a pause; waiting on another service = a dashed ring; at rest / arrived = a check.
	 */
	let { state, size = 14, label }: { state: GlyphState; size?: number; label?: string } = $props();
	const r = 6;
	const pie = (f: number) => {
		const a = f * 2 * Math.PI - Math.PI / 2;
		const x = 8 + 3.6 * Math.cos(a), y = 8 + 3.6 * Math.sin(a);
		return `M8 8 L8 4.4 A3.6 3.6 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`;
	};
</script>

<svg class="sg sg-{state}" width={size} height={size} viewBox="0 0 16 16" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>
	{#if state === 'failed'}
		<circle cx="8" cy="8" r="7" class="fill" />
		<path d="M8 4.4v4.4" class="bang" /><circle cx="8" cy="11.3" r="0.95" class="dot" />
	{:else if state === 'approval'}
		<circle cx="8" cy="8" {r} class="ring" />
		<circle cx="8" cy="8" r="2.4" class="core" />
	{:else if state === 'deploying' || state === 'checking'}
		<circle cx="8" cy="8" {r} class="ring" />
		<path d={pie(state === 'deploying' ? 0.5 : 0.8)} class="core" />
	{:else if state === 'held'}
		<circle cx="8" cy="8" {r} class="ring" />
		<path d="M6.6 5.8v4.4M9.4 5.8v4.4" class="bars" />
	{:else if state === 'waiting'}
		<circle cx="8" cy="8" {r} class="ring dash" />
	{:else}
		<circle cx="8" cy="8" {r} class="ring" />
		<path d="M5.5 8.2l1.7 1.7 3.3-3.6" class="tick" />
	{/if}
</svg>

<style>
	.sg { flex: none; display: inline-block; vertical-align: middle; }
	.ring { fill: none; stroke-width: 1.6; }
	.dash { stroke-dasharray: 2.2 2.1; }
	.sg-failed .fill { fill: var(--k-danger-solid); }
	.sg-failed .bang { stroke: white; stroke-width: 1.8; stroke-linecap: round; }
	.sg-failed .dot { fill: white; }
	.sg-approval .ring { stroke: var(--k-warning-solid); }
	.sg-approval .core { fill: var(--k-warning-solid); }
	.sg-deploying .ring, .sg-checking .ring { stroke: var(--k-active-solid); }
	.sg-deploying .core, .sg-checking .core { fill: var(--k-active-solid); }
	.sg-held .ring { stroke: var(--k-held-solid); }
	.sg-held .bars { stroke: var(--k-held-solid); stroke-width: 1.6; stroke-linecap: round; }
	.sg-waiting .ring { stroke: var(--k-fg-subtle); }
	.sg-rest .ring, .sg-arrived .ring { stroke: var(--k-fg-disabled); }
	.sg-rest .tick, .sg-arrived .tick { fill: none; stroke: var(--k-fg-subtle); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
	.sg-arrived .ring { stroke: var(--k-success-line); }
	.sg-arrived .tick { stroke: var(--k-success-fg); }
</style>
