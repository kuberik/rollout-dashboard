/**
 * Pure helpers for MiniPipeline.svelte (the one strand drawing): the geometry contract and the adapters from the
 * product's step / tier vocabularies to MiniPipeline nodes. Unit-tested in mini-pipeline.test.ts.
 */
import type { Step } from './data';
import { stepTone } from './rollout-view';

export type MiniState = 'done' | 'current' | 'pending' | 'failed' | 'held' | 'approval' | 'checking' | 'rest';
export type MiniNode = { state: MiniState; label?: string; title?: string; step?: string; stepState?: string };

/** The two pitches (px). node = slot width = diameter; pitch = centre to centre; the connector is pitch − d long. */
export const GEO = { xs: { d: 10, pitch: 22, line: 1 }, sm: { d: 24, pitch: 56, line: 2 } } as const;
export const connector = (size: keyof typeof GEO) => GEO[size].pitch - GEO[size].d;
/** natural width of a strand of n nodes: (n − 1) × pitch + d, never stretched */
export const strandWidth = (size: keyof typeof GEO, n: number) => (n <= 0 ? 0 : (n - 1) * GEO[size].pitch + GEO[size].d);

/** a rollout's own steps → nodes; `rowState` 'deploying' keeps a running Check blue (rollout-view stepTone) */
export function nodesOfSteps(steps: Step[], rowState?: string, named = false): MiniNode[] {
	return steps.map((s) => ({
		state: s.state === 'done' ? 'done' : s.state === 'fail' ? 'failed' : s.state === 'hold' ? 'held' : s.state === 'todo' ? 'pending' : stepTone(s, rowState) === 'checking' ? 'checking' : 'current',
		label: named ? s.name : undefined,
		step: s.name,
		stepState: s.state
	}));
}
